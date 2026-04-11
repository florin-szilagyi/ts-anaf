# ANAF CLI Technical Design

Date: 2026-04-10
Status: Approved design
Scope: Separate CLI package that wraps the SDK comprehensively and supports both human operators and AI agents

## 1. Summary

This document defines the technical design for `anaf-cli`, a separate package that wraps the `efactura-anaf-ts-sdk` and exposes all core SDK capabilities through:

- an imperative human-friendly CLI
- a manifest-first execution mode for AI agents and automation
- `npx anaf-cli ...` distribution from npm
- `brew install ...` distribution from a standalone prebuilt executable in a custom Homebrew tap

The CLI is not a thin 1:1 mirror of SDK classes. It is an operator-oriented tool with a stable command model, a local context store, token persistence, company discovery, invoice generation, upload workflows, document tooling, and public ANAF company lookup.

## 2. Goals

- Wrap all existing SDK functionality in a coherent CLI.
- Support native-feeling installation via `npx` and Homebrew.
- Persist local auth and company contexts on disk.
- Make switching between companies fast, similar to `kubectx`.
- Allow invoice creation without requiring JSON input.
- Support a declarative manifest mode optimized for AI agents and CI.
- Keep one execution engine behind both imperative and manifest surfaces.

## 3. Non-Goals

- Building a GUI or TUI application.
- Supporting certificate-based auth in v1.
- Re-implementing SDK logic inside the CLI.
- Making manifest mode the only user interface.
- Solving secure secret storage for every OS keychain in v1.

## 4. Package Boundary

`anaf-cli` should be a separate package from the SDK.

Recommended repo/package strategy:

- Package name: `anaf-cli`
- npm package: `anaf-cli`
- executable name: `anaf-cli`
- dependency: `efactura-anaf-ts-sdk`

The CLI should depend on the SDK as a library and should not duplicate API logic. Any missing SDK surface needed by the CLI should be added to the SDK deliberately instead of bypassing it with ad hoc HTTP calls.

## 5. User Experience Model

The CLI has two front doors:

1. Imperative commands for humans
2. Manifest-driven execution for agents and automation

Both compile into the same internal action objects and use the same service layer.

This gives:

- short commands for daily operator work
- stable machine-readable input for AI agents
- one implementation path for business logic, auth, caching, and output

## 6. CLI Surface

### 6.1 Top-Level Commands

```text
anaf-cli
  auth
    login
    code
    refresh
    whoami
    logout
  ctx
    ls
    use
    current
    add
    rm
    rename
  efactura
    upload
    upload-b2c
    status
    download
    messages
    validate
    validate-signature
    pdf
  lookup
    company
    company-async
    validate-cui
  ubl
    build
    inspect
  run
  schema
    print
```

### 6.2 Mapping to SDK Capabilities

| CLI area | SDK surface |
| --- | --- |
| `auth` | `AnafAuthenticator`, `TokenManager` |
| `efactura upload/upload-b2c/status/download/messages` | `EfacturaClient` |
| `efactura validate/validate-signature/pdf` | `EfacturaToolsClient` |
| `lookup company/company-async/validate-cui` | `AnafDetailsClient` |
| `ubl build` | `UblBuilder` + `AnafDetailsClient` |
| `ctx` | CLI-only local state layer |

### 6.3 Command Design Principles

- `stdout` by default for generated content unless `--out` is provided.
- `stderr` for diagnostics and interactive guidance.
- `--json` supported on inspection-style commands and all agent-facing commands.
- `--context` allowed on any command that needs a company context.
- interactive prompts should be optional, never mandatory for automation.
- `stdin` should be supported where piping is natural.

## 7. Auth Model

### 7.1 Primary Flow

The primary auth flow is deliberately simple:

1. Resolve target context
2. Build ANAF authorization URL
3. Open browser or print URL
4. User authenticates in browser
5. User pastes authorization code back into CLI
6. CLI exchanges code for tokens
7. CLI persists refresh token and token metadata

No local callback server is required in v1.

### 7.2 Commands

Examples:

