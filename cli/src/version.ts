// Read at build time via tsc's resolveJsonModule.
// The literal is the SoT for the CLI's user-visible version.
import pkg from '../package.json';

export const CLI_VERSION: string = (pkg as { version: string }).version;
export const CLI_NAME = 'anaf-cli';
