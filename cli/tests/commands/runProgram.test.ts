import { Writable } from 'node:stream';
import { CommanderError } from 'commander';
import { runProgram, classifyCommanderError } from '../../src/commands/runProgram';
import { EXIT_CODES } from '../../src/output/exitCodes';
import { CliError } from '../../src/output/errors';

class Cap extends Writable {
  buf = '';
  _write(c: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.buf += c.toString('utf8');
    cb();
  }
}

function harness() {
  const stdout = new Cap();
  const stderr = new Cap();
  let exitCode: number | undefined;
  const exit = (code: number): void => {
    exitCode = code;
  };
  return {
    streams: { stdout, stderr },
    exit,
    stdout,
    stderr,
    code: () => exitCode,
  };
}

describe('runProgram', () => {
  it('exits 1 with NOT_IMPLEMENTED for a stub leaf in text mode', async () => {
    const h = harness();
    await runProgram({
      argv: ['node', 'anaf-cli', 'efactura', 'validate'],
      streams: h.streams,
      exit: h.exit,
    });
    expect(h.code()).toBe(EXIT_CODES.GENERIC_FAILURE);
    expect(h.stderr.buf).toContain('NOT_IMPLEMENTED');
    expect(h.stderr.buf).toContain('efactura validate');
    expect(h.stdout.buf).toBe('');
  });

  it('emits a JSON error envelope when --json is set', async () => {
    const h = harness();
    await runProgram({
      argv: ['node', 'anaf-cli', '--json', 'efactura', 'validate'],
      streams: h.streams,
      exit: h.exit,
    });
    expect(h.code()).toBe(EXIT_CODES.GENERIC_FAILURE);
    const parsed = JSON.parse(h.stderr.buf);
    expect(parsed).toMatchObject({
      success: false,
      error: { code: 'NOT_IMPLEMENTED' },
    });
  });

  it('--version exits 0 and writes the version to stdout', async () => {
    const h = harness();
    await runProgram({ argv: ['node', 'anaf-cli', '--version'], streams: h.streams, exit: h.exit });
    expect(h.code()).toBe(EXIT_CODES.SUCCESS);
    expect(h.stdout.buf.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('--help exits 0 and writes usage to stdout', async () => {
    const h = harness();
    await runProgram({ argv: ['node', 'anaf-cli', '--help'], streams: h.streams, exit: h.exit });
    expect(h.code()).toBe(EXIT_CODES.SUCCESS);
    expect(h.stdout.buf).toContain('Usage: anaf-cli');
  });

  it('unknown command exits 2 (USER_INPUT) with code BAD_USAGE', async () => {
    const h = harness();
    await runProgram({
      argv: ['node', 'anaf-cli', 'definitely-not-a-command'],
      streams: h.streams,
      exit: h.exit,
    });
    expect(h.code()).toBe(EXIT_CODES.USER_INPUT);
    expect(h.stderr.buf).toContain('BAD_USAGE');
  });

  it('normalizes a non-Error throw thrown by an action handler', async () => {
    const { normalizeThrown } = await import('../../src/commands/runProgram');
    expect(normalizeThrown('boom')).toBeInstanceOf(Error);
    expect(normalizeThrown('boom').message).toBe('boom');
    expect(normalizeThrown(42).message).toBe('42');
    expect(normalizeThrown(undefined).message).toBe('undefined');
    const original = new Error('original');
    expect(normalizeThrown(original)).toBe(original);
  });

  // --- B1: JSON envelope must not be corrupted by commander's auto-emitted error line ---
  it('unknown command in JSON mode emits a single valid JSON envelope on stderr (no commander noise)', async () => {
    const h = harness();
    await runProgram({
      argv: ['node', 'anaf-cli', '--json', 'definitely-not-a-command'],
      streams: h.streams,
      exit: h.exit,
    });
    expect(h.code()).toBe(EXIT_CODES.USER_INPUT);
    // Must not carry commander's plain-text "error: ..." prefix.
    expect(h.stderr.buf).not.toMatch(/^error:/);
    // Must parse as a single JSON document.
    const parsed = JSON.parse(h.stderr.buf);
    expect(parsed).toMatchObject({
      success: false,
      error: {
        code: 'BAD_USAGE',
        details: { commanderCode: 'commander.unknownCommand' },
      },
    });
    expect(typeof parsed.error.message).toBe('string');
  });

  it('unknown option in JSON mode emits a single valid JSON envelope on stderr', async () => {
    const h = harness();
    await runProgram({
      argv: ['node', 'anaf-cli', '--json', '--definitely-not-a-flag'],
      streams: h.streams,
      exit: h.exit,
    });
    expect(h.code()).toBe(EXIT_CODES.USER_INPUT);
    expect(h.stderr.buf).not.toMatch(/^error:/);
    const parsed = JSON.parse(h.stderr.buf);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('BAD_USAGE');
  });

  it("unknown command in text mode does NOT print commander's auto error line", async () => {
    const h = harness();
    await runProgram({
      argv: ['node', 'anaf-cli', 'definitely-not-a-command'],
      streams: h.streams,
      exit: h.exit,
    });
    expect(h.code()).toBe(EXIT_CODES.USER_INPUT);
    expect(h.stderr.buf).toMatch(/^BAD_USAGE:/);
    // Exactly one non-empty line — no leftover commander line above ours.
    const nonEmptyLines = h.stderr.buf.split('\n').filter(Boolean);
    expect(nonEmptyLines.length).toBe(1);
  });

  // --- B2: classifyCommanderError distinguishes user-input vs generic failures ---
  describe('classifyCommanderError', () => {
    it('returns null for success-side commander codes (help / version)', () => {
      for (const code of ['commander.helpDisplayed', 'commander.help', 'commander.version']) {
        const err = new CommanderError(0, code, 'ignored');
        expect(classifyCommanderError(err)).toBeNull();
      }
    });

    it('wraps user-input commander codes as BAD_USAGE (category: user_input)', () => {
      const codes = [
        'commander.error',
        'commander.missingArgument',
        'commander.optionMissingArgument',
        'commander.missingMandatoryOptionValue',
        'commander.conflictingOption',
        'commander.unknownOption',
        'commander.excessArguments',
        'commander.unknownCommand',
        'commander.invalidArgument',
        'commander.invalidOptionArgument',
      ];
      for (const code of codes) {
        const raw = new CommanderError(1, code, `commander said: ${code}`);
        const wrapped = classifyCommanderError(raw);
        expect(wrapped).toBeInstanceOf(CliError);
        expect(wrapped?.code).toBe('BAD_USAGE');
        expect(wrapped?.category).toBe('user_input');
        expect(wrapped?.message).toBe(`commander said: ${code}`);
        expect(wrapped?.details).toEqual({ commanderCode: code });
      }
    });

    it('wraps executeSubCommandAsync as a generic failure (category: generic, code: COMMANDER_ERROR)', () => {
      const raw = new CommanderError(1, 'commander.executeSubCommandAsync', 'subcommand crashed');
      const wrapped = classifyCommanderError(raw);
      expect(wrapped).toBeInstanceOf(CliError);
      expect(wrapped?.code).toBe('COMMANDER_ERROR');
      expect(wrapped?.category).toBe('generic');
      expect(wrapped?.message).toBe('subcommand crashed');
      expect(wrapped?.details).toEqual({ commanderCode: 'commander.executeSubCommandAsync' });
    });

    it('wraps unknown future commander codes as generic COMMANDER_ERROR', () => {
      const raw = new CommanderError(1, 'commander.somethingBrandNew', 'new thing happened');
      const wrapped = classifyCommanderError(raw);
      expect(wrapped?.code).toBe('COMMANDER_ERROR');
      expect(wrapped?.category).toBe('generic');
    });
  });

  // --- B3: setup-phase throws must not escape runProgram ---
  it('never rejects (always resolves) — belt-and-braces for setup-phase throws', async () => {
    // If setup-phase code throws synchronously, runProgram's try/catch must catch it.
    // Exercise via a streams.stdout.write that throws: any renderer/commander write
    // may bubble up before or during setup.
    const throwingStream = new Writable({
      write(_c: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
        cb(new Error('stdout exploded'));
      },
    });
    let wrote = '';
    const stderr = new Cap();
    // Force the write() call to throw synchronously inside commander's help emit.
    (throwingStream as unknown as { write: (s: string) => boolean }).write = (s: string): boolean => {
      wrote += s;
      throw new Error('stdout exploded');
    };
    let exitCode: number | undefined;
    await expect(
      runProgram({
        argv: ['node', 'anaf-cli', '--help'],
        streams: { stdout: throwingStream as unknown as NodeJS.WritableStream, stderr },
        exit: (c: number): void => {
          exitCode = c;
        },
      })
    ).resolves.toBeUndefined();
    // Either the error was caught and an exit was recorded, or the help text was partially written.
    // The key contract: the promise must NOT reject.
    expect(exitCode === undefined || typeof exitCode === 'number').toBe(true);
    expect(typeof wrote).toBe('string');
  });

  it('resolves cleanly when argv uses -- to separate option-likes', async () => {
    const h = harness();
    await expect(
      runProgram({
        argv: ['node', 'anaf-cli', '--', '--json'],
        streams: h.streams,
        exit: h.exit,
      })
    ).resolves.toBeUndefined();
    // With no subcommand and -- present, commander treats it as no-op / help-like.
    // We don't care about the specific exit code here — just that it resolved.
    expect(typeof h.code()).toBe('number');
  });
});