```bash
anaf-cli auth login
anaf-cli auth code --context acme-prod --code "<authorization-code>"
anaf-cli auth refresh --context acme-prod
anaf-cli auth whoami --json
anaf-cli auth logout --context acme-prod
```

`auth login` should:

- load the target context
- generate the authorization URL via `AnafAuthenticator`
- optionally open the system browser
- print the URL if browser open fails
- instruct the user to paste the returned code

`auth code` should:

- exchange the pasted code for tokens
- persist the refresh token
- cache the access token and expiry if available
- print success and context info

### 7.3 Secret Handling

Client secret handling should support:

- `ANAF_CLIENT_SECRET`
- `--client-secret-stdin`
- optional plaintext persistence only if explicitly enabled later

Client secret should not be stored in plain context YAML by default.

## 8. Context Model

### 8.1 Requirements

Contexts are first-class. A context represents a company and its associated auth/config state.

Each context includes:

- a name
- supplier CUI
- ANAF environment: `test` or `prod`
- OAuth client ID
- redirect URI
- optional defaults such as currency and output mode
- token linkage

### 8.2 On-Disk Layout

Use XDG-style paths:

- config: `~/.config/anaf-cli/`
- data: `~/.local/share/anaf-cli/`
- cache: `~/.cache/anaf-cli/`

Files:

```text
~/.config/anaf-cli/config.yaml
~/.config/anaf-cli/contexts/<name>.yaml
~/.local/share/anaf-cli/tokens/<name>.json
~/.cache/anaf-cli/company-cache/<cui>.json
```

### 8.3 Example Config

`config.yaml`

```yaml
currentContext: acme-prod
defaults:
  output: stdout
  format: text
```

`contexts/acme-prod.yaml`

```yaml
name: acme-prod
companyCui: RO12345678
environment: prod
auth:
  clientId: your-client-id
  redirectUri: https://localhost/anaf/callback
defaults:
  currency: RON
  output: stdout
```

`tokens/acme-prod.json`

```json
{
  "refreshToken": "<redacted-refresh-token>",
  "accessToken": "<redacted-access-token>",
  "expiresAt": "2026-04-10T20:10:00Z",
  "obtainedAt": "2026-04-10T18:10:00Z"
}
```

### 8.4 Context Commands

Examples:

```bash
anaf-cli ctx ls
anaf-cli ctx current --json
anaf-cli ctx use acme-prod
anaf-cli ctx add --name acme-prod --cui RO12345678 --client-id xxx --redirect-uri https://localhost/anaf/callback --env prod
anaf-cli ctx rename acme-prod acme-main
anaf-cli ctx rm acme-main
```

`ctx ls` should show:

- context name
- current marker
- supplier CUI
- environment
- token status
- optional freshness of cached lookup data

This is the main discovery surface, analogous to `kubectx`.

## 9. UBL Build Model

### 9.1 Core Design

`ubl build` is a smart invoice authoring command, not just a serializer.

Behavior:

- supplier identity comes from the active or explicit context
- supplier company details are fetched automatically from `AnafDetailsClient` using the supplier CUI from the context
- customer is passed via `--customer-cui`
- customer company details are fetched automatically from `AnafDetailsClient`
- CLI and manifest overrides are applied on top of lookup results
- final normalized data is converted to SDK `InvoiceInput`
- `UblBuilder` generates XML

### 9.2 Input Modes

`ubl build` should support three modes:

1. interactive wizard
2. flags-only
3. structured file input such as JSON or YAML

JSON input is optional, never required.

### 9.3 Flag Model

Primary flags:

- `--invoice-number`
- `--issue-date`
- `--due-date`
- `--customer-cui`
- `--line "<description>|<qty>|<unitPrice>|<taxPercent>[|<unitCode>]"`
- `--currency`
- `--payment-iban`
- `--note`
- `--out`

Override flags:

- `--supplier-name`
- `--supplier-street`
- `--supplier-city`
- `--supplier-postal-zone`
- `--supplier-country-code`
- `--customer-name`
- `--customer-street`
- `--customer-city`
- `--customer-postal-zone`
- `--customer-country-code`

### 9.4 Example Commands

Simple invoice:

