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

function readYaml<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  const raw = fs.readFileSync(file, 'utf8');
  return (parseYaml(raw) ?? {}) as T;
}

function readJson<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as T;
}

export function readCliState(roots?: CliStateRoots): CliState {
  const paths = resolvePaths(roots);

  const credentialRaw = readYaml<Partial<CliCredential>>(paths.credentialFile);
  if (!credentialRaw || !credentialRaw.clientId || !credentialRaw.redirectUri) {
    throw new McpToolError({
      code: 'CONFIG_MISSING',
      message: 'ANAF CLI credential file not found. Run `anaf-cli cred set` with clientId and redirectUri first.',
      category: 'config_missing',
      details: { path: paths.credentialFile },
    });
  }

  const configRaw = readYaml<{ activeCui?: string; env?: Environment }>(paths.configFile) ?? {};
  if (!configRaw.activeCui) {
    throw new McpToolError({
      code: 'NO_ACTIVE_COMPANY',
      message: 'No active company set. Run `anaf-cli auth login <CUI>` or `anaf-cli auth use <CUI>` first.',
      category: 'config_missing',
      details: { path: paths.configFile },
    });
  }

  const tokenRaw = readJson<CliTokenRecord>(paths.tokenFile);
  if (!tokenRaw?.refreshToken) {
    throw new McpToolError({
      code: 'NO_REFRESH_TOKEN',
      message: 'No refresh token persisted. Run `anaf-cli auth login <CUI>` first.',
      category: 'auth',
      details: { path: paths.tokenFile },
    });
  }

  return {
    activeCui: configRaw.activeCui,
    env: configRaw.env ?? 'test',
    credential: {
      clientId: credentialRaw.clientId,
      clientSecret: credentialRaw.clientSecret,
      redirectUri: credentialRaw.redirectUri,
    },
    token: tokenRaw,
    paths,
  };
}

export function resolveClientSecret(env: NodeJS.ProcessEnv, credentialSecret?: string): string {
  if (env.ANAF_CLIENT_SECRET && env.ANAF_CLIENT_SECRET.length > 0) {
    return env.ANAF_CLIENT_SECRET;
  }
  if (credentialSecret && credentialSecret.length > 0) return credentialSecret;
  throw new McpToolError({
    code: 'CLIENT_SECRET_MISSING',
    message: 'CLIENT_SECRET_MISSING: ANAF OAuth client secret missing. Set ANAF_CLIENT_SECRET in the MCP server env.',
    category: 'auth',
  });
}

export function writeRotatedRefreshToken(paths: ResolvedPaths, newToken: string): void {
  const existing = readJson<CliTokenRecord>(paths.tokenFile);
  const merged: CliTokenRecord = {
    ...existing,
    refreshToken: newToken,
  };
  fs.mkdirSync(path.dirname(paths.tokenFile), { recursive: true });
  fs.writeFileSync(paths.tokenFile, JSON.stringify(merged, null, 2), { mode: 0o600 });
  if (process.platform !== 'win32') {
    fs.chmodSync(paths.tokenFile, 0o600);
  }
}

export { stringifyYaml };
