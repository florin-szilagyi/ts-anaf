#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

export async function main(): Promise<void> {
  throw new Error('server not yet implemented');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