```bash
anaf-cli ctx use acme-prod

anaf-cli ubl build \
  --invoice-number FCT-2026-0001 \
  --issue-date 2026-04-10 \
  --customer-cui RO12345678 \
  --line "Servicii consultanta|1|1000|19" \
  --out invoice.xml
```

Pipeline to stdout:

```bash
anaf-cli ubl build \
  --invoice-number FCT-2026-0001 \
  --issue-date 2026-04-10 \
  --customer-cui RO12345678 \
  --line "Servicii consultanta|1|1000|19" \
  > invoice.xml
```

With customer overrides:

```bash
anaf-cli ubl build \
  --invoice-number FCT-2026-0001 \
  --issue-date 2026-04-10 \
  --customer-cui RO12345678 \
  --customer-name "Client Corectat SRL" \
  --customer-city "Cluj-Napoca" \
  --line "Servicii consultanta|1|1000|19" \
  --out invoice.xml
```

### 9.5 Future Convenience

The CLI may later support:

```bash
anaf-cli efactura upload --from-json invoice.json
anaf-cli efactura upload --from-ubl-flags <build-flags>
```

Internally these should route through the same `ubl build` action path before upload.

## 10. e-Factura Operations

### 10.1 Commands

Examples:

```bash
anaf-cli efactura upload --xml invoice.xml
anaf-cli efactura upload --stdin
anaf-cli efactura upload-b2c --xml invoice.xml
anaf-cli efactura status --upload-id 123456
anaf-cli efactura download --download-id 987654 --out result.zip
anaf-cli efactura messages --days 7 --filter E --json
anaf-cli efactura validate --xml invoice.xml --standard FACT1
anaf-cli efactura validate-signature --xml signed.xml --signature sig.xml
anaf-cli efactura pdf --xml invoice.xml --standard FACT1 --out invoice.pdf
anaf-cli efactura pdf --xml invoice.xml --standard FACT1 --no-validation --out invoice.pdf
```

### 10.2 Rules

- `upload` uses `EfacturaClient.uploadDocument`
- `upload-b2c` uses `EfacturaClient.uploadB2CDocument`
- `status` uses `EfacturaClient.getUploadStatus`
- `download` uses `EfacturaClient.downloadDocument`
- `messages` supports both simple and paginated variants
- `validate` uses `EfacturaToolsClient.validateXml`
- `validate-signature` uses `EfacturaToolsClient.validateSignature`
- `pdf` uses `EfacturaToolsClient.convertXmlToPdf` or `convertXmlToPdfNoValidation`

### 10.3 Message Listing UX

Recommended human mode:

```bash
anaf-cli efactura messages --days 7 --filter E
```

Recommended agent mode:

```bash
anaf-cli efactura messages --days 7 --filter E --json
```

If pagination is needed, expose explicit fields:

```bash
anaf-cli efactura messages --start-time 1712700000000 --end-time 1712786400000 --page 2 --json
```

## 11. Public ANAF Lookup

### 11.1 Commands

```bash
anaf-cli lookup company RO12345678
anaf-cli lookup company RO12345678 RO87654321 --json
anaf-cli lookup company-async RO12345678 --json
anaf-cli lookup validate-cui RO12345678
```

### 11.2 Behavior

- `lookup company` uses sync ANAF public endpoints and registry enrichment
- `lookup company-async` uses async submit-plus-poll workflow for richer details
- `lookup validate-cui` is a cheap format validation command

The async lookup command should expose polling knobs for automation:

- `--initial-delay`
- `--retry-delay`
- `--max-retries`

## 12. Manifest Mode

### 12.1 Purpose

Manifest mode exists primarily for AI agents, CI, and batch automation.

It should not replace imperative commands. It should reuse the same internal action model.

### 12.2 Entry Point

```bash
anaf-cli run -f job.yaml
anaf-cli run -f job.yaml --dry-run
anaf-cli schema print UblBuild
```

### 12.3 Recommended Format

Use YAML by default for readability, while also allowing JSON.

Shared document structure:

```yaml
apiVersion: anaf-cli/v1
kind: UblBuild
context: acme-prod
spec: {}
output: {}
```

### 12.4 Example: Build Invoice

