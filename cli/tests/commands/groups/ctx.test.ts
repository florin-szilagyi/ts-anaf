import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { buildProgram } from '../../../src/commands/buildProgram';
import { ContextService } from '../../../src/state';
import { getXdgPaths } from '../../../src/state/paths';
import { CliError } from '../../../src/output/errors';
import { makeOutputContext } from '../../../src/output';
import { ctxLs, ctxCurrent, ctxUse, ctxAdd, ctxRm, ctxRename } from '../../../src/commands/groups/ctx';
import type { Context } from '../../../src/state';

class Cap extends Writable {
  buf = '';
  _write(c: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.buf += c.toString('utf8');
    cb();
  }
}

function harness(): {
  dir: string;
  paths: ReturnType<typeof getXdgPaths>;
  contextService: ContextService;
  stdout: Cap;
  stderr: Cap;
  text: ReturnType<typeof makeOutputContext>;
  json: ReturnType<typeof makeOutputContext>;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ctx-handler-'));
  const paths = getXdgPaths({
    configHome: path.join(dir, 'config'),
    dataHome: path.join(dir, 'data'),
    cacheHome: path.join(dir, 'cache'),
  });
  const contextService = new ContextService({ paths });
  const stdout = new Cap();
  const stderr = new Cap();
  const text = makeOutputContext({ format: 'text', streams: { stdout, stderr } });
  const json = makeOutputContext({ format: 'json', streams: { stdout, stderr } });
  return { dir, paths, contextService, stdout, stderr, text, json };
}

const sampleCtx = (name = 'acme-prod'): Context => ({
  name,
  companyCui: 'RO12345678',
  environment: 'prod',
  auth: { clientId: 'cid', redirectUri: 'https://localhost/cb' },
});

describe('ctx group', () => {
  it('registers ls, use, current, add, rm, rename', () => {
    const h = harness();
    const program = buildProgram({
      output: makeOutputContext({ format: 'text' }),
      services: { contextService: h.contextService },
    });
    const ctx = program.commands.find((c) => c.name() === 'ctx')!;
    expect(ctx.commands.map((c) => c.name()).sort()).toEqual(['add', 'current', 'ls', 'rename', 'rm', 'use']);
  });
});

describe('ctxLs', () => {
  it('text mode prints "(no contexts)" when none exist', async () => {
    const h = harness();
    await ctxLs({ output: h.text, services: { contextService: h.contextService } });
    expect(h.stdout.buf).toContain('(no contexts)');
  });

  it('text mode lists contexts with a current marker', async () => {
    const h = harness();
    h.contextService.add(sampleCtx('acme-prod'));
    h.contextService.add(sampleCtx('acme-test'));
    // Mark acme-prod as current via the underlying ConfigStore.
    fs.writeFileSync(h.paths.configFile, 'currentContext: acme-prod\n');
    await ctxLs({ output: h.text, services: { contextService: h.contextService } });
    const lines = h.stdout.buf.split('\n').filter(Boolean);
    expect(lines.some((l) => l.includes('* acme-prod'))).toBe(true);
    expect(lines.some((l) => l.includes('  acme-test'))).toBe(true);
    // ensures both CUIs surfaced
    expect(h.stdout.buf).toContain('RO12345678');
  });

  it('json mode emits an envelope with the context list', async () => {
    const h = harness();
    h.contextService.add(sampleCtx('acme-prod'));
    await ctxLs({ output: h.json, services: { contextService: h.contextService } });
    const parsed = JSON.parse(h.stdout.buf);
    expect(parsed.success).toBe(true);
    expect(parsed.data.contexts).toHaveLength(1);
    expect(parsed.data.contexts[0].name).toBe('acme-prod');
    expect(parsed.data.current).toBeUndefined();
  });
});

describe('ctxCurrent', () => {
  it('throws NO_CURRENT_CONTEXT when no current is set', async () => {
    const h = harness();
    await expect(ctxCurrent({ output: h.text, services: { contextService: h.contextService } })).rejects.toBeInstanceOf(
      CliError
    );
  });

  it('text mode prints the current context name', async () => {
    const h = harness();
    h.contextService.add(sampleCtx('acme-prod'));
    fs.writeFileSync(h.paths.configFile, 'currentContext: acme-prod\n');
    await ctxCurrent({ output: h.text, services: { contextService: h.contextService } });
    expect(h.stdout.buf.trim()).toBe('acme-prod');
  });

  it('json mode emits the current context envelope', async () => {
    const h = harness();
    h.contextService.add(sampleCtx('acme-prod'));
    fs.writeFileSync(h.paths.configFile, 'currentContext: acme-prod\n');
    await ctxCurrent({ output: h.json, services: { contextService: h.contextService } });
    const parsed = JSON.parse(h.stdout.buf);
    expect(parsed.data.name).toBe('acme-prod');
  });
});

describe('ctxUse', () => {
  it('sets the currentContext and confirms', async () => {
    const h = harness();
    h.contextService.add(sampleCtx('acme-prod'));
    await ctxUse({ output: h.text, services: { contextService: h.contextService } }, 'acme-prod');
    // verify on disk
    expect(fs.readFileSync(h.paths.configFile, 'utf8')).toContain('currentContext: acme-prod');
    expect(h.stdout.buf).toContain('acme-prod');
  });

  it('throws CONTEXT_NOT_FOUND when the named context does not exist', async () => {
    const h = harness();
    await expect(ctxUse({ output: h.text, services: { contextService: h.contextService } }, 'nope')).rejects.toThrow(
      CliError
    );
  });
});

describe('ctxAdd', () => {
  it('creates a context from option flags and confirms', async () => {
    const h = harness();
    await ctxAdd(
      { output: h.text, services: { contextService: h.contextService } },
      {
        name: 'acme-prod',
        cui: 'RO12345678',
        clientId: 'cid',
        redirectUri: 'https://localhost/cb',
        env: 'prod',
      }
    );
    expect(h.contextService.exists('acme-prod')).toBe(true);
    expect(h.contextService.get('acme-prod').auth.clientId).toBe('cid');
  });

  it('throws USER_INPUT BAD_USAGE when required options are missing', async () => {
    const h = harness();
    let err: unknown;
    try {
      await ctxAdd({ output: h.text, services: { contextService: h.contextService } }, { name: 'acme-prod' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).category).toBe('user_input');
  });

  it('rejects --env values other than test/prod', async () => {
    const h = harness();
    await expect(
      ctxAdd(
        { output: h.text, services: { contextService: h.contextService } },
        {
          name: 'acme-prod',
          cui: 'RO1',
          clientId: 'c',
          redirectUri: 'https://x',
          env: 'staging',
        }
      )
    ).rejects.toBeInstanceOf(CliError);
  });
});

describe('ctxRm', () => {
  it('removes the context', async () => {
    const h = harness();
    h.contextService.add(sampleCtx('acme-prod'));
    await ctxRm({ output: h.text, services: { contextService: h.contextService } }, 'acme-prod');
    expect(h.contextService.exists('acme-prod')).toBe(false);
  });
});

describe('ctxRename', () => {
  it('renames a context', async () => {
    const h = harness();
    h.contextService.add(sampleCtx('acme-prod'));
    await ctxRename({ output: h.text, services: { contextService: h.contextService } }, 'acme-prod', 'acme-main');
    expect(h.contextService.exists('acme-main')).toBe(true);
    expect(h.contextService.exists('acme-prod')).toBe(false);
  });
});
