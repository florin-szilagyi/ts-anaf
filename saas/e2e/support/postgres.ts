import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { PG_BIN_CANDIDATES, PG_DIR, PG_PORT, PG_SOCKET_DIR } from './env';

/**
 * Scratch Postgres for e2e: initdb + pg_ctl on a throwaway data dir. Each run
 * starts from a fresh cluster so seeds are deterministic. When the harness
 * runs as root (dev containers), commands are dropped to the `postgres`
 * system user because initdb/postgres refuse to run as root.
 */

function pgBin(cmd: string): string {
  for (const dir of PG_BIN_CANDIDATES) {
    const p = dir ? `${dir}/${cmd}` : cmd;
    if (!dir || existsSync(p)) return p;
  }
  return cmd;
}

const asPgUser = process.getuid?.() === 0;

function run(cmd: string): void {
  const full = asPgUser ? `su postgres -s /bin/sh -c ${JSON.stringify(cmd)}` : cmd;
  execSync(full, { stdio: 'pipe' });
}

export function startPostgres(): void {
  rmSync(PG_DIR, { recursive: true, force: true });
  rmSync(PG_SOCKET_DIR, { recursive: true, force: true });
  mkdirSync(PG_DIR, { recursive: true });
  mkdirSync(PG_SOCKET_DIR, { recursive: true });
  if (asPgUser) {
    execFileSync('chown', ['-R', 'postgres:postgres', PG_DIR, PG_SOCKET_DIR]);
  }

  run(`${pgBin('initdb')} -D ${PG_DIR} -U postgres -A trust`);
  run(
    `${pgBin('pg_ctl')} -D ${PG_DIR} -w -l ${PG_DIR}/pg.log ` +
      `-o "-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${PG_SOCKET_DIR} -c fsync=off" start`
  );
  run(`${pgBin('createdb')} -h 127.0.0.1 -p ${PG_PORT} -U postgres fastbill_e2e`);
}

export function stopPostgres(): void {
  try {
    run(`${pgBin('pg_ctl')} -D ${PG_DIR} -m fast stop`);
  } catch {
    // already stopped
  }
}
