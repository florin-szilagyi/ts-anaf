# Manifest mode (P3.1 + P3.2 + P3.6 combined)

> **Workstreams:** P3.1 (manifest parser), P3.2 (run + dry-run + schema print), P3.6 (manifest schemas + golden tests). Executed as a single commit because they're tightly coupled and share the same files.
>
> **Predecessors:** P2.1 action model, P2.2 UblService, P2.4 EfacturaService, P2.5 efactura commands.
> **Master plan:** `docs/superpowers/plans/2026-04-11-anaf-cli-phases.md`

**Goal:** Enable `anaf-cli run -f job.yaml` for AI agents and CI. The parser accepts YAML or JSON, dispatches by `apiVersion` + `kind` onto the existing action normalizers from P2.1, and runs through the same service layer as imperative commands. Adds `--dry-run` and `schema print <kind>`.

## Manifest format (design §12.3)

```yaml
apiVersion: anaf-cli/v1
kind: UblBuild          # or EFacturaUpload
context: acme-prod
spec: { ... }           # matches UblBuildInput or EfacturaUploadInput
output: { ... }         # matches OutputTarget
```

- `apiVersion: anaf-cli/v1` is the only accepted value. Future breaking changes bump the version.
- `kind: UblBuild` maps to `normalizeUblBuildAction({ context, ...spec, output })`.
- `kind: EFacturaUpload` maps to `normalizeEfacturaUploadAction({ context, ...spec, output })`.
- The manifest's top-level `context` is injected into the spec if absent.

## Public API (FROZEN)

```ts
// cli/src/manifest/types.ts
export type ManifestKind = 'UblBuild' | 'EFacturaUpload';

export interface ManifestDocument {
  apiVersion: 'anaf-cli/v1';
  kind: ManifestKind;
  context?: string;
  spec: Record<string, unknown>;
  output?: { mode?: 'stdout' | 'file'; path?: string };
}

// cli/src/manifest/parser.ts
export function parseManifestFile(filePath: string): ManifestDocument;
export function parseManifestString(body: string, hint?: 'yaml' | 'json'): ManifestDocument;

// cli/src/manifest/dispatch.ts
import type { UblBuildAction, EfacturaUploadAction } from '../actions';
export type NormalizedAction = UblBuildAction | EfacturaUploadAction;
export function normalizeManifest(doc: ManifestDocument): NormalizedAction;

// cli/src/manifest/schemas.ts
import { z } from 'zod';
export const manifestDocumentSchema: z.ZodType<ManifestDocument>;
export function printJsonSchemaForKind(kind: ManifestKind): string;

// cli/src/manifest/index.ts — barrel
```

**Error contract:**
- `INVALID_MANIFEST_FILE` — YAML/JSON parse failure (category `user_input`)
- `INVALID_MANIFEST_DOCUMENT` — schema validation failure (category `user_input`)
- `UNKNOWN_MANIFEST_KIND` — kind not in {UblBuild, EFacturaUpload}
- `UNSUPPORTED_API_VERSION` — apiVersion != 'anaf-cli/v1'

These codes go in `cli/src/output/errorCodes.ts` under `user_input`.

## Services

`ManifestService` is NOT a new thing with a lot of logic — it's a thin dispatcher. We can skip a separate service class and put the dispatch logic in `cli/src/manifest/dispatch.ts` + the run handler. The run handler:

```ts
export async function runManifest(deps: CommandDeps, opts: RunCmdOpts): Promise<void> {
  if (!opts.file) throw BAD_USAGE;
  const doc = parseManifestFile(opts.file);
  const action = normalizeManifest(doc);
  if (opts.dryRun) {
    renderSuccess(deps.output, action, (a) => JSON.stringify(a, null, 2));
    return;
  }
  // Dispatch by action.kind
  if (action.kind === 'ubl.build') {
    const result = await deps.services.ublService.buildFromAction(action);
    // write XML as with ubl build command — respect action.output
    ...
  } else if (action.kind === 'efactura.upload') {
    // Resolve XML source, call efacturaService.upload, render response
    ...
  }
}
```

For EFacturaUpload, the client secret still comes from `ANAF_CLIENT_SECRET` env (no manifest-level secret — we never put secrets in manifests).

## schema print

`schema print UblBuild` / `schema print EFacturaUpload` emits a JSON Schema generated from the zod schema. Use `zod-to-json-schema` — **but** we don't have that dep, and the design doc §23 says "YAML parser and schema validation library choice" is still an open decision. Two options:

1. Add `zod-to-json-schema` as a dep.
2. Hand-craft a minimal JSON Schema per kind, since we only support two kinds in v1.

Option 2 is simpler and pins the output we care about. Go with option 2 for v1; option 1 is a v1.1 upgrade when the manifest surface grows.

