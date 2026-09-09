import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  anthropicMessagesProtocol,
  extractProviderBlocks,
  extractSystemText,
} from '../src/protocol/anthropic-messages.ts';
import type { ProviderRequest } from '../src/protocol/types.ts';

// A well-formed Messages request as the transport layer would present it;
// override one field per case.
function req(over: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    method: 'POST',
    path: '/v1/messages',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from('{}'),
    ...over,
  };
}

// --- extractSystemText ---------------------------------------------

test('extractSystemText: string, array-of-strings, array-of-blocks, undefined', () => {
  assert.equal(extractSystemText('hi'), 'hi');
  assert.equal(extractSystemText(['a', 'b']), 'a\nb');
  assert.equal(extractSystemText([{ type: 'text', text: 'x' }, 'y']), 'x\ny');
  assert.equal(extractSystemText(undefined), '');
});

// --- extractProviderBlocks: Anthropic shape -> neutral blocks ------

test('extractProviderBlocks: system and tool schemas are protocol', () => {
  const blocks = extractProviderBlocks({
    system: 'you are a helpful assistant',
    tools: [{ name: 'read_file', input_schema: {} }],
    messages: [{ role: 'user', content: 'hello' }],
  });
  assert.equal(blocks.find((b) => b.type === 'system')?.contextClass, 'protocol');
  assert.equal(blocks.find((b) => b.type === 'tool_schema')?.contextClass, 'protocol');
});

test('extractProviderBlocks: plain message text is left unknown (reminder split is enrichment)', () => {
  const blocks = extractProviderBlocks({
    messages: [
      { role: 'user', content: 'real request\n<system-reminder>hidden</system-reminder>' },
    ],
  });
  const msg = blocks.filter((b) => b.type === 'message');
  assert.equal(msg.length, 1, 'protocol emits one block; it does not split reminders');
  assert.equal(msg[0]!.contextClass, 'unknown');
  assert.equal(msg[0]!.transportRole, 'user');
});

test('extractProviderBlocks: tool_use / thinking are application message blocks', () => {
  const blocks = extractProviderBlocks({
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'let me think' },
          { type: 'tool_use', name: 'read_file', input: { path: 'x' } },
        ],
      },
    ],
  });
  const appMsgs = blocks.filter((b) => b.type === 'message' && b.contextClass === 'application');
  assert.equal(appMsgs.length, 2);
});

test('extractProviderBlocks: tool_result is its own type, classified application', () => {
  const blocks = extractProviderBlocks({
    messages: [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'file contents' }] },
    ],
  });
  const tr = blocks.find((b) => b.type === 'tool_result');
  assert.ok(tr);
  assert.equal(tr.contextClass, 'application');
});

test('extractProviderBlocks: empty text parts produce no block; seq is contiguous', () => {
  const blocks = extractProviderBlocks({
    system: 's',
    messages: [{ role: 'user', content: [{ type: 'text', text: '' }, { type: 'text', text: 'real' }] }],
  });
  assert.deepEqual(blocks.map((b) => b.seq), [0, 1]);
  assert.equal(blocks[1]!.text, 'real');
});

// --- parseRequest -------------------------------------------------

test('parseRequest: valid POST /v1/messages -> neutral ParsedProviderRequest', () => {
  const body = Buffer.from(JSON.stringify({ model: 'claude-x', system: 'sys', messages: [{ role: 'user', content: 'hi' }] }));
  const parsed = anthropicMessagesProtocol.parseRequest(req({ body }));
  assert.ok(parsed);
  assert.equal(parsed.provider, 'anthropic');
  assert.equal(parsed.operationType, 'messages');
  assert.equal(parsed.model, 'claude-x');
  assert.equal(parsed.systemText, 'sys');
  assert.ok(parsed.blocks.length >= 1);
});

test('parseRequest: /messages without version prefix and with a query string still matches', () => {
  const body = Buffer.from(JSON.stringify({ messages: [] }));
  assert.ok(anthropicMessagesProtocol.parseRequest(req({ path: '/messages', body }))); // defensive
  assert.ok(anthropicMessagesProtocol.parseRequest(req({ path: '/v1/messages?beta=true', body })));
});

test('parseRequest: not this protocol\'s shape -> null (forwarded unmeasured)', () => {
  const body = Buffer.from(JSON.stringify({ messages: [] }));
  assert.equal(anthropicMessagesProtocol.parseRequest(req({ method: 'GET', body })), null);
  assert.equal(anthropicMessagesProtocol.parseRequest(req({ path: '/v1/messages/count_tokens', body })), null);
  assert.equal(anthropicMessagesProtocol.parseRequest(req({ path: '/v1/complete', body })), null);
  assert.equal(
    anthropicMessagesProtocol.parseRequest(req({ headers: { 'content-type': 'text/plain' }, body })),
    null
  );
});

test('parseRequest: empty and non-JSON bodies -> null', () => {
  assert.equal(anthropicMessagesProtocol.parseRequest(req({ body: Buffer.alloc(0) })), null);
  assert.equal(anthropicMessagesProtocol.parseRequest(req({ body: Buffer.from('not json{') })), null);
});

test('parseRequest: missing model -> null model, not undefined', () => {
  const parsed = anthropicMessagesProtocol.parseRequest(req({ body: Buffer.from(JSON.stringify({ messages: [] })) }));
  assert.ok(parsed);
  assert.equal(parsed.model, null);
});

// --- extractUsage ----------------------------------------------

const H_JSON = { 'content-type': 'application/json' };
const H_SSE = { 'content-type': 'text/event-stream' };

test('extractUsage: plain JSON response usage -> normalized names', () => {
  const body = JSON.stringify({
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 30 },
  });
  assert.deepEqual(anthropicMessagesProtocol.extractUsage(Buffer.from(body), H_JSON), {
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationTokens: 5,
    cacheReadTokens: 30,
  });
});

test('extractUsage: SSE message_start then message_delta merge', () => {
  const sse = [
    'event: message_start',
    `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 200, output_tokens: 1, cache_read_input_tokens: 12 } } })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 45 } })}`,
    '',
    ': keepalive',
    'data: {partial',
  ].join('\n');
  assert.deepEqual(anthropicMessagesProtocol.extractUsage(Buffer.from(sse), H_SSE), {
    inputTokens: 200,
    outputTokens: 45, // delta wins
    cacheCreationTokens: null,
    cacheReadTokens: 12,
  });
});

// content-decoding is the transport layer's job (test/proxy-decompress.test.ts);
// extractUsage receives an already-decoded buffer.

test('extractUsage: non-JSON / empty body -> all null', () => {
  assert.deepEqual(anthropicMessagesProtocol.extractUsage(Buffer.from('<html>error</html>'), H_JSON), {
    inputTokens: null,
    outputTokens: null,
    cacheCreationTokens: null,
    cacheReadTokens: null,
  });
});
