import { openDb } from './storage/db.ts';
import { computeTaskMetrics } from './core/metrics.ts';
import type { TaskMetrics } from './types.ts';

export function runReport(args: string[]): void {
  const taskId = args[0];
  if (!taskId) {
    console.error('usage: token-profiler report <task_id>');
    process.exitCode = 1;
    return;
  }

  const db = openDb();
  let metrics: TaskMetrics;
  try {
    metrics = computeTaskMetrics(db, taskId);
  } finally {
    db.close();
  }
  printReport(metrics);
}

function printReport(m: TaskMetrics): void {
  console.log(`Task ${m.taskId}`);
  console.log('─'.repeat(60));
  console.log(`Requests                     ${m.observedTokenTraffic.requestCount}`);
  console.log(`Observed input tokens         ${m.observedTokenTraffic.inputTokens}`);
  console.log(`Observed output tokens        ${m.observedTokenTraffic.outputTokens}`);
  console.log(`  cache_creation_input_tokens ${m.observedTokenTraffic.cacheCreationTokens}`);
  console.log(`  cache_read_input_tokens     ${m.observedTokenTraffic.cacheReadTokens}`);
  console.log('');
  console.log(`Unique Context Volume (UCV)   ${m.ucv} bytes   ← Deterministic (byte basis)`);
  console.log(`Context Transport Vol (CTV)   ${m.ctv} bytes   ← Deterministic (byte basis)`);
  console.log(`Context Amplification         ${fmtRatio(m.contextAmplification)}   ← Deterministic (byte basis)`);
  console.log('');
  console.log(`Application Context           ${m.transportByClass.application} bytes`);
  console.log(`Protocol Context              ${m.transportByClass.protocol} bytes`);
  console.log(`Unclassified (unknown)        ${m.transportByClass.unknown} bytes`);
  console.log(`Classification Coverage       ${fmtPct(m.classificationCoverage)}`);
  console.log(`Protocol Share                ${fmtPct(m.protocolShare)}`);
  console.log('');
  console.log('Exact reuse (byte basis) by request:');
  for (const r of m.exactReuseByRequest) {
    console.log(`  #${r.requestIndex}  ${fmtPct(r.exactReuseRatio)}  (${r.reusedBytes}/${r.totalBytes} bytes)`);
  }

  if (m.threadBreakdown.length > 1) {
    console.log('');
    console.log('Conversation Thread breakdown (Claude Code adapter, verified_best_effort — not Core Measurement):');
    for (const t of m.threadBreakdown) {
      const label = t.threadExternalId ?? 'unknown';
      const subagentTag = t.isSubagent === true ? ' [subagent]' : t.isSubagent === false ? ' [main]' : '';
      console.log(
        `  thread=${label}${subagentTag}  ${t.requestCount} requests  in=${t.inputTokens} out=${t.outputTokens}`
      );
    }
  }
}

function fmtRatio(x: number | null): string {
  return x === null ? 'n/a' : `${x.toFixed(2)}x`;
}
function fmtPct(x: number | null): string {
  return x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`;
}
