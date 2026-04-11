export type Environment = 'test' | 'prod';

export interface AuthConfig {
  clientId: string;
  redirectUri: string;
}

export interface ContextDefaults {
  currency?: string;
  output?: 'stdout' | 'file';
}

export interface Context {
  name: string;
  companyCui: string;
  environment: Environment;
  auth: AuthConfig;
  defaults?: ContextDefaults;
}

export interface CliConfigDefaults {
  output?: 'stdout' | 'file';
  format?: 'text' | 'json';
}

export interface CliConfig {
  currentContext?: string;
  defaults?: CliConfigDefaults;
}

export interface TokenRecord {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: string;
  obtainedAt?: string;
}
