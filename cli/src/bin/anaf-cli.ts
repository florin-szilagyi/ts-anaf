#!/usr/bin/env node
import { runProgram } from '../commands/runProgram';

// runProgram's internal try/catch should normally cover every failure mode and
// resolve the promise. This `.catch` is a last-resort safety net: if something
// genuinely unrecoverable escapes the inner handler (e.g. a synchronous throw
// from stream construction the inner try cannot reach), we still want to exit
// with a readable message instead of Node's default UnhandledPromiseRejection.
runProgram({ argv: process.argv }).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`anaf-cli: ${message}\n`);
  process.exit(1);
});