## Files

```text
cli/src/manifest/
  index.ts                # barrel
  types.ts
  parser.ts
  dispatch.ts
  schemas.ts              # zod manifestDocumentSchema + printJsonSchemaForKind
cli/src/commands/groups/
  run.ts                  # MODIFIED — real handler
  schema.ts               # MODIFIED — real handler
cli/src/output/errorCodes.ts  # MODIFIED — add 4 new codes under user_input
cli/tests/manifest/
  parser.test.ts
  dispatch.test.ts
  schemas.test.ts
  fixtures/
    ubl-build.yaml
    efactura-upload.yaml
    invalid-version.yaml
cli/tests/commands/groups/
  run.test.ts             # MODIFIED — handler tests
  schema.test.ts          # MODIFIED — handler tests
```

## Tasks (condensed — execute as TDD throughout)

### T1: Add new error codes

Edit `cli/src/output/errorCodes.ts` to add to `user_input`: `'INVALID_MANIFEST_FILE'`, `'INVALID_MANIFEST_DOCUMENT'`, `'UNKNOWN_MANIFEST_KIND'`, `'UNSUPPORTED_API_VERSION'`. The `errorCodes.test.ts` test `codes are unique across all categories` will still pass.

### T2: manifest/types.ts + schemas.ts

Create `manifestDocumentSchema` — a zod schema that validates:
- `apiVersion: z.literal('anaf-cli/v1')`
- `kind: z.enum(['UblBuild', 'EFacturaUpload'])`
- `context: z.string().optional()`
- `spec: z.record(z.unknown())` (loose — narrower check in dispatch)
- `output: z.object({ mode, path }).strict().optional()`
- `.strict()` on the top-level so unknown keys fail

Write `printJsonSchemaForKind(kind)` returning a hand-crafted JSON Schema string for UblBuild and EFacturaUpload. For UblBuild the schema describes: `invoiceNumber`, `issueDate`, `customerCui`, `lines[]` (string or object), `currency?`, `paymentIban?`, `note?`, `overrides?`, `dueDate?`. For EFacturaUpload: `source { xmlFile? | xmlStdin? | ublBuild? }`, `upload { standard?, isB2C?, isExecutare? }`.

Tests verify the function returns parseable JSON for each kind.

### T3: manifest/parser.ts

```ts
export function parseManifestFile(filePath: string): ManifestDocument {
  const raw = fs.readFileSync(filePath, 'utf8');
  const hint = filePath.endsWith('.json') ? 'json' : 'yaml';
  return parseManifestString(raw, hint);
}

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
  const result = manifestDocumentSchema.safeParse(parsed);
  if (!result.success) {
    // Check if it's specifically the apiVersion that failed
    const apiVersionIssue = result.error.issues.find((i) => i.path[0] === 'apiVersion');
    if (apiVersionIssue) {
      throw new CliError({
        code: 'UNSUPPORTED_API_VERSION',
        message: `apiVersion must be 'anaf-cli/v1'`,
        category: 'user_input',
      });
    }
    const kindIssue = result.error.issues.find((i) => i.path[0] === 'kind');
    if (kindIssue) {
      throw new CliError({
        code: 'UNKNOWN_MANIFEST_KIND',
        message: `kind must be UblBuild or EFacturaUpload`,
        category: 'user_input',
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
```

Tests cover: valid UblBuild manifest → parsed; valid EFacturaUpload → parsed; bad YAML → INVALID_MANIFEST_FILE; wrong apiVersion → UNSUPPORTED_API_VERSION; wrong kind → UNKNOWN_MANIFEST_KIND; missing spec → INVALID_MANIFEST_DOCUMENT.

### T4: manifest/dispatch.ts

```ts
export function normalizeManifest(doc: ManifestDocument): NormalizedAction {
  if (doc.kind === 'UblBuild') {
    const input = {
      context: doc.context ?? (doc.spec.context as string | undefined) ?? '',
      ...(doc.spec as object),
      output: doc.output,
    };
    return normalizeUblBuildAction(input as UblBuildInput);
  }
  if (doc.kind === 'EFacturaUpload') {
    const input = {
      context: doc.context ?? (doc.spec.context as string | undefined) ?? '',
      source: (doc.spec as { source?: unknown }).source ?? {},
      upload: (doc.spec as { upload?: unknown }).upload ?? {},
      output: doc.output,
    };
    return normalizeEfacturaUploadAction(input as EfacturaUploadInput);
  }
  throw unreachable(doc.kind);
}
```

Tests verify each kind produces the right action shape.

### T5: manifest/index.ts barrel

Re-exports all public API.

### T6: run command handler

`cli/src/commands/groups/run.ts`:

```ts
export async function runCommand(deps: CommandDeps, opts: RunCmdOpts): Promise<void> {
  if (!opts.file) throw BAD_USAGE;
  const doc = parseManifestFile(opts.file);
  const action = normalizeManifest(doc);
  if (opts.dryRun) {
    renderSuccess(deps.output, { action }, (d) => JSON.stringify(d.action, null, 2));
    return;
  }
  if (action.kind === 'ubl.build') {
    // Override context with resolved one if (current)
    const context = deps.services.contextService.resolve(action.context).name;
    const resolvedAction = { ...action, context };
    const result = await deps.services.ublService.buildFromAction(resolvedAction);
    // Honor action.output
    if (action.output.mode === 'file' && action.output.path) {
      fs.writeFileSync(action.output.path, result.xml, 'utf8');
      deps.output.streams.stderr.write(`wrote ${action.output.path}\n`);
      renderSuccess(
        deps.output,
        { invoiceNumber: action.invoice.invoiceNumber, xmlPath: action.output.path, xmlLength: result.xml.length },
        () => '',
      );
      return;
    }
    if (deps.output.format === 'json') {
      renderSuccess(deps.output, {
        invoiceNumber: action.invoice.invoiceNumber,
        xmlLength: result.xml.length,
        xmlPath: null,
        xml: result.xml,
      });
      return;
    }
    deps.output.streams.stdout.write(result.xml);
    if (!result.xml.endsWith('\n')) deps.output.streams.stdout.write('\n');
    return;
  }
  if (action.kind === 'efactura.upload') {
    // resolve XML
    let xml: string;
    if (action.source.type === 'xmlFile') {
      xml = fs.readFileSync(action.source.path, 'utf8');
    } else if (action.source.type === 'xmlStdin') {
      throw new CliError({
        code: 'BAD_USAGE',
        message: 'manifest EFacturaUpload with xmlStdin source is not supported in run mode',
        category: 'user_input',
      });
    } else {
      // ublBuild — recurse
      const sub = await deps.services.ublService.buildFromAction(action.source.build);
      xml = sub.xml;
    }
    const clientSecret = process.env.ANAF_CLIENT_SECRET;
    if (!clientSecret || clientSecret.length === 0) {
      throw new CliError({
        code: 'CLIENT_SECRET_MISSING',
        message: 'ANAF_CLIENT_SECRET env var is required for manifest EFacturaUpload',
        category: 'auth',
      });
    }
    const response = await deps.services.efacturaService.upload({
      contextName: action.context,
      xml,
      clientSecret,
      isB2C: action.upload.isB2C,
      options: {
        standard: action.upload.standard,
        executare: action.upload.isExecutare,
      },
    });
    renderSuccess(deps.output, response, (d) => `upload accepted: ${d.indexIncarcare}`);
  }
}
```

Tests cover: dry-run mode emits normalized action; ubl.build dispatch; efactura.upload with xmlFile source (mocked efacturaService); efactura.upload with ublBuild source recursing through ublService; dry-run with invalid spec fails at normalize; missing --file fails BAD_USAGE.

### T7: schema command handler

```ts
export async function schemaPrint(deps: CommandDeps, kindArg: string): Promise<void> {
  if (kindArg !== 'UblBuild' && kindArg !== 'EFacturaUpload') {
    throw new CliError({
      code: 'UNKNOWN_MANIFEST_KIND',
      message: `schema print: unknown kind "${kindArg}"`,
      category: 'user_input',
    });
  }
  const body = printJsonSchemaForKind(kindArg);
  // Write raw JSON to stdout, skipping the envelope
  deps.output.streams.stdout.write(body);
  if (!body.endsWith('\n')) deps.output.streams.stdout.write('\n');
}
```

### T8: Golden manifest tests

`cli/tests/manifest/` with 2 valid manifest YAML fixtures and 2 invalid ones. Tests parse each, assert the kind and shape.

Fixtures directory:
- `ubl-build.yaml` — minimal valid UblBuild
- `efactura-upload.yaml` — minimal valid EFacturaUpload with ublBuild source
- `invalid-version.yaml` — bad apiVersion
- `invalid-kind.yaml` — unknown kind

### T9: Full suite + lint + build + commit

Single commit: `feat(cli): manifest mode (P3.1 + P3.2 + P3.6)`.

---

## Out of scope

- `zod-to-json-schema` integration (v1.1 upgrade).
- xmlStdin in manifest run mode (deferred — manifests should be deterministic).
- Streaming large manifests.

## Acceptance criteria

- `anaf-cli run -f job.yaml` works end-to-end for a UblBuild manifest.
- `anaf-cli run -f job.yaml --dry-run` emits the normalized action without executing.
- `anaf-cli schema print UblBuild` emits valid JSON.
- All manifest tests + existing 291 tests pass.
- One commit.