```yaml
apiVersion: anaf-cli/v1
kind: UblBuild
context: acme-prod
spec:
  invoiceNumber: FCT-2026-0001
  issueDate: 2026-04-10
  customer:
    cui: RO12345678
    overrides:
      name: Client Corectat SRL
      city: Cluj-Napoca
  lines:
    - description: Servicii consultanta
      quantity: 1
      unitPrice: 1000
      taxPercent: 19
  paymentIban: RO49AAAA1B31007593840000
output:
  format: xml
  path: ./invoice.xml
```

### 12.5 Example: Build and Upload

```yaml
apiVersion: anaf-cli/v1
kind: EFacturaUpload
context: acme-prod
spec:
  source:
    type: ublBuild
    invoice:
      invoiceNumber: FCT-2026-0001
      issueDate: 2026-04-10
      customer:
        cui: RO12345678
      lines:
        - description: Servicii consultanta
          quantity: 1
          unitPrice: 1000
          taxPercent: 19
  upload:
    standard: UBL
    executare: true
output:
  format: json
```

### 12.6 Why This Matters

Manifest mode provides:

- stable schemas
- explicit versioning via `apiVersion`
- low-friction generation by agents
- deterministic retries
- easy diffability in CI

## 13. Internal Architecture

### 13.1 Layers

Recommended package layout:

```text
src/
  bin/
    anaf-cli.ts
  commands/
  manifest/
  actions/
  services/
  state/
  output/
  utils/
```

Layer responsibilities:

- `commands/`: parse imperative CLI input into normalized actions
- `manifest/`: parse YAML or JSON documents into normalized actions
- `actions/`: type-safe action definitions shared by both entry surfaces
- `services/`: orchestration using SDK clients and local state
- `state/`: context store, token store, cache store
- `output/`: human text, machine JSON, file writers
- `utils/`: flag parsing helpers, browser opening, path handling, date parsing

### 13.2 Execution Flow

Unified flow:

1. Parse command or manifest
2. Resolve target context
3. Resolve credentials and tokens
4. Build action object
5. Execute action through service layer
6. Render output or write artifacts

### 13.3 Shared Action Model

Illustrative shape:

```ts
type UblBuildAction = {
  kind: 'ubl.build';
  context: string;
  invoice: {
    invoiceNumber: string;
    issueDate: string;
    dueDate?: string;
    customerCui: string;
    lines: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      taxPercent: number;
      unitCode?: string;
    }>;
    overrides?: {
      supplier?: Partial<Party>;
      customer?: Partial<Party>;
      note?: string;
      paymentIban?: string;
      currency?: string;
    };
  };
  output: {
    mode: 'stdout' | 'file';
    path?: string;
  };
};
```

This model allows imperative and manifest execution to converge at one service boundary.

## 14. Service Design

### 14.1 Core Services

- `ContextService`
- `TokenStore`
- `AuthService`
- `LookupService`
- `UblService`
- `EfacturaService`
- `ManifestService`

### 14.2 Responsibilities

`ContextService`

- create, read, update, delete contexts
- resolve current context
- validate context completeness

`TokenStore`

- read and write token JSON blobs
- expose current refresh token for SDK `TokenManager`
- update rotated refresh tokens after SDK refresh

`AuthService`

- construct `AnafAuthenticator`
- generate auth URLs
- exchange pasted codes
- refresh tokens

`LookupService`

- wrap `AnafDetailsClient`
- support cache read-through and cache write-through
- expose sync and async lookup

`UblService`

- resolve supplier from context
- hydrate supplier and customer via lookup
- apply overrides
- map to SDK `InvoiceInput`
- build XML via `UblBuilder`

`EfacturaService`

- construct `TokenManager`, `EfacturaClient`, and `EfacturaToolsClient`
- perform upload, status, download, validation, signature validation, and PDF conversion

## 15. Output and UX Conventions

### 15.1 Output Modes

Support:

- text
- json
- raw XML or PDF bytes where appropriate

Rules:

- human-readable summaries by default
- `--json` for machine-readable output
- generated XML defaults to stdout
- binary outputs require `--out` or explicit stdout handling

### 15.2 Exit Codes

Suggested exit codes:

