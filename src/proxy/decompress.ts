import zlib from 'node:zlib';
import type { IncomingHttpHeaders } from 'node:http';

// Transport concern (ADR-0009): undo HTTP content-encoding before any provider
// protocol parses a response body. Shared by every protocol's usage
// extraction, so it does not belong inside one of them. On an unknown or
// corrupt encoding it returns the bytes unchanged — a downstream JSON/SSE
// parse then fails gracefully and usage stays all-null.
export function decompressBody(buf: Buffer, headers: IncomingHttpHeaders): Buffer {
  const encoding = headers['content-encoding'];
  try {
    if (encoding === 'gzip') return zlib.gunzipSync(buf);
    if (encoding === 'br') return zlib.brotliDecompressSync(buf);
    if (encoding === 'deflate') return zlib.inflateSync(buf);
  } catch {
    // fall through
  }
  return buf;
}
