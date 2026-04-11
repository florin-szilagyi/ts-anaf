import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { CliError } from '../output/errors';
import { manifestDocumentSchema } from './schemas';
import type { ManifestDocument } from './types';

/**
 * Read a manifest file from disk and return the validated document. The
 * format hint is derived from the file extension — `.json` uses `JSON.parse`,
 * everything else (including `.yml`, `.yaml`, and extensionless files) goes
 * through the `yaml` package.
 */
export function parseManifestFile(filePath: string): ManifestDocument {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (cause) {
    throw new CliError({
      code: 'INVALID_MANIFEST_FILE',
      message: `Failed to read manifest file "${filePath}": ${(cause as Error).message}`,
      category: 'user_input',
      details: { path: filePath },
    });
  }
  const hint: 'yaml' | 'json' = filePath.endsWith('.json') ? 'json' : 'yaml';
  return parseManifestString(raw, hint);
}

/**
 * Parse a manifest body and validate it against `manifestDocumentSchema`.
 *
 * Error priority on validation failure (checked in this order):
 *   1. `UNSUPPORTED_API_VERSION` — apiVersion is wrong
 *   2. `UNKNOWN_MANIFEST_KIND`   — kind is not in the enum
 *   3. `INVALID_MANIFEST_DOCUMENT` — anything else
 *
 * An empty body deserializes to `undefined` via `yaml.parse`, which we treat
 * as a parse failure — an empty manifest is never valid.
 */
export function parseManifestString(body: string, hint: 'yaml' | 'json' = 'yaml'): ManifestDocument {
  let parsed: unknown;
  try {
    parsed = hint === 'json' ? JSON.parse(body) : parseYaml(body);
  } catch (cause) {
    throw new CliError({
      code: 'INVALID_MANIFEST_FILE',
      message: `Failed to parse manifest: ${(cause as Error).message}`,
      category: 'user_input',
    });
  }
  if (parsed === undefined || parsed === null) {
    throw new CliError({
      code: 'INVALID_MANIFEST_FILE',
      message: 'Manifest is empty',
      category: 'user_input',
    });
  }

  const result = manifestDocumentSchema.safeParse(parsed);
  if (!result.success) {
    const apiVersionIssue = result.error.issues.find((i) => i.path[0] === 'apiVersion');
    if (apiVersionIssue) {
      throw new CliError({
        code: 'UNSUPPORTED_API_VERSION',
        message: "apiVersion must be 'anaf-cli/v1'",
        category: 'user_input',
        details: { issues: result.error.issues },
      });
    }
    const kindIssue = result.error.issues.find((i) => i.path[0] === 'kind');
    if (kindIssue) {
      throw new CliError({
        code: 'UNKNOWN_MANIFEST_KIND',
        message: 'kind must be UblBuild or EFacturaUpload',
        category: 'user_input',
        details: { issues: result.error.issues },
      });
    }
    throw new CliError({
      code: 'INVALID_MANIFEST_DOCUMENT',
      message: `Manifest failed validation: ${result.error.message}`,
      category: 'user_input',
      details: { issues: result.error.issues },
    });
  }
  return result.data;
}
