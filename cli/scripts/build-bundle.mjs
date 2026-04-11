import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

await build({
  entryPoints: [path.join(root, 'src/bin/anaf-cli.ts')],
  outfile: path.join(root, 'dist/bin/anaf-cli.cjs'),
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  bundle: true,
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  // Note (P1.1 deviation): esbuild@^0.21 preserves the shebang from the TS
  // source entry point for platform: 'node' CJS builds, so re-adding it via
  // `banner` produces a double-shebang that fails to parse. We rely on the
  // source shebang and drop the banner.
  logLevel: 'info',
});

console.log('bundle written to dist/bin/anaf-cli.cjs');
