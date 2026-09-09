import type { IncomingHttpHeaders } from 'node:http';
import type {
  ExtractedBlock,
  NormalizedUsage,
  ParsedProviderRequest,
  ProviderProtocol,
  ProviderRequest,
} from './types.ts';
import type { TransportRole } from '../types.ts';

// Anthropic Messages API protocol adapter (ADR-0009 Provider Protocol layer).
// Reads request bodies and response usage in Anthropic's shape and lowers them
// to the measurement-neutral types in ./types.ts. Nothing above this file
// (recorder, enrichment, core) knows these shapes.

// --- Anthropic Messages API request body (only the parts we read) -----

export type SystemField =
  | string
  | Array<string | { type?: string; text?: string }>
  | undefined;

export interface AnthropicContentPart {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  thinking?: string;
  data?: string;
  tool_use_id?: string;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentPart[];
}

export interface MessagesRequestBody {
  model?: string;
  system?: SystemField;
  tools?: unknown[];
  messages?: AnthropicMessage[];
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// --- system field ----------------------------------------------------

export function extractSystemText(system: SystemField): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map((b) => (typeof b === 'string' ? b : b.text || '')).join('\n');
  }
  return '';
}

// --- StructuralBlock extraction (CONTEXT.md, Level 1) ----------------
//
// system prompt and tool schemas are always Protocol Context by definition
// (CONTEXT.md Protocol Context). Message text is emitted as a single 'unknown'
// block per text part — the <system-reminder> split that can further classify
// it is a client-framework concern and lives in the enrichment layer
// (src/enrichment/system-reminder.ts), not here.

export function extractProviderBlocks(requestBody: MessagesRequestBody): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let seq = 0;

  const systemText = extractSystemText(requestBody.system);
  if (systemText) {
    blocks.push({ seq: seq++, type: 'system', transportRole: null, contextClass: 'protocol', text: systemText });
  }

  if (Array.isArray(requestBody.tools) && requestBody.tools.length > 0) {
    const toolsText = JSON.stringify(requestBody.tools);
    blocks.push({ seq: seq++, type: 'tool_schema', transportRole: null, contextClass: 'protocol', text: toolsText });
  }

  if (Array.isArray(requestBody.messages)) {
    for (const message of requestBody.messages) {
      seq = extractMessageBlocks(message, blocks, seq);
    }
  }

  return blocks;
}

function extractMessageBlocks(message: AnthropicMessage, blocks: ExtractedBlock[], seq: number): number {
  const role: TransportRole = message.role;
  const content = message.content;

  if (typeof content === 'string') {
    if (content) {
      blocks.push({ seq: seq++, type: 'message', transportRole: role, contextClass: 'unknown', text: content });
    }
    return seq;
  }
  if (!Array.isArray(content)) return seq;

  for (const part of content) {
    if (part.type === 'text') {
      const text = part.text || '';
      if (text) blocks.push({ seq: seq++, type: 'message', transportRole: role, contextClass: 'unknown', text });
    } else if (part.type === 'tool_use') {
      const text = JSON.stringify({ name: part.name, input: part.input ?? {} });
      blocks.push({ seq: seq++, type: 'message', transportRole: role, contextClass: 'application', text });
    } else if (part.type === 'tool_result') {
      const text = toolResultText(part.content);
      if (text) blocks.push({ seq: seq++, type: 'tool_result', transportRole: role, contextClass: 'application', text });
    } else if (part.type === 'thinking' || part.type === 'redacted_thinking') {
      const text = part.thinking || part.data || '';
      if (text) blocks.push({ seq: seq++, type: 'message', transportRole: role, contextClass: 'application', text });
    }
    // Other/unrecognized content part types are skipped in v0 rather than
    // guessed at — a gap in coverage, not a silent misclassification.
  }
  return seq;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: AnthropicContentPart) => (c.type === 'text' ? c.text || '' : JSON.stringify(c)))
      .join('\n');
  }
  return '';
}

// --- request parse -------------------------------------------------

// Anthropic Messages endpoint. The SDK appends `/v1/messages` to the base URL;
// `/messages` (no version prefix) is accepted defensively. Sub-paths such as
// `/v1/messages/count_tokens` are intentionally NOT matched — they are a
// different operation and must not be recorded as a messages request.
const MESSAGES_PATH_RE = /^\/(?:v1\/)?messages\/?$/;

function parseRequest({ method, path, headers, body }: ProviderRequest): ParsedProviderRequest | null {
  if (method !== 'POST') return null;

  const pathname = path.split('?', 1)[0] ?? path;
  if (!MESSAGES_PATH_RE.test(pathname)) return null;

  const contentType = headers['content-type'];
  if (contentType && !String(contentType).includes('json')) return null;

  if (!body.length) return null;
  let parsed: MessagesRequestBody;
  try {
    parsed = JSON.parse(body.toString('utf8')) as MessagesRequestBody;
  } catch {
    return null; // not JSON — forward unmodified, skip measurement
  }

  return {
    provider: 'anthropic',
    operationType: 'messages',
    model: parsed.model ?? null,
    systemText: extractSystemText(parsed.system),
    blocks: extractProviderBlocks(parsed),
  };
}

// --- response usage ----------------------------------------------

// Reconstructs usage from either a plain JSON response or an SSE stream, per
// Anthropic's message_start (initial usage) + message_delta (incremental
// output_tokens) events. spec §25 "実装要件として確定した事項". `responseBuf`
// is already content-decoded by the transport layer (src/proxy/decompress.ts).
function extractUsage(responseBuf: Buffer, headers: IncomingHttpHeaders): NormalizedUsage {
  const text = responseBuf.toString('utf8');
  const isSSE = (headers['content-type'] || '').includes('text/event-stream');
  const raw: AnthropicUsage = {};

  if (isSSE) {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;
      try {
        const evt = JSON.parse(jsonStr) as {
          type?: string;
          message?: { usage?: AnthropicUsage };
          usage?: AnthropicUsage;
        };
        if (evt.type === 'message_start' && evt.message?.usage) Object.assign(raw, evt.message.usage);
        if (evt.type === 'message_delta' && evt.usage) Object.assign(raw, evt.usage);
      } catch {
        // partial/keepalive line, ignore
      }
    }
  } else {
    try {
      const parsed = JSON.parse(text) as { usage?: AnthropicUsage };
      if (parsed.usage) Object.assign(raw, parsed.usage);
    } catch {
      // non-JSON body
    }
  }

  return {
    inputTokens: raw.input_tokens ?? null,
    outputTokens: raw.output_tokens ?? null,
    cacheCreationTokens: raw.cache_creation_input_tokens ?? null,
    cacheReadTokens: raw.cache_read_input_tokens ?? null,
  };
}

export const anthropicMessagesProtocol: ProviderProtocol = {
  id: 'anthropic-messages',
  parseRequest,
  extractUsage,
};
