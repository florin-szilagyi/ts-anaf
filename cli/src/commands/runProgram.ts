import { CommanderError } from 'commander';
import { buildProgram, type ServiceRegistry } from './buildProgram';
import { CompanyService, ConfigStore, CredentialService, TokenStore, getXdgPaths } from '../state';
import { LookupService, AuthService, EfacturaService, UblService, FastbillService } from '../services';
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
import { installVerboseFetch } from '../output/verbose';

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

interface PreParsedFlags {
  format: OutputFormat;
  verbose: boolean;
}

function preParseFlags(argv: readonly string[]): PreParsedFlags {
  let format: OutputFormat = 'text';
  let verbose = false;
  const tokens = argv.slice(2);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '--') break;
    if (tok === '--format' && i + 1 < tokens.length) {
      const fmt = tokens[i + 1];
      if (fmt === 'json' || fmt === 'yaml' || fmt === 'text') format = fmt;
    }
    if (tok === '--verbose') verbose = true;
  }
  return { format, verbose };
}

const COMMANDER_SUCCESS_CODES: ReadonlySet<string> = new Set([
  'commander.helpDisplayed',
  'commander.help',
  'commander.version',
]);

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
  let output: OutputContext = makeOutputContext({ format: 'text', streams });

  let teardownVerbose: (() => void) | undefined;
  try {
    const flags = preParseFlags(options.argv);
    output = makeOutputContext({ format: flags.format, streams });
    if (flags.verbose) teardownVerbose = installVerboseFetch(streams);

    const paths = getXdgPaths();
    const companyService = options.services?.companyService ?? new CompanyService({ paths });
    const credentialService = options.services?.credentialService ?? new CredentialService({ paths });
    const configStore = options.services?.configStore ?? new ConfigStore({ paths });
    const tokenStore = options.services?.tokenStore ?? new TokenStore({ paths });
    const lookupService = options.services?.lookupService ?? new LookupService({ paths });
    const authService =
      options.services?.authService ?? new AuthService({ credentialService, companyService, configStore, tokenStore });
    const services: ServiceRegistry = {
      companyService,
      credentialService,
      configStore,
      lookupService,
      tokenStore,
      authService,
      efacturaService:
        options.services?.efacturaService ??
        new EfacturaService({ companyService, credentialService, configStore, tokenStore, lookupService }),
      ublService: options.services?.ublService ?? new UblService({ companyService, configStore, lookupService }),
      fastbillService: options.services?.fastbillService ?? new FastbillService({ paths }),
    };

    const program = buildProgram({
      output,
      services,
      paths,
    });

    // exitOverride + configureOutput are set by buildProgram's
    // strictifyCommands walk on every command (including leaves).
    // Redirect --help / --version output to the caller's streams.
    program.configureOutput({
      writeOut: (s: string) => streams.stdout.write(s),
      writeErr: (s: string) => streams.stderr.write(s),
    });

    await program.parseAsync(options.argv as string[]);
    teardownVerbose?.();
    exit(EXIT_CODES.SUCCESS);
  } catch (raw) {
    teardownVerbose?.();
    if (raw instanceof CommanderError) {
      const wrapped = classifyCommanderError(raw);
      if (wrapped === null) {
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
