# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This is a pnpm workspace monorepo with two packages:

- **`sdk/`** — `anaf-ts-sdk`: TypeScript SDK for the Romanian ANAF e-Factura API (OAuth, document upload/download/validation, UBL invoice generation, company lookup).
- **`cli/`** — `anaf-cli`: CLI wrapping the SDK. Supports imperative commands and YAML manifest mode for AI agents/CI.

Workspace root is private; both packages publish independently to npm.

## Commands

### From the workspace root

```bash
pnpm install                   # install all deps (workspace-linked)
pnpm run build:sdk             # build SDK (CJS + ESM + types)
pnpm run build:cli             # build SDK then CLI (tsc + esbuild bundle)
pnpm run test:sdk              # SDK unit tests
pnpm run test:cli              # CLI tests (341 tests)
pnpm run lint                  # lint both packages
pnpm run lint:fix              # auto-fix lint in both
pnpm run verify                # full CI gate: build SDK → verify CLI (lint+build+test)
pnpm run dev -- <args>         # run CLI in dev mode (tsx, no build needed for CLI changes)
```

### SDK-specific (`pnpm --filter anaf-ts-sdk run <script>`)

```bash
build          # clean + CJS + ESM + types
test           # jest (all tests including integration — needs .env)
test:unit      # unit tests only (no network)
test:ci        # unit tests with coverage
lint:check     # eslint without fixing
```

### CLI-specific (`pnpm --filter anaf-cli run <script>`)

```bash
build          # clean + tsc + esbuild bundle (dist/bin/anaf-cli.cjs)
build:bundle   # esbuild only (requires tsc output)
build:sea      # Node SEA binary (requires build first)
test           # jest (all 341 tests)
test:smoke     # spawns the built binary, checks --version/--help
dev            # tsx src/bin/anaf-cli.ts (pass CLI args after --)
verify         # lint + build + test (single CI gate)
```

### Running a single test

```bash
pnpm --filter anaf-cli exec jest tests/services/lookupService.test.ts
pnpm --filter anaf-cli exec jest tests/commands/groups/ctx.test.ts -t "ctxLs"
pnpm --filter anaf-ts-sdk exec jest tests/ublBuilder.unit.test.ts
```

## Architecture

### SDK (`sdk/`)

Standard TypeScript library with dual CJS/ESM output. Key classes:
- `AnafAuthenticator` — OAuth 2.0 flow (auth URL, code exchange, token refresh)
- `TokenManager` — automatic token refresh with promise coalescing
- `EfacturaClient` — upload, status, download, messages (authenticated)
- `EfacturaToolsClient` — validate XML, validate signature, XML→PDF (also authenticated post-refactor)
- `AnafDetailsClient` — public company lookup (sync + async polling)
- `UblBuilder` — generates CIUS-RO compliant UBL 2.1 XML from `InvoiceInput`

### CLI (`cli/`)

Layered architecture — input surfaces converge on a shared service layer:

```
commands/  ──┐                    ┌── state/     (XDG-path contexts, tokens, cache)
             ├── actions/ ──→ services/ ──→ SDK
manifest/  ──┘                    └── output/    (text/JSON renderers, exit codes)
```

- **`commands/`** — commander-based CLI parser. Each group (`auth`, `ctx`, `efactura`, `lookup`, `ubl`, `run`, `schema`) is a file under `commands/groups/`. `runProgram.ts` is the orchestrator (builds services, handles errors, maps exit codes).
- **`actions/`** — shared action types (`UblBuildAction`, `EfacturaUploadAction`), line parser (`"desc|qty|price|tax"`), override merge, zod normalizers. Consumed by both commands and manifest parser.
- **`manifest/`** — YAML/JSON parser for `anaf-cli run -f job.yaml`. Dispatches by `apiVersion: anaf-cli/v1` + `kind: UblBuild|EFacturaUpload` onto the same normalizers.
- **`services/`** — `AuthService`, `LookupService` (with file cache), `UblService`, `EfacturaService`. Each wraps SDK clients and handles token persistence/rotation.
- **`state/`** — `ContextService`, `ConfigStore`, `TokenStore`. On-disk YAML/JSON at XDG paths. Zod-validated on read. Token files chmod 0600.
- **`output/`** — `CliError` with category→exit-code mapping, text + JSON renderers, `writeBinary` for PDF/ZIP. Error code registry at `output/errorCodes.ts`.

### Service registry pattern

`ServiceRegistry` in `buildProgram.ts` holds all service instances. `runProgram.ts` default-constructs them but tests inject stubs via `options.services`. Every handler receives `deps: { output: OutputContext, services: ServiceRegistry }`.

### Error contract

All errors are `CliError` instances with a `category` (`generic`=1, `user_input`=2, `auth`=3, `anaf_api`=4, `local_state`=5) that maps deterministically to an exit code. JSON mode wraps errors as `{"success":false,"error":{"code":"...","message":"..."}}` on stderr. Success goes to stdout.

## Key conventions

- CLI handlers are exported named async functions: `(deps, ...args, opts?) => Promise<void>`. They throw `CliError` on failure and call `renderSuccess` on success. Never call `process.exit` from a handler.
- Tests use injected XDG paths via `fs.mkdtempSync` — no test touches real `~/.config/anaf-cli/`.
- `ANAF_CLIENT_SECRET` env var is the primary secret source. Never persisted to disk.
- The esbuild bundle at `dist/bin/anaf-cli.cjs` inlines all deps (commander, yaml, zod, SDK) into a single 1.6 MB CJS file. This is what `npx` runs and what the SEA binary wraps.

## Release

- SDK: push to `main` with changes in `sdk/` triggers the SDK publish workflow.
- CLI: push a tag `cli-v*.*.*` triggers `cli-release.yaml` (builds SEA binaries for darwin-arm64/x64 + linux-x64, publishes npm, drafts GitHub Release).
- Homebrew tap: `florin-szilagyi/homebrew-anaf-cli` — formula at `cli/Formula/anaf-cli.rb` (SHA256 placeholders updated per release).
