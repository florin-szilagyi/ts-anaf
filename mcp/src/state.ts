import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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

export function resolvePaths(roots?: CliStateRoots): ResolvedPaths {
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

export function readCliState(roots?: CliStateRoots, credentialOverride?: CredentialOverride): CliState {
  const paths = resolvePaths(roots);

  let credential: CliCredential;
  if (credentialOverride?.clientId && credentialOverride?.redirectUri) {
    credential = { clientId: credentialOverride.clientId, redirectUri: credentialOverride.redirectUri };
  } else {
    const credentialRaw = readYamlObject(paths.credentialFile);
    const clientId = credentialOverride?.clientId ?? asOptionalString(credentialRaw?.clientId);
    const redirectUri = credentialOverride?.redirectUri ?? asOptionalString(credentialRaw?.redirectUri);
    if (!clientId || !redirectUri) {
      throw new McpToolError({
        code: 'CONFIG_MISSING',
        message:
          'ANAF credential not configured. Either set ANAF_CLIENT_ID and ANAF_REDIRECT_URI env vars, ' +
          'or run `anaf-cli cred set` with clientId and redirectUri.',
        category: 'config_missing',
        details: { path: paths.credentialFile },
      });
    }
    credential = {
      clientId,
      redirectUri,
      clientSecret: asOptionalString(credentialRaw?.clientSecret),
    };
  }

  const configRaw = readYamlObject(paths.configFile) ?? {};
  const activeCui = asOptionalString(configRaw.activeCui);
  if (!activeCui) {
    throw new McpToolError({
      code: 'NO_ACTIVE_COMPANY',
      message: 'No active company set. Call anaf_auth_login or anaf_switch_company first.',
      category: 'config_missing',
      details: { path: paths.configFile },
    });
  }

  const tokenRaw = readJsonObject(paths.tokenFile);
  const refreshToken = asOptionalString(tokenRaw?.refreshToken);
  if (!refreshToken) {
    throw new McpToolError({
      code: 'NO_REFRESH_TOKEN',
      message: 'No refresh token found. Call anaf_auth_login and anaf_auth_complete first.',
      category: 'auth',
      details: { path: paths.tokenFile },
    });
  }

  const env = asOptionalString(configRaw.env) === 'prod' ? 'prod' : 'test';

  return {
    activeCui,
    env,
    credential,
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

// ── Credential env-var override ──────────────────────────────────────────────

export interface CredentialOverride {
  clientId?: string;
  redirectUri?: string;
}

export function resolveCredentialFromEnv(env: {
  ANAF_CLIENT_ID?: string;
  ANAF_REDIRECT_URI?: string;
}): CredentialOverride {
  return {
    clientId: env.ANAF_CLIENT_ID || undefined,
    redirectUri: env.ANAF_REDIRECT_URI || undefined,
  };
}

// ── tlsDir helper ─────────────────────────────────────────────────────────────

export function resolveTlsDir(roots?: CliStateRoots): string {
  const home = os.homedir();
  const dataHome = roots?.dataHome ?? process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
  return path.join(dataHome, APP_DIR, 'tls');
}

export function resolveCompaniesDir(roots?: CliStateRoots): string {
  const home = os.homedir();
  const configHome = roots?.configHome ?? process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  return path.join(configHome, APP_DIR, 'companies');
}

// ── Config write helpers ──────────────────────────────────────────────────────

export function writeActiveCui(paths: ResolvedPaths, cui: string): void {
  const existing = readYamlObject(paths.configFile) ?? {};
  const updated = { ...existing, activeCui: cui };
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
  fs.writeFileSync(paths.configFile, stringifyYaml(updated), 'utf8');
}

// ── Full token write (after initial OAuth code exchange) ──────────────────────

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function writeFullToken(paths: ResolvedPaths, tokenResponse: OAuthTokenResponse): void {
  const obtainedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();
  const record: CliTokenRecord = {
    refreshToken: tokenResponse.refresh_token,
    accessToken: tokenResponse.access_token,
    expiresAt,
    obtainedAt,
  };
  fs.mkdirSync(path.dirname(paths.tokenFile), { recursive: true });
  const tmpPath = `${paths.tokenFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), { mode: 0o600 });
  if (process.platform !== 'win32') {
    fs.chmodSync(tmpPath, 0o600);
  }
  fs.renameSync(tmpPath, paths.tokenFile);
}
