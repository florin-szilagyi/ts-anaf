import os from 'node:os';
import path from 'node:path';

export interface XdgRoots {
  configHome: string;
  dataHome: string;
  cacheHome: string;
}

export interface XdgPaths {
  configHome: string;
  dataHome: string;
  cacheHome: string;
  appConfigDir: string;
  appDataDir: string;
  appCacheDir: string;
  configFile: string;
  credentialFile: string;
  fastbillCredentialFile: string;
  companiesDir: string;
  tokensDir: string;
  companyCacheDir: string;
  companyFile(cui: string): string;
  tokenFile(name: string): string;
  cacheFile(cui: string): string;
}

const APP_DIR = 'anaf-cli';

export function defaultXdgPaths(): XdgRoots {
  const home = os.homedir();
  return {
    configHome: process.env.XDG_CONFIG_HOME || path.join(home, '.config'),
    dataHome: process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'),
    cacheHome: process.env.XDG_CACHE_HOME || path.join(home, '.cache'),
  };
}

export function getXdgPaths(roots?: XdgRoots): XdgPaths {
  const r = roots ?? defaultXdgPaths();
  const appConfigDir = path.join(r.configHome, APP_DIR);
  const appDataDir = path.join(r.dataHome, APP_DIR);
  const appCacheDir = path.join(r.cacheHome, APP_DIR);
  const companiesDir = path.join(appConfigDir, 'companies');
  const tokensDir = path.join(appDataDir, 'tokens');
  const companyCacheDir = path.join(appCacheDir, 'company-cache');
  return {
    configHome: r.configHome,
    dataHome: r.dataHome,
    cacheHome: r.cacheHome,
    appConfigDir,
    appDataDir,
    appCacheDir,
    configFile: path.join(appConfigDir, 'config.yaml'),
    credentialFile: path.join(appConfigDir, 'credential.yaml'),
    fastbillCredentialFile: path.join(appConfigDir, 'fastbill.json'),
    companiesDir,
    tokensDir,
    companyCacheDir,
    companyFile: (cui: string) => path.join(companiesDir, `${cui}.yaml`),
    tokenFile: (name: string) => path.join(tokensDir, `${name}.json`),
    cacheFile: (cui: string) => path.join(companyCacheDir, `${cui}.json`),
  };
}
