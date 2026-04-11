import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TokenStore } from '../../src/state/tokenStore';
import { getXdgPaths } from '../../src/state/paths';
import { CliError } from '../../src/output/errors';

function freshPaths(): ReturnType<typeof getXdgPaths> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-tok-'));
  return getXdgPaths({
    configHome: path.join(dir, 'config'),
    dataHome: path.join(dir, 'data'),
    cacheHome: path.join(dir, 'cache'),
  });
}

describe('TokenStore', () => {
  it('read() returns undefined when no file exists', () => {
    const store = new TokenStore({ paths: freshPaths() });
    expect(store.read('acme')).toBeUndefined();
    expect(store.exists('acme')).toBe(false);
    expect(store.getRefreshToken('acme')).toBeUndefined();
  });

  it('write() persists the record and exists()/read() see it', () => {
    const paths = freshPaths();
    const store = new TokenStore({ paths });
    store.write('acme', { refreshToken: 'rt', accessToken: 'at', expiresAt: '2026-04-11T20:00:00Z' });
    expect(store.exists('acme')).toBe(true);
    expect(store.read('acme')).toEqual({
      refreshToken: 'rt',
      accessToken: 'at',
      expiresAt: '2026-04-11T20:00:00Z',
    });
  });

  it('write() sets file mode to 0600 on POSIX', () => {
    const paths = freshPaths();
    const store = new TokenStore({ paths });
    store.write('acme', { refreshToken: 'rt' });
    if (process.platform !== 'win32') {
      const mode = fs.statSync(paths.tokenFile('acme')).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('setRefreshToken() rotates the refresh token without losing other fields', () => {
    const store = new TokenStore({ paths: freshPaths() });
    store.write('acme', { refreshToken: 'rt-old', accessToken: 'at', expiresAt: '2026-04-11T20:00:00Z' });
    store.setRefreshToken('acme', 'rt-new');
    expect(store.getRefreshToken('acme')).toBe('rt-new');
    expect(store.read('acme')?.accessToken).toBe('at');
  });

  it('setRefreshToken() on a missing file creates one with only refreshToken', () => {
    const store = new TokenStore({ paths: freshPaths() });
    store.setRefreshToken('acme', 'rt');
    expect(store.read('acme')).toEqual({ refreshToken: 'rt' });
  });

  it('remove() deletes the file (idempotent)', () => {
    const store = new TokenStore({ paths: freshPaths() });
    store.write('acme', { refreshToken: 'rt' });
    store.remove('acme');
    expect(store.exists('acme')).toBe(false);
    // second remove must not throw
    store.remove('acme');
  });

  it('throws CliError(local_state, INVALID_TOKEN_FILE) on garbage JSON', () => {
    const paths = freshPaths();
    fs.mkdirSync(paths.tokensDir, { recursive: true });
    fs.writeFileSync(paths.tokenFile('acme'), '{not json');
    const store = new TokenStore({ paths });
    let err: unknown;
    try {
      store.read('acme');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('INVALID_TOKEN_FILE');
  });
});
