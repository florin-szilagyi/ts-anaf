import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseYaml } from 'yaml';
import { McpToolError } from './errors.js';

export type Environment = 'test' | 'prod';

export interface CliStateRoots {
  configHome?: string;
  dataHome?: string;
}

export interface CliCredential {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

export interface CliTokenRecord {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: string;
  obtainedAt?: string;
}

export interface CliState {
  activeCui: string;
  env: Environment;
  credential: CliCredential;
  token: CliTokenRecord;
  paths: ResolvedPaths;
}

export interface ResolvedPaths {
  configFile: string;
  credentialFile: string;
  tokenFile: string;
}

const APP_DIR = 'anaf-cli';
const TOKEN_KEY = '_default';

function resolvePaths(roots?: CliStateRoots): ResolvedPaths {
  const home = os.homedir();
  const configHome = roots?.configHome ?? process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  const dataHome = roots?.dataHome ?? process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
  const appConfigDir = path.join(configHome, APP_DIR);
  const appDataDir = path.join(dataHome, APP_DIR);
  return {
    configFile: path.join(appConfigDir, 'config.yaml'),
    credentialFile: path.join(appConfigDir, 'credential.yaml'),
    tokenFile: path.join(appDataDir, 'tokens', `${TOKEN_KEY}.json`),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readYamlObject(file: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(file)) return undefined;
  const raw = fs.readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (cause) {
    throw new McpToolError({
      code: 'CONFIG_CORRUPT',
      message: `Failed to parse YAML at ${file}: ${(cause as Error).message}`,
      category: 'config_missing',
      details: { path: file },
    });
  }
  if (parsed == null) return {};
  if (!isPlainObject(parsed)) {
    throw new McpToolError({
      code: 'CONFIG_CORRUPT',
      message: `Expected a YAML mapping at ${file}, got ${typeof parsed}.`,
      category: 'config_missing',
      details: { path: file },
    });
  }
  return parsed;
}

function readJsonObject(file: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(file)) return undefined;
  const raw = fs.readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new McpToolError({
      code: 'CONFIG_CORRUPT',
      message: `Failed to parse JSON at ${file}: ${(cause as Error).message}`,
      category: 'config_missing',
      details: { path: file },
    });
  }
  if (!isPlainObject(parsed)) {
    throw new McpToolError({
      code: 'CONFIG_CORRUPT',
      message: `Expected a JSON object at ${file}, got ${Array.isArray(parsed) ? 'array' : typeof parsed}.`,
      category: 'config_missing',
      details: { path: file },
    });
  }
  return parsed;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function readCliState(roots?: CliStateRoots): CliState {
  const paths = resolvePaths(roots);

  const credentialRaw = readYamlObject(paths.credentialFile);
  const clientId = asOptionalString(credentialRaw?.clientId);
  const redirectUri = asOptionalString(credentialRaw?.redirectUri);
  if (!credentialRaw || !clientId || !redirectUri) {
    throw new McpToolError({
      code: 'CONFIG_MISSING',
      message: 'ANAF CLI credential file not found. Run `anaf-cli cred set` with clientId and redirectUri first.',
      category: 'config_missing',
      details: { path: paths.credentialFile },
    });
  }

  const configRaw = readYamlObject(paths.configFile) ?? {};
  const activeCui = asOptionalString(configRaw.activeCui);
  if (!activeCui) {
    throw new McpToolError({
      code: 'NO_ACTIVE_COMPANY',
      message: 'No active company set. Run `anaf-cli auth login <CUI>` or `anaf-cli auth use <CUI>` first.',
      category: 'config_missing',
      details: { path: paths.configFile },
    });
  }

  const tokenRaw = readJsonObject(paths.tokenFile);
  const refreshToken = asOptionalString(tokenRaw?.refreshToken);
  if (!refreshToken) {
    throw new McpToolError({
      code: 'NO_REFRESH_TOKEN',
      message: 'No refresh token persisted. Run `anaf-cli auth login <CUI>` first.',
      category: 'auth',
      details: { path: paths.tokenFile },
    });
  }

  const env = asOptionalString(configRaw.env) === 'prod' ? 'prod' : 'test';

  return {
    activeCui,
    env,
    credential: {
      clientId,
      clientSecret: asOptionalString(credentialRaw.clientSecret),
      redirectUri,
    },
    token: {
      refreshToken,
      accessToken: asOptionalString(tokenRaw?.accessToken),
      expiresAt: asOptionalString(tokenRaw?.expiresAt),
      obtainedAt: asOptionalString(tokenRaw?.obtainedAt),
    },
    paths,
  };
}

export interface ClientSecretSource {
  ANAF_CLIENT_SECRET?: string;
}

export function resolveClientSecret(env: ClientSecretSource, credentialSecret?: string): string {
  if (env.ANAF_CLIENT_SECRET && env.ANAF_CLIENT_SECRET.length > 0) {
    return env.ANAF_CLIENT_SECRET;
  }
  if (credentialSecret && credentialSecret.length > 0) return credentialSecret;
  throw new McpToolError({
    code: 'CLIENT_SECRET_MISSING',
    message: 'ANAF OAuth client secret missing. Set ANAF_CLIENT_SECRET in the MCP server env.',
    category: 'auth',
  });
}

export function writeRotatedRefreshToken(paths: ResolvedPaths, newToken: string): void {
  const existing = readJsonObject(paths.tokenFile);
  const merged: CliTokenRecord = {
    refreshToken: newToken,
    accessToken: asOptionalString(existing?.accessToken),
    expiresAt: asOptionalString(existing?.expiresAt),
    obtainedAt: asOptionalString(existing?.obtainedAt),
  };
  fs.mkdirSync(path.dirname(paths.tokenFile), { recursive: true });
  // Atomic write: write to tmp with 0600, then rename. Guarantees the final
  // file has 0600 perms even if a previous version existed with broader perms
  // (fs.writeFileSync({ mode }) only applies mode on create, not on overwrite).
  const tmpPath = `${paths.tokenFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  if (process.platform !== 'win32') {
    fs.chmodSync(tmpPath, 0o600);
  }
  fs.renameSync(tmpPath, paths.tokenFile);
}
