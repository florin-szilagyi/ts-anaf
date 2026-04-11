import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../output/errors';
import { tokenRecordSchema } from './schemas';
import type { TokenRecord } from './types';
import { getXdgPaths, type XdgPaths } from './paths';

export class TokenStore {
  private readonly paths: XdgPaths;

  constructor(opts?: { paths?: XdgPaths }) {
    this.paths = opts?.paths ?? getXdgPaths();
  }

  exists(name: string): boolean {
    return fs.existsSync(this.paths.tokenFile(name));
  }

  read(name: string): TokenRecord | undefined {
    const file = this.paths.tokenFile(name);
    if (!fs.existsSync(file)) return undefined;
    const raw = fs.readFileSync(file, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new CliError({
        code: 'INVALID_TOKEN_FILE',
        message: `Failed to parse token file for "${name}": ${(cause as Error).message}`,
        category: 'local_state',
        details: { name, path: file },
      });
    }
    const result = tokenRecordSchema.safeParse(parsed);
    if (!result.success) {
      throw new CliError({
        code: 'INVALID_TOKEN_FILE',
        message: `Token file for "${name}" failed validation: ${result.error.message}`,
        category: 'local_state',
        details: { name, path: file, issues: result.error.issues },
      });
    }
    return result.data;
  }

  write(name: string, record: TokenRecord): void {
    const file = this.paths.tokenFile(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const validated = tokenRecordSchema.parse(record);
    // Use writeFileSync with mode 0o600 so the file is created tight from the start.
    // If the file already exists, writeFileSync truncates but preserves the original mode,
    // so explicitly chmod afterwards.
    fs.writeFileSync(file, JSON.stringify(validated, null, 2), { mode: 0o600 });
    if (process.platform !== 'win32') {
      fs.chmodSync(file, 0o600);
    }
  }

  remove(name: string): void {
    const file = this.paths.tokenFile(name);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }

  getRefreshToken(name: string): string | undefined {
    return this.read(name)?.refreshToken;
  }

  setRefreshToken(name: string, refreshToken: string): void {
    const current = this.read(name);
    this.write(name, { ...current, refreshToken });
  }
}
