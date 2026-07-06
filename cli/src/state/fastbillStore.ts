import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../output/errors';
import { fastbillConfigSchema, type FastbillConfig } from './schemas';
import { getXdgPaths, type XdgPaths } from './paths';

/**
 * On-disk storage for the fastbill API key (and optional base URL override).
 * Mirrors TokenStore: JSON at $XDG_CONFIG_HOME/anaf-cli/fastbill.json,
 * created with mode 0600 (the API key is a bearer secret).
 */
export class FastbillStore {
  private readonly paths: XdgPaths;

  constructor(opts?: { paths?: XdgPaths }) {
    this.paths = opts?.paths ?? getXdgPaths();
  }

  exists(): boolean {
    return fs.existsSync(this.paths.fastbillCredentialFile);
  }

  read(): FastbillConfig | undefined {
    const file = this.paths.fastbillCredentialFile;
    if (!fs.existsSync(file)) return undefined;
    const raw = fs.readFileSync(file, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new CliError({
        code: 'INVALID_FASTBILL_FILE',
        message: `Failed to parse fastbill config: ${(cause as Error).message}`,
        category: 'local_state',
        details: { path: file },
      });
    }
    const result = fastbillConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new CliError({
        code: 'INVALID_FASTBILL_FILE',
        message: `fastbill config failed validation: ${result.error.message}`,
        category: 'local_state',
        details: { path: file, issues: result.error.issues },
      });
    }
    return result.data;
  }

  write(config: FastbillConfig): void {
    const file = this.paths.fastbillCredentialFile;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const validated = fastbillConfigSchema.parse(config);
    // Created tight (0600); chmod afterwards in case the file pre-existed.
    fs.writeFileSync(file, JSON.stringify(validated, null, 2), { mode: 0o600 });
    if (process.platform !== 'win32') {
      fs.chmodSync(file, 0o600);
    }
  }

  remove(): void {
    const file = this.paths.fastbillCredentialFile;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}
