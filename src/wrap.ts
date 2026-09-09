import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import {
  openDb,
  openDbReadOnly,
  defaultDbPath,
  ensureMeasurementProfile,
  insertTask,
  insertAgent,
  endTask,
} from './storage/db.ts';
import { loadOrCreateSecret, homeDir } from './secret.ts';
import { createProxyServer } from './proxy/server.ts';
import { createUiServer, uiClientBuilt, UI_NOT_BUILT_MESSAGE } from './ui/server.ts';
import { resolveLaunchProfile } from './launch/profiles.ts';
import { generateBindingToken } from './proxy/binding.ts';
import { MEASUREMENT_PROFILE_V1 } from './core/ingest.ts';
import { uuidv7 } from './util/uuidv7.ts';
import { parseDebugCaptureFilter, describeDebugCaptureFilter } from './debug-capture.ts';
import type { DebugCaptureConfig, DebugCaptureFilter } from './types.ts';

interface WrapOptions {
  debugCaptureFilter?: string | undefined;
  // Start the read-only localhost UI (127.0.0.1:7331) alongside the proxy so
  // it does not need a separate `token-profiler ui`. Defaults to true; the
  // `--no-ui` wrap flag sets it false.
  ui?: boolean | undefined;
  // Port for that piggybacked UI (`--ui-port`). Defaults to DEFAULT_UI_PORT.
  // Ignored when ui === false.
  uiPort?: number | undefined;
}

const DEFAULT_UI_PORT = 7331;

// Best-effort: bring up the localhost UI on `uiPort` (default 7331, override
// with `--ui-port`) so a `wrap` session is browsable without a second command.
// If the port is already taken we assume an existing UI (same default DB) and
// just print the URL — this is the "join the existing localhost" behaviour,
// not an error. Anything we do start here is ours to shut down when the Task ends.
async function startPiggybackUi(
  taskId: string,
  uiPort: number
): Promise<{ server: Server; db: DatabaseSync } | null> {
  let db: DatabaseSync | null = null;
  try {
    db = openDbReadOnly();
    const server = createUiServer(db, defaultDbPath());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(uiPort, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    console.error(`[token-profiler] ui  →  http://127.0.0.1:${uiPort}/?task=${taskId}`);
    return { server, db };
  } catch (err) {
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      console.error(
        `[token-profiler] ui already on :${uiPort}  →  http://127.0.0.1:${uiPort}/?task=${taskId}`
      );
    } else {
      console.error(`[token-profiler] ui not started (${(err as Error).message})`);
    }
    return null;
  }
}

// `wrap` (CONTEXT.md): explicit Task/Agent boundary. One `wrap` invocation =
// one ephemeral proxy = one Task; Task ends when the root process exits
// (Design boundary, ADR-0001). No always-on daemon in v0.
export async function runWrap(args: string[], options: WrapOptions = {}): Promise<void> {
  if (args.length === 0) {
    console.error('usage: token-profiler wrap [--debug-capture-filter <spec>] -- <command> [args...]');
    process.exitCode = 1;
    return;
  }
  const [cmd, ...cmdArgs] = args as [string, ...string[]];

  // Client Launch Adapter (ADR-0009): the wrapped command decides the API base
  // URL env var, the upstream host, the wire protocol, and the enrichment set.
  // Everything below stays provider-agnostic.
  const { profile, matched } = resolveLaunchProfile(cmd);

  // Opt-in targeted debug row capture (ADR-0012). Parsed and reported up
  // front, before the DB/proxy are touched, so a malformed --debug-capture-filter
  // fails fast instead of silently capturing nothing.
  let debugCaptureFilters: DebugCaptureFilter[] | null = null;
  if (options.debugCaptureFilter) {
    try {
      debugCaptureFilters = parseDebugCaptureFilter(options.debugCaptureFilter);
    } catch (err) {
      console.error(`[token-profiler] ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
  }

  const db = openDb();
  const secret = loadOrCreateSecret();
  ensureMeasurementProfile(db, MEASUREMENT_PROFILE_V1);

  const taskId = uuidv7();
  const agentId = crypto.randomUUID();
  const bindingToken = generateBindingToken();
  const startedAt = new Date().toISOString();

  insertTask(db, {
    taskId,
    createdAt: startedAt,
    measurementProfileId: MEASUREMENT_PROFILE_V1.id,
    fingerprintKeyId: secret.epoch_id,
  });
  insertAgent(db, { agentId, taskId, agentRole: null, createdAt: startedAt });

  let debugCapture: DebugCaptureConfig | undefined;
  if (debugCaptureFilters) {
    const dir = path.join(homeDir(), 'debug-capture');
    debugCapture = { filters: debugCaptureFilters, dir, taskId };
    console.error(describeDebugCaptureFilter(debugCaptureFilters, path.join(dir, taskId)));
  }

  const server = createProxyServer({
    db,
    secretHex: secret.secret_hex,
    taskId,
    agentId,
    fingerprintKeyId: secret.epoch_id,
    bindingToken,
    launch: profile,
    debugCapture,
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/proxy/${bindingToken}`;

  console.error(`[token-profiler] task ${taskId}`);
  console.error(
    `[token-profiler] launch profile: ${profile.id}${matched ? '' : ` (default — '${cmd}' not recognised)`}`
  );
  console.error(`[token-profiler] proxying ${profile.proxyEnvVar}=${baseUrl}`);

  // A source checkout that has not run `npm run build` has no UI to serve
  // (ADR-0015 decision 5): warn and degrade to --no-ui rather than fail the
  // whole `wrap`. A release tarball always ships dist/ui/.
  let uiEnabled = options.ui !== false;
  if (uiEnabled && !uiClientBuilt()) {
    console.error(`${UI_NOT_BUILT_MESSAGE}; continuing with --no-ui`);
    uiEnabled = false;
  }
  const ownUi = uiEnabled
    ? await startPiggybackUi(taskId, options.uiPort ?? DEFAULT_UI_PORT)
    : null;

  const child = spawn(cmd, cmdArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      [profile.proxyEnvVar]: baseUrl,
      TOKEN_PROFILER_TASK_ID: taskId,
    },
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    child.on('error', (err) => {
      console.error(`[token-profiler] failed to launch '${cmd}': ${err.message}`);
      resolve(1);
    });
  });

  // Drain the proxy first (any in-flight request finishes writing its row),
  // then mark the Task ended, and only then tear down our own UI — so a
  // browser left on the piggybacked UI sees the Task flip to "ended" (its
  // delete control enabling) before the server goes away.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  endTask(db, taskId, new Date().toISOString());
  if (ownUi) {
    // A browser tab left open on the UI holds a keep-alive socket; without
    // this, `close()` would block wrap's exit until that socket times out.
    const closed = new Promise<void>((resolve) => ownUi.server.close(() => resolve()));
    ownUi.server.closeAllConnections();
    await closed;
    ownUi.db.close();
  }
  db.close();

  console.error(`[token-profiler] task ${taskId} ended — run: token-profiler report ${taskId}`);
  process.exitCode = exitCode;
}
