/**
 * Manifest mode public types (P3.1 / P3.2 / P3.6).
 *
 * A manifest is a YAML or JSON document that describes a single CLI action
 * so it can be executed by `anaf-cli run -f <file>`. The supported `kind`
 * values map 1:1 onto the normalized action types in `cli/src/actions/`.
 *
 * The FROZEN public API is:
 *   - `ManifestKind`          : string literal union of the supported kinds
 *   - `ManifestDocument`      : the shape after parsing + schema validation
 *
 * Future breaking changes to the manifest format bump `apiVersion` past
 * `anaf-cli/v1`. This file never removes fields — it only adds them.
 */

export type ManifestKind = 'UblBuild' | 'EFacturaUpload';

export interface ManifestOutputTarget {
  mode?: 'stdout' | 'file';
  path?: string;
}

export interface ManifestDocument {
  apiVersion: 'anaf-cli/v1';
  kind: ManifestKind;
  /**
   * Optional top-level context. When set it overrides any `context` field on
   * the inner `spec`. When absent, the inner `spec.context` is used (and the
   * action normalizer rejects empty strings with `INVALID_*_INPUT`).
   */
  context?: string;
  spec: Record<string, unknown>;
  output?: ManifestOutputTarget;
}
