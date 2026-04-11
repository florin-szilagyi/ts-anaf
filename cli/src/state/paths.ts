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
  contextsDir: string;
  tokensDir: string;
  companyCacheDir: string;
  contextFile(name: string): string;
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
  const contextsDir = path.join(appConfigDir, 'contexts');
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
    contextsDir,
    tokensDir,
    companyCacheDir,
    contextFile: (name: string) => path.join(contextsDir, `${name}.yaml`),
    tokenFile: (name: string) => path.join(tokensDir, `${name}.json`),
    cacheFile: (cui: string) => path.join(companyCacheDir, `${cui}.json`),
  };
}
