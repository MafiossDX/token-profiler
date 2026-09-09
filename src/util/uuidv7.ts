import crypto from 'node:crypto';

// UUIDv7 (CONTEXT.md Task: "task_id（UUIDv7）"): 48-bit big-endian unix-ms
// timestamp + version/variant bits + random. Time-ordered so task IDs sort
// chronologically, unlike UUIDv4 (used elsewhere for agent_id/request_id/etc,
// where sort order doesn't matter).
export function uuidv7(): string {
  const bytes = Buffer.alloc(16);
  const timeHex = Date.now().toString(16).padStart(12, '0');
  bytes.write(timeHex, 0, 'hex');

  const rand = crypto.randomBytes(10);
  bytes[6] = 0x70 | (rand[0]! & 0x0f); // version 7
  bytes[7] = rand[1]!;
  bytes[8] = 0x80 | (rand[2]! & 0x3f); // variant 10xxxxxx
  bytes[9] = rand[3]!;
  for (let i = 0; i < 6; i++) bytes[10 + i] = rand[4 + i]!;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
