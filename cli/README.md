# anaf-cli

Command-line interface for the Romanian ANAF e-Factura system, built on
[`anaf-ts-sdk`](https://www.npmjs.com/package/anaf-ts-sdk). Manage OAuth
sessions, look up companies on the public ANAF API, author UBL invoices,
and upload/status/download documents — either interactively or from a
YAML manifest for CI and AI agents.

## Install

### npx

```bash
npx anaf-cli --version
```

### Homebrew

```bash
brew tap florin-szilagyi/anaf-cli
brew install anaf-cli
```

### From source

```bash
pnpm install
pnpm --filter anaf-ts-sdk run build
pnpm --filter anaf-cli run build
node cli/dist/bin/anaf-cli.js --version
```

Requires Node 20 or newer for both npm and source installs. Homebrew
binaries are standalone and don't require Node on the target machine.

## Quickstart

```bash
# 1. Configure a company context
anaf-cli ctx add \
  --name acme-prod \
  --cui RO12345678 \
  --client-id <oauth-client-id> \
  --redirect-uri https://localhost/anaf/callback \
  --env prod
anaf-cli ctx use acme-prod

# 2. Authenticate (prints an ANAF OAuth URL to stderr)
export ANAF_CLIENT_SECRET=<your-oauth-client-secret>
anaf-cli auth login
# paste the URL into a browser, authenticate, and copy the code back
anaf-cli auth code --code <pasted-code>

# 3. Build an invoice. Supplier is fetched from your context CUI.
anaf-cli ubl build \
  --invoice-number FCT-2026-0001 \
  --issue-date 2026-04-11 \
  --customer-cui RO87654321 \
  --line "Servicii consultanta|10|250|19" \
  --payment-iban RO49AAAA1B31007593840000 \
  --out invoice.xml

# 4. Upload it
anaf-cli efactura upload --xml invoice.xml
anaf-cli efactura status --upload-id <id-from-upload>
```

## Command reference

### `auth`

- `auth login` — print the OAuth authorization URL for the active context.
- `auth code --code <code>` — exchange a pasted code for tokens (persists the refresh token).
- `auth refresh` — force-refresh the access token.
- `auth whoami` — print current context + token freshness.
- `auth logout` — discard tokens for the active context.

The OAuth client secret is read from `ANAF_CLIENT_SECRET` or from stdin
via `--client-secret-stdin`. It is **never** persisted to disk.

### `ctx`

- `ctx ls` — list all configured contexts (with a `*` marker on the current).
- `ctx current` — print the current context.
- `ctx use <name>` — set the current context.
- `ctx add --name <name> --cui <cui> --client-id <id> --redirect-uri <uri> [--env test|prod]`
- `ctx rm <name>` — delete a context (and any associated tokens).
- `ctx rename <old> <new>`

Context state lives at `~/.config/anaf-cli/`. Token files are written
`0600`. Company lookup cache lives at `~/.cache/anaf-cli/`.

### `lookup`

- `lookup company <cui...>` — fetch one or more companies from the public
  ANAF API. `--no-cache` bypasses the cache; `--refresh-cache` overwrites it.
- `lookup company-async <cui>` — richer async lookup with submit + poll
  (`--initial-delay`, `--retry-delay`, `--max-retries` knobs).
- `lookup validate-cui <cui>` — cheap local format check.

### `ubl`

- `ubl build` — build a UBL 2.1 invoice XML from flags or a structured
  file (`--from-json`, `--from-yaml`). Supplier is resolved from the
  active context CUI; customer from `--customer-cui`. Override flags
  (`--supplier-city`, `--customer-name`, …) correct any lookup gaps.
- `ubl inspect --xml <path>` — quick preview of a UBL XML file.

### `efactura`

- `efactura upload --xml <path>` (or `--stdin`) — upload a document.
- `efactura upload-b2c --xml <path>` — same, B2C variant.
- `efactura status --upload-id <id>` — poll an upload for completion.
- `efactura download --download-id <id> [--out <path>]` — fetch the ANAF
  response ZIP.
- `efactura messages --days <n> [--filter T|P|E|R]` — list recent
  messages. Paginated mode: `--start-time`, `--end-time`, `--page`.
- `efactura validate --xml <path>` — ANAF schema validation.
- `efactura validate-signature --xml <path> --signature <path>` — signed
  XML validation.
- `efactura pdf --xml <path> [--no-validation] [--out <path>]` — convert
  XML to PDF via the ANAF tools service.

### `run` + `schema`

- `anaf-cli run -f job.yaml` — execute a YAML or JSON manifest.
  `--dry-run` normalizes without executing.
- `anaf-cli schema print UblBuild|EFacturaUpload` — emit the JSON Schema
  for a manifest kind. Use this to validate manifests in CI.

Example manifest (`job.yaml`):

```yaml
apiVersion: anaf-cli/v1
kind: UblBuild
context: acme-prod
spec:
  invoiceNumber: FCT-2026-0001
  issueDate: 2026-04-11
  customerCui: RO87654321
  lines:
    - description: Servicii consultanta
      quantity: 10
      unitPrice: 250
      taxPercent: 19
  paymentIban: RO49AAAA1B31007593840000
output:
  mode: file
  path: ./invoice.xml
```

## Global flags

- `--json` — machine-readable envelope output on all commands. Every
  success emits `{"success":true,"data":...}`; every error emits
  `{"success":false,"error":{"code","message","details?"}}`.
- `--context <name>` — override the active context for this invocation.
- `-v, --version`, `-h, --help`.

## Exit codes

| Code | Category       | Meaning                                    |
| ---- | -------------- | ------------------------------------------ |
| 0    | success        | the command completed                      |
| 1    | generic        | unexpected failure                         |
| 2    | user\_input    | bad flags, bad manifest, invalid input     |
| 3    | auth           | OAuth flow / refresh / missing secret      |
| 4    | anaf\_api      | ANAF rejected the request                  |
| 5    | local\_state   | config/token/context file problem          |

Error codes per category are documented in
[`src/output/errorCodes.ts`](src/output/errorCodes.ts).

## Development

```bash
pnpm install                    # install the workspace
pnpm --filter anaf-ts-sdk run build
pnpm --filter anaf-cli run verify   # lint + build + test
pnpm --filter anaf-cli run test     # jest
pnpm --filter anaf-cli run dev      # tsx src/bin/anaf-cli.ts
```

Design doc: [`docs/anaf-cli-technical-design.md`](../docs/anaf-cli-technical-design.md).
Master implementation plan: [`docs/superpowers/plans/2026-04-11-anaf-cli-phases.md`](../docs/superpowers/plans/2026-04-11-anaf-cli-phases.md).

## License

MIT.
