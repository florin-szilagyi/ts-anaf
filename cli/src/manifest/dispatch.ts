import {
  normalizeEfacturaUploadAction,
  normalizeUblBuildAction,
  type EfacturaUploadAction,
  type EfacturaUploadInput,
  type UblBuildAction,
  type UblBuildInput,
} from '../actions';
import { CliError } from '../output/errors';
import type { ManifestDocument } from './types';

export type NormalizedAction = UblBuildAction | EfacturaUploadAction;

/**
 * Convert a validated manifest document into a normalized action. The
 * top-level `context` on the manifest wins over any `context` field on the
 * inner spec — this makes it easy to keep the spec context-agnostic and
 * override it from the envelope or (later) from a `--context` CLI override.
 *
 * All deeper validation (schema, dates, CUI pattern, line parsing, …)
 * happens inside `normalizeUblBuildAction` / `normalizeEfacturaUploadAction`,
 * so failures here surface as the existing `INVALID_INVOICE_INPUT` /
 * `INVALID_UPLOAD_INPUT` codes — not as a new manifest-specific code.
 */
export function normalizeManifest(doc: ManifestDocument): NormalizedAction {
  if (doc.kind === 'UblBuild') {
    const spec = doc.spec as Record<string, unknown>;
    const specContext = typeof spec.context === 'string' ? spec.context : undefined;
    const { context: _ignored, ...rest } = spec;
    void _ignored;
    const input: UblBuildInput = {
      ...(rest as Omit<UblBuildInput, 'context' | 'output'>),
      context: doc.context ?? specContext ?? '',
      output: doc.output ?? (rest as { output?: UblBuildInput['output'] }).output,
    };
    return normalizeUblBuildAction(input);
  }
  if (doc.kind === 'EFacturaUpload') {
    const spec = doc.spec as {
      context?: unknown;
      source?: unknown;
      upload?: unknown;
      output?: unknown;
    };
    const specContext = typeof spec.context === 'string' ? spec.context : undefined;
    const input: EfacturaUploadInput = {
      context: doc.context ?? specContext ?? '',
      source: (spec.source ?? {}) as EfacturaUploadInput['source'],
      upload: (spec.upload ?? {}) as EfacturaUploadInput['upload'],
      output: doc.output ?? (spec.output as EfacturaUploadInput['output'] | undefined),
    };
    return normalizeEfacturaUploadAction(input);
  }
  // `kind` is a string literal union, but the caller may pass a stale value
  // if the schema evolves — throw a CliError so the CLI surfaces a proper
  // envelope rather than a raw TypeError.
  throw new CliError({
    code: 'UNKNOWN_MANIFEST_KIND',
    message: `Unknown manifest kind: ${String((doc as { kind?: unknown }).kind)}`,
    category: 'user_input',
  });
}