- `0`: success
- `1`: generic execution failure
- `2`: validation or user input error
- `3`: auth failure
- `4`: remote ANAF API error
- `5`: local state/config error

### 15.3 Error Format

Human mode:

- concise summary
- one or two actionable next steps

JSON mode:

```json
{
  "success": false,
  "error": {
    "code": "AUTH_FAILED",
    "message": "Failed to refresh access token",
    "details": {}
  }
}
```

## 16. Caching Strategy

### 16.1 Company Cache

Cache company lookup results by:

- CUI
- environment if relevant
- request mode: sync or async

Cache should store:

- normalized company data
- raw lookup snapshot
- fetch timestamp

### 16.2 Cache Behavior

- default to read-through cache for lookup-backed operations
- allow `--no-cache` to force live fetch
- allow `--refresh-cache` to overwrite stale entries

This is especially useful for repeated `ubl build` calls.

## 17. npm and npx Distribution

### 17.1 Requirements

Users must be able to run:

```bash
npx anaf-cli ...
```

Package requirements:

- publish `anaf-cli` to npm
- define `bin` in `package.json`
- build the CLI to distributable JS in `dist/`
- include runtime dependencies required for normal Node execution

### 17.2 Example Package Metadata

```json
{
  "name": "anaf-cli",
  "version": "0.1.0",
  "bin": {
    "anaf-cli": "dist/bin/anaf-cli.js"
  }
}
```

### 17.3 Node Runtime Target

Recommended baseline for the npm package:

- Node 20 or newer

This simplifies runtime assumptions and aligns with standalone executable tooling.

## 18. Homebrew Distribution

### 18.1 Strategy

Homebrew distribution should use prebuilt standalone executables, not an npm-installed formula.

User install target:

```bash
brew install florin-szilagyi/anaf/anaf-cli
```

### 18.2 Recommended Binary Technology

Use Node single executable applications as the default binary strategy.

Reasons:

- official Node capability
- avoids relying on deprecated `pkg`
- supports distributing a standalone executable without requiring Node to be installed on the target machine

Known constraints that must shape implementation:

- the injected entry script must be a single bundled CommonJS script
- the Node version used to generate the SEA blob must match the Node binary into which it is injected
- SEA remains under active development, so the build pipeline should pin an exact Node version

### 18.3 Build Pipeline Shape

Recommended release artifacts:

- `anaf-cli-darwin-arm64.tar.gz`
- `anaf-cli-darwin-x64.tar.gz`
- `anaf-cli-linux-x64.tar.gz`

Build stages:

1. transpile TypeScript
2. bundle CLI entry into one CommonJS file
3. generate SEA preparation blob with pinned Node version
4. copy the matching `node` executable
5. remove signature on macOS binary copy
6. inject SEA blob
7. re-sign if needed for distribution
8. tar the resulting executable
9. attach artifacts to GitHub Release

### 18.4 Homebrew Tap

Create a custom tap, for example:

- repository: `florin-szilagyi/homebrew-anaf`
- formula: `anaf-cli.rb`

Formula responsibilities:

- select correct artifact for OS and architecture
- download release tarball
- install the `anaf-cli` binary into `bin`
- run a minimal smoke test

### 18.5 Example Formula Shape

```rb
class AnafCli < Formula
  desc "CLI for the ANAF e-Factura SDK"
  homepage "https://github.com/florin-szilagyi/anaf-cli"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/florin-szilagyi/anaf-cli/releases/download/v0.1.0/anaf-cli-darwin-arm64.tar.gz"
      sha256 "<darwin-arm64-sha256>"
    end

    on_intel do
      url "https://github.com/florin-szilagyi/anaf-cli/releases/download/v0.1.0/anaf-cli-darwin-x64.tar.gz"
      sha256 "<darwin-x64-sha256>"
    end
  end

  on_linux do
    url "https://github.com/florin-szilagyi/anaf-cli/releases/download/v0.1.0/anaf-cli-linux-x64.tar.gz"
    sha256 "<linux-x64-sha256>"
  end

  def install
    bin.install "anaf-cli"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/anaf-cli --version")
  end
end
```

## 19. Build Tooling Recommendation

### 19.1 Bundling

