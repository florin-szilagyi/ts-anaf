export { buildProgram, type CommandDeps, type ServiceRegistry } from './buildProgram';
export { runProgram, type RunProgramOptions, normalizeThrown, classifyCommanderError } from './runProgram';
export { notImplemented, NotImplementedCode } from './notImplemented';
export {
  attachGlobalFlags,
  extractGlobalOpts,
  resolveOutputFormatFromOpts,
  GLOBAL_FLAG_NAMES,
  type GlobalOpts,
} from './flags';
