import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readCliState, resolveClientSecret, writeRotatedRefreshToken } from '../src/state.js';
import { McpToolError } from '../src/errors.js';

function mkTempXdg(): { configHome: string; dataHome: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-mcp-test-'));
  const configHome = path.join(root, 'config');
  const dataHome = path.join(root, 'data');
  fs.mkdirSync(path.join(configHome, 'anaf-cli'), { recursive: true });
  fs.mkdirSync(path.join(dataHome, 'anaf-cli', 'tokens'), { recursive: true });
  return {
    configHome,
    dataHome,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe('readCliState', () => {
  it('reads config.yaml, credential.yaml, and token file from CLI XDG paths', () => {
    const xdg = mkTempXdg();
    try {
      fs.writeFileSync(path.join(xdg.configHome, 'anaf-cli', 'config.yaml'), 'activeCui: "12345678"\nenv: test\n');
      fs.writeFileSync(
        path.join(xdg.configHome, 'anaf-cli', 'credential.yaml'),
        'clientId: "my-client-id"\nredirectUri: "https://localhost:3000/callback"\n'
      );
      fs.writeFileSync(
        path.join(xdg.dataHome, 'anaf-cli', 'tokens', '_default.json'),
        JSON.stringify({
          refreshToken: 'r-token',
          accessToken: 'a-token',
          expiresAt: '2099-01-01T00:00:00.000Z',
          obtainedAt: '2026-04-01T00:00:00.000Z',
        })
      );

      const state = readCliState({ configHome: xdg.configHome, dataHome: xdg.dataHome });

      expect(state.activeCui).toBe('12345678');
      expect(state.env).toBe('test');
      expect(state.credential.clientId).toBe('my-client-id');
      expect(state.credential.redirectUri).toBe('https://localhost:3000/callback');
      expect(state.token.refreshToken).toBe('r-token');
      expect(state.token.accessToken).toBe('a-token');
    } finally {
      xdg.cleanup();
    }
  });

  it('throws CONFIG_MISSING when credential file is absent', () => {
    const xdg = mkTempXdg();
    try {
      expect(() => readCliState({ configHome: xdg.configHome, dataHome: xdg.dataHome })).toThrow(McpToolError);
    } finally {
      xdg.cleanup();
    }
  });

  it('throws CONFIG_CORRUPT when credential YAML is malformed', () => {
    const xdg = mkTempXdg();
    try {
      fs.writeFileSync(path.join(xdg.configHome, 'anaf-cli', 'credential.yaml'), 'clientId: "x\n  bad: [unterminated');
      try {
        readCliState({ configHome: xdg.configHome, dataHome: xdg.dataHome });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(McpToolError);
        expect((err as McpToolError).code).toBe('CONFIG_CORRUPT');
      }
    } finally {
      xdg.cleanup();
    }
  });

  it('throws NO_ACTIVE_COMPANY when config has no activeCui', () => {
    const xdg = mkTempXdg();
    try {
      fs.writeFileSync(path.join(xdg.configHome, 'anaf-cli', 'config.yaml'), 'env: test\n');
      fs.writeFileSync(
        path.join(xdg.configHome, 'anaf-cli', 'credential.yaml'),
        'clientId: "x"\nredirectUri: "https://localhost:1/callback"\n'
      );
      fs.writeFileSync(
        path.join(xdg.dataHome, 'anaf-cli', 'tokens', '_default.json'),
        JSON.stringify({ refreshToken: 'r' })
      );
      expect(() => readCliState({ configHome: xdg.configHome, dataHome: xdg.dataHome })).toThrow(
        /NO_ACTIVE_COMPANY|no active/i
      );
    } finally {
      xdg.cleanup();
    }
  });
});

describe('resolveClientSecret', () => {
  it('returns env var value when set', () => {
    expect(resolveClientSecret({ ANAF_CLIENT_SECRET: 'sek' })).toBe('sek');
  });
  it('falls back to credentialSecret when env var is empty', () => {
    expect(resolveClientSecret({}, 'from-file')).toBe('from-file');
    expect(resolveClientSecret({ ANAF_CLIENT_SECRET: '' }, 'from-file')).toBe('from-file');
  });
  it('throws when both env var and credentialSecret are missing', () => {
    try {
      resolveClientSecret({});
      throw new Error('expected resolveClientSecret to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      expect((err as McpToolError).code).toBe('CLIENT_SECRET_MISSING');
    }
  });
});

describe('writeRotatedRefreshToken', () => {
  it('rewrites the token file with mode 0600 even if it previously had 0644', () => {
    if (process.platform === 'win32') {
      return; // POSIX-only invariant
    }
    const xdg = mkTempXdg();
    try {
      const tokenFile = path.join(xdg.dataHome, 'anaf-cli', 'tokens', '_default.json');
      fs.writeFileSync(
        tokenFile,
        JSON.stringify({ refreshToken: 'old', accessToken: 'a1', expiresAt: 'e1', obtainedAt: 'o1' })
      );
      fs.chmodSync(tokenFile, 0o644);

      const paths = {
        configFile: path.join(xdg.configHome, 'anaf-cli', 'config.yaml'),
        credentialFile: path.join(xdg.configHome, 'anaf-cli', 'credential.yaml'),
        tokenFile,
      };
      writeRotatedRefreshToken(paths, 'new');

      const stat = fs.statSync(tokenFile);
      expect((stat.mode & 0o777).toString(8)).toBe('600');

      const parsed = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      expect(parsed.refreshToken).toBe('new');
      expect(parsed.accessToken).toBe('a1');
      expect(parsed.expiresAt).toBe('e1');
    } finally {
      xdg.cleanup();
    }
  });
});