Use `esbuild` to bundle the CLI entrypoint into a single CommonJS artifact for SEA input.

Why:

- fast
- mature
- easy single-file bundling
- good fit for a TypeScript Node CLI

### 19.2 Constraints to Design Around

- avoid dynamic filesystem-based module loading in the SEA entrypoint
- avoid runtime assumptions that require unpacked source files
- treat YAML schemas, help templates, and static assets as explicit bundle or SEA assets

### 19.3 Suggested Build Commands

Illustrative pipeline:

```bash
pnpm build
pnpm build:bundle
pnpm build:sea
pnpm release:artifacts
```

## 20. Testing Strategy

### 20.1 Unit Tests

- flag parsing
- manifest parsing
- context resolution
- token persistence
- action normalization
- UBL line parser
- override merge logic

### 20.2 Integration Tests

- auth code exchange path with mocked HTTP
- `ubl build` using cached and mocked company lookup data
- upload and status flows with mocked SDK layer
- manifest execution end to end

### 20.3 Packaging Tests

- npm package smoke test via `npx`
- standalone executable smoke test on macOS and Linux
- Homebrew formula test block

### 20.4 Golden Tests

Use snapshot or fixture-based tests for:

- text output
- JSON output
- generated manifest schemas
- example UBL invoice XML

## 21. Release Process

### 21.1 Versioning

The CLI should version independently from the SDK.

Compatibility policy:

- CLI declares supported SDK semver range
- breaking CLI schema changes require major version bump
- manifest `apiVersion` changes are independent from package version but should track breaking shape changes

### 21.2 Release Steps

1. run tests
2. build npm package
3. bundle SEA input
4. build platform executables
5. publish GitHub Release artifacts
6. publish npm package
7. update Homebrew tap formula URLs and SHA256 values
8. verify install from both `npx` and `brew`

## 22. Implementation Plan Outline

Suggested implementation phases:

### Phase 1

- bootstrap separate CLI package
- add imperative parser
- implement context store
- implement auth login and code exchange
- implement basic lookup commands

### Phase 2

- implement `ubl build`
- implement overrides and line parsing
- implement core `efactura` upload, status, download
- add JSON output mode

### Phase 3

- implement manifest mode
- implement validation, signature validation, and PDF commands
- add caching controls
- add richer error model and exit codes

### Phase 4

- add SEA build pipeline
- add GitHub Release artifact pipeline
- create Homebrew tap
- add installation documentation

## 23. Open Implementation Decisions

These are not blockers for the design, but they must be chosen explicitly during implementation:

- CLI parser library choice
- YAML parser and schema validation library choice
- whether `auth login` opens the browser by default or only with `--open`
- whether binary signing and notarization are needed for macOS distribution
- whether token files should later migrate to OS keychain-backed storage

## 24. Recommended Defaults

- imperative CLI plus manifest mode, both first-class
- contexts persisted on disk
- supplier CUI sourced from active context
- customer CUI supplied per invoice
- lookup-backed invoice hydration with user overrides
- XML output to stdout by default
- `--out` for explicit file writing
- npm package for `npx`
- standalone SEA binary artifacts for Homebrew

## 25. Acceptance Criteria

The design is considered implemented successfully when:

- a user can install the CLI with `npx anaf-cli` and with `brew install florin-szilagyi/anaf/anaf-cli`
- a user can create and switch between multiple company contexts
- a user can authenticate once per context and persist tokens locally
- a user can generate a UBL invoice without JSON input
- supplier data is resolved from the active context CUI
- customer data is resolved from `--customer-cui`
- user overrides can correct supplier or customer fields
- a user can upload, inspect status, download, validate, and convert documents through the CLI
- an AI agent can execute the same workflows through manifest files

## 26. References

- Node single executable applications: https://nodejs.org/download/release/v22.17.1/docs/api/single-executable-applications.html
- esbuild API: https://esbuild.github.io/api/
- Homebrew formula cookbook: https://docs.brew.sh/Formula-Cookbook
- Homebrew bottles: https://docs.brew.sh/Bottles
- Homebrew Node formula guidance: https://docs.brew.sh/Node-for-Formula-Authors
