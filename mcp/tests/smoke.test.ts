import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { describe, it, expect, beforeAll } from '@jest/globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.join(__dirname, '..', 'dist', 'server.js');

describe('MCP server smoke test', () => {
  beforeAll(() => {
    if (!fs.existsSync(SERVER_PATH)) {
      throw new Error(`Server not built at ${SERVER_PATH}. Run 'pnpm run build' before smoke tests.`);
    }
  });

  it('lists all 10 tools in response to tools/list', async () => {
    const child = spawn('node', [SERVER_PATH], {
      env: {
        ...process.env,
        ANAF_CLIENT_ID: 'dummy',
        ANAF_CLIENT_SECRET: 'dummy',
        ANAF_REDIRECT_URI: 'https://localhost:9002/callback',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const request = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();

    const output = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
      child.on('error', reject);
      setTimeout(() => {
        child.kill();
        reject(new Error('server did not respond within 5s'));
      }, 5000);
    });

    expect(output).toContain('anaf_auth_login');
    expect(output).toContain('anaf_auth_complete');
    expect(output).toContain('anaf_switch_company');
    expect(output).toContain('anaf_lookup_company');
    expect(output).toContain('anaf_build_ubl');
    expect(output).toContain('anaf_validate_xml');
    expect(output).toContain('anaf_upload_invoice');
    expect(output).toContain('anaf_invoice_status');
    expect(output).toContain('anaf_download_invoice');
    expect(output).toContain('anaf_list_messages');
  }, 10000);
});
