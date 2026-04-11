import { spawnSync } from 'node:child_process';
import path from 'node:path';

const BIN = path.resolve(__dirname, '..', 'dist', 'bin', 'anaf-cli.js');

describe('anaf-cli bin smoke', () => {
  it('prints the version and exits 0', () => {
    const result = spawnSync(process.execPath, [BIN, '--version'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints help and exits 0', () => {
    const result = spawnSync(process.execPath, [BIN, '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: anaf-cli');
  });
});
