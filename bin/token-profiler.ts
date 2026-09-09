#!/usr/bin/env node
import { main } from '../src/cli.ts';

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? String(err)) : String(err));
  process.exitCode = 1;
});
