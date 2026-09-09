import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { decompressBody } from './decompress.ts';
import { recordObservedRequest } from '../recorder.ts';
import { claudeCodeProfile } from '../launch/profiles.ts';
import type { ClientLaunchProfile } from '../launch/types.ts';
import type { DebugCaptureConfig } from '../types.ts';

// Local Proxy (CONTEXT.md): reverse-proxies provider API traffic unmodified,
// buffers just enough to hand one observed exchange to the measurement sink,
// and streams the response back to the client without altering it — the
// "communication is not changed" boundary (§4.1 Observability first). This
// file is the Transport layer (ADR-0009): HTTP forwarding + response
// streaming only. The wire shape (ProviderProtocol) and the enrichment set
// come from the ClientLaunchProfile `wrap` resolved; turning an observed
// exchange into rows is the recorder's job.
//
// v0 scope: single (task_id, agent_id) per proxy instance (one `wrap` = one
// ephemeral proxy = one Task), one launch profile. The Proxy Binding token is
// still required in the URL path for wire-format forward-compatibility with a
// future shared daemon (ADR-0001), even though a single-tenant proxy could
// route without it.

interface ProxyServerOptions {
  db: DatabaseSync;
  secretHex: string;
  taskId: string;
  agentId: string;
  fingerprintKeyId: string;
  bindingToken: string;
  launch?: ClientLaunchProfile;
  debugCapture?: DebugCaptureConfig | null;
}

export function createProxyServer({
  db,
  secretHex,
  taskId,
  agentId,
  fingerprintKeyId,
  bindingToken,
  launch = claudeCodeProfile,
  debugCapture,
}: ProxyServerOptions): http.Server {
  const { targetHost, protocol } = launch;
  let requestIndex = 0;

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const prefix = `/proxy/${bindingToken}`;
    if (!req.url || !req.url.startsWith(prefix)) {
      res.writeHead(404);
      res.end('unknown proxy binding');
      return;
    }
    const upstreamPath = req.url.slice(prefix.length) || '/';

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(chunks);
      // Provider Protocol decides from method + path whether this is its shape,
      // then reads the body; null = not measurable, still forwarded unchanged.
      const parsed = protocol.parseRequest({
        method: req.method,
        path: upstreamPath,
        headers: req.headers,
        body: bodyBuf,
      });

      const requestId = crypto.randomUUID();
      const startedAt = Date.now();

      const headers: IncomingHttpHeaders = { ...req.headers, host: targetHost };
      delete headers['content-length'];
      if (bodyBuf.length) headers['content-length'] = String(bodyBuf.length);

      const options: https.RequestOptions = {
        hostname: targetHost,
        port: 443,
        path: upstreamPath,
        method: req.method,
        headers,
      };

      const proxyReq = https.request(options, (proxyRes: IncomingMessage) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        const respChunks: Buffer[] = [];
        proxyRes.on('data', (c: Buffer) => {
          respChunks.push(c);
          res.write(c);
        });
        proxyRes.on('end', () => {
          res.end();
          const latencyMs = Date.now() - startedAt;
          if (parsed && proxyRes.statusCode === 200) {
            try {
              const responseBuf = decompressBody(Buffer.concat(respChunks), proxyRes.headers);
              const usage = protocol.extractUsage(responseBuf, proxyRes.headers);
              recordObservedRequest({
                db,
                secretHex,
                taskId,
                agentId,
                fingerprintKeyId,
                requestId,
                requestIndex: requestIndex++,
                parsed,
                usage,
                latencyMs,
                startedAt,
                identifyThread: launch.identifyThread,
                refineBlocks: launch.refineBlocks,
                debugCapture,
              });
            } catch (e) {
              console.error(`[token-profiler] measurement failed for ${requestId}: ${(e as Error).message}`);
            }
          }
        });
      });
      proxyReq.on('error', (e: Error) => {
        console.error('[token-profiler] upstream error', e.message);
        if (!res.headersSent) res.writeHead(502);
        res.end(String(e));
      });
      proxyReq.end(bodyBuf);
    });
  });

  return server;
}
