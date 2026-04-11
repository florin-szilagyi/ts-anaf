import { CommanderError } from 'commander';
import { buildProgram, type ServiceRegistry } from './buildProgram';
import {
  CliError,
  EXIT_CODES,
  errorToExit,
  makeOutputContext,
  renderError,
  type OutputContext,
  type WriteStreams,
  type OutputFormat,
} from '../output';

export interface RunProgramOptions {
  argv: readonly string[];
  streams?: WriteStreams;
  exit?: (code: number) => void;
  services?: Partial<ServiceRegistry>;
}

export function normalizeThrown(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  return new Error(String(value));
}

function preParseFormat(argv: readonly string[]): OutputFormat {
  // The --json flag is global. We need to know it BEFORE we build
  // the OutputContext that the leaves use, so we scan argv linearly.
  // commander stops option parsing at the first `--`, so do we.
  for (const tok of argv.slice(2)) {
    if (tok === '--') return 'text';
    if (tok === '--json') return 'json';
  }
  return 'text';
}

// Commander 12 CommanderError code inventory (from commander/lib/command.js).
//
// Success-side codes — program completed its intent (help/version), no error envelope.
const COMMANDER_SUCCESS_CODES: ReadonlySet<string> = new Set([
  'commander.helpDisplayed',
  'commander.help',
  'commander.version',
]);

// User-input codes — the user gave the CLI bad input; these map to BAD_USAGE / exit 2.
const COMMANDER_USER_INPUT_CODES: ReadonlySet<string> = new Set([
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
]);

/**
 * Classify a commander error into the CLI's error taxonomy.
 *
 * Returns `null` for success-side codes (help/version) — caller should exit 0.
 * Returns a `CliError` for every other code:
 *   - user-input codes become `BAD_USAGE` (category: `user_input`, exit 2)
 *   - everything else (including `commander.executeSubCommandAsync` and any
 *     future commander code) becomes `COMMANDER_ERROR` (category: `generic`,
 *     exit 1) so generic execution failures are not mis-attributed to the user.
 */
export function classifyCommanderError(raw: CommanderError): CliError | null {
  if (COMMANDER_SUCCESS_CODES.has(raw.code)) {
    return null;
  }
  const isUserInput = COMMANDER_USER_INPUT_CODES.has(raw.code);
  return new CliError({
    code: isUserInput ? 'BAD_USAGE' : 'COMMANDER_ERROR',
    message: raw.message,
    category: isUserInput ? 'user_input' : 'generic',
    details: { commanderCode: raw.code },
  });
}

export async function runProgram(options: RunProgramOptions): Promise<void> {
  const streams: WriteStreams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const exit = options.exit ?? ((code: number) => process.exit(code));
  // Build a fallback text-mode OutputContext immediately so the catch block
  // always has somewhere to render, even if a setup-phase call throws before
  // we've resolved the real format. It is replaced inside the try block as
  // soon as we know whether the caller asked for --json.
  let output: OutputContext = makeOutputContext({ format: 'text', streams });

  try {
    const format = preParseFormat(options.argv);
    output = makeOutputContext({ format, streams });

    const program = buildProgram({
      output,
      services: (options.services ?? {}) as ServiceRegistry,
    });

    // Make commander throw instead of calling process.exit so we can
    // surface --version, --help, and validation errors through our handler.
    program.exitOverride();
    // Route commander's stderr/stdout writes through the injected streams,
    // so --version and --help land on the captured stdout in tests.
    //
    // IMPORTANT: `outputError` is suppressed. Commander's `Command.error()`
    // uses it to auto-emit a plain-text "error: ..." line BEFORE throwing the
    // CommanderError. We catch that CommanderError below and render our own
    // envelope (text or JSON). Letting commander's plain-text line through
    // would corrupt JSON-mode stderr with a non-JSON prefix and produce
    // duplicate output in text mode. Suppressing `outputError` does NOT
    // affect --help / --version (both route through `writeOut`).
    program.configureOutput({
      writeOut: (s: string) => {
        streams.stdout.write(s);
      },
      writeErr: (s: string) => {
        streams.stderr.write(s);
      },
      outputError: (_str: string, _write: (s: string) => void) => {
        // Intentionally empty: runProgram renders the error envelope in the catch below.
      },
    });

    await program.parseAsync(options.argv as string[]);
    exit(EXIT_CODES.SUCCESS);
  } catch (raw) {
    if (raw instanceof CommanderError) {
      const wrapped = classifyCommanderError(raw);
      if (wrapped === null) {
        // help / version — successful completion
        exit(EXIT_CODES.SUCCESS);
        return;
      }
      renderError(output, wrapped);
      exit(errorToExit(wrapped));
      return;
    }
    const normalized = normalizeThrown(raw);
    renderError(output, normalized);
    exit(errorToExit(normalized));
  }
}
