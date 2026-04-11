import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextService } from '../../src/state/contextService';
import { getXdgPaths } from '../../src/state/paths';
import { CliError } from '../../src/output/errors';
import type { Context } from '../../src/state/types';

function freshPaths(): ReturnType<typeof getXdgPaths> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ctx-'));
  return getXdgPaths({
    configHome: path.join(dir, 'config'),
    dataHome: path.join(dir, 'data'),
    cacheHome: path.join(dir, 'cache'),
  });
}

const sample = (name = 'acme-prod'): Context => ({
  name,
  companyCui: 'RO12345678',
  environment: 'prod',
  auth: { clientId: 'cid', redirectUri: 'https://localhost/cb' },
});

describe('ContextService', () => {
  it('list() returns [] on empty state', () => {
    const svc = new ContextService({ paths: freshPaths() });
    expect(svc.list()).toEqual([]);
  });

  it('add() persists a context and list/get find it', () => {
    const svc = new ContextService({ paths: freshPaths() });
    const created = svc.add(sample());
    expect(created.name).toBe('acme-prod');
    expect(svc.exists('acme-prod')).toBe(true);
    expect(svc.list()).toHaveLength(1);
    expect(svc.get('acme-prod')).toEqual(sample());
  });

  it('add() throws CONTEXT_EXISTS on duplicate', () => {
    const svc = new ContextService({ paths: freshPaths() });
    svc.add(sample());
    let err: unknown;
    try {
      svc.add(sample());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('CONTEXT_EXISTS');
  });

  it('get() throws CONTEXT_NOT_FOUND on missing', () => {
    const svc = new ContextService({ paths: freshPaths() });
    let err: unknown;
    try {
      svc.get('nope');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('CONTEXT_NOT_FOUND');
  });

  it('add() rejects invalid names with CONTEXT_NAME_INVALID', () => {
    const svc = new ContextService({ paths: freshPaths() });
    let err: unknown;
    try {
      svc.add({ ...sample(), name: '../etc/passwd' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('CONTEXT_NAME_INVALID');
  });

  it('update() merges patches and persists', () => {
    const svc = new ContextService({ paths: freshPaths() });
    svc.add(sample());
    const updated = svc.update('acme-prod', { companyCui: 'RO99999999' });
    expect(updated.companyCui).toBe('RO99999999');
    expect(svc.get('acme-prod').companyCui).toBe('RO99999999');
  });

  it('rename() moves the file and preserves contents', () => {
    const svc = new ContextService({ paths: freshPaths() });
    svc.add(sample());
    const renamed = svc.rename('acme-prod', 'acme-main');
    expect(renamed.name).toBe('acme-main');
    expect(svc.exists('acme-prod')).toBe(false);
    expect(svc.exists('acme-main')).toBe(true);
    expect(svc.get('acme-main').companyCui).toBe('RO12345678');
  });

  it('rename() to existing name throws CONTEXT_EXISTS', () => {
    const svc = new ContextService({ paths: freshPaths() });
    svc.add(sample('acme-prod'));
    svc.add(sample('acme-test'));
    let err: unknown;
    try {
      svc.rename('acme-prod', 'acme-test');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('CONTEXT_EXISTS');
  });

  it('remove() deletes the file', () => {
    const svc = new ContextService({ paths: freshPaths() });
    svc.add(sample());
    svc.remove('acme-prod');
    expect(svc.exists('acme-prod')).toBe(false);
  });

  it('remove() also deletes a sibling token file if present', () => {
    const paths = freshPaths();
    const svc = new ContextService({ paths });
    svc.add(sample());
    fs.mkdirSync(paths.tokensDir, { recursive: true });
    fs.writeFileSync(paths.tokenFile('acme-prod'), '{"refreshToken":"rt"}');
    svc.remove('acme-prod');
    expect(fs.existsSync(paths.tokenFile('acme-prod'))).toBe(false);
  });

  it('resolve(explicit) returns the named context', () => {
    const svc = new ContextService({ paths: freshPaths() });
    svc.add(sample());
    expect(svc.resolve('acme-prod').name).toBe('acme-prod');
  });

  it('resolve() falls back to currentContext when no explicit name is given', () => {
    const paths = freshPaths();
    const svc = new ContextService({ paths });
    svc.add(sample());
    // simulate config.yaml setting currentContext
    fs.writeFileSync(paths.configFile, 'currentContext: acme-prod\n');
    expect(svc.resolve().name).toBe('acme-prod');
  });

  it('resolve() with no explicit and no current throws NO_CURRENT_CONTEXT', () => {
    const svc = new ContextService({ paths: freshPaths() });
    let err: unknown;
    try {
      svc.resolve();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('NO_CURRENT_CONTEXT');
  });

  it('setCurrent() pins the current context after validating it exists', () => {
    const paths = freshPaths();
    const svc = new ContextService({ paths });
    svc.add(sample('acme-prod'));
    svc.setCurrent('acme-prod');
    expect(svc.resolve().name).toBe('acme-prod');
  });

  it('setCurrent() throws CONTEXT_NOT_FOUND if the named context does not exist', () => {
    const svc = new ContextService({ paths: freshPaths() });
    let err: unknown;
    try {
      svc.setCurrent('nope');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('CONTEXT_NOT_FOUND');
  });
});
