# anaf-cli

Command-line tool for Romania's [ANAF e-Factura](https://www.anaf.ro/anaf/internet/ANAF/despre_ANAF/informatii_publice/media/e_factura) system. Upload invoices, check statuses, download responses, and manage OAuth authentication -- all from your terminal.

Built on [@florinszilagyi/anaf-ts-sdk](../sdk/).

## Quick start

```bash
# Install
npm i -g @florinszilagyi/anaf-cli

# 1. Save your OAuth app credential (once, ever)
anaf-cli cred set \
  --client-id "$ANAF_CLIENT_ID" \
  --client-secret "$ANAF_CLIENT_SECRET" \
  --redirect-uri https://localhost:9002/callback

# 2. Authenticate for a company (opens browser, catches callback automatically)
anaf-cli auth login 12345678
# -> Looks up company name from ANAF: "SC ACME SRL"
# -> Opens browser for OAuth with your USB certificate
# -> Stores token, sets 12345678 as active company

# 3. Upload an invoice
anaf-cli efactura upload --xml invoice.xml
```

## Concepts

A **credential** is your ANAF OAuth app (client ID, optional client secret, redirect URI). You have one.

A **company** is a CUI you manage. You can have many, all sharing the same credential.

```
credential (one OAuth app)
  |-- company: 12345678  SC ACME SRL    test  fresh
  +-- company: 87654321  SC OTHER SRL   test  fresh
```

Authenticate once per company. Switch freely with `auth use <CUI>`. One shared token for all companies (same OAuth app).

### Environments

- **test** (default) -- ANAF test environment. Safe to experiment.
- **prod** -- production. Real invoices.

Set the default with `cred set --env test|prod`. Override per-command with `--env`.

## Install

```bash
npm i -g @florinszilagyi/anaf-cli
# or
pnpm add -g @florinszilagyi/anaf-cli
```

### From source

```bash
git clone https://github.com/florin-szilagyi/ts-anaf.git
cd ts-anaf && pnpm install && pnpm build
node cli/dist/bin/anaf-cli.cjs --version
```

Requires Node 20+.

## Setup

### 1. Save your credential

Register an OAuth app at [ANAF SPV](https://www.anaf.ro/anaf/internet/ANAF/servicii_online/spv), then:

```bash
anaf-cli cred set \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --redirect-uri https://localhost:9002/callback \
  --env test
```

The client secret is optional here -- you can also pass it via `ANAF_CLIENT_SECRET` env var at runtime.

### 2. Log in for a company

```bash
anaf-cli auth login 12345678
```

This:
1. Looks up the company name from ANAF (no manual entry needed)
2. Starts a local HTTPS server on port 9002
3. Opens your browser to ANAF's OAuth login page
4. Catches the callback automatically after you authenticate with your USB certificate
5. Stores the token and sets 12345678 as the active company

You'll see a self-signed certificate warning the first time -- click through it.

For manual mode (CI, SSH, headless):

```bash
anaf-cli auth login 12345678 --no-callback-server
# Copy the URL, open in browser, authorize, then paste the code when prompted
```

### 3. Add more companies

```bash
anaf-cli auth login 87654321
# -> Authenticated as SC OTHER SRL (87654321)
# -> 87654321 is now active
```

### 4. Switch companies

```bash
anaf-cli auth use 12345678
# -> Active: SC ACME SRL (12345678)
```

### 5. Verify

```bash
anaf-cli auth whoami
# -> SC ACME SRL (12345678) — test — token fresh (expires 2026-07-11T...)
```

## Commands

For the full flag-by-flag reference see [COMMANDS.md](./COMMANDS.md).

### `cred` -- Manage OAuth credentials

| Command | Description |
|---------|-------------|
| `cred set --client-id <id> [--client-secret <s>] --redirect-uri <uri> [--env test\|prod]` | Save or update the credential |
| `cred show` | Print the current credential (masked secret) |
| `cred clear` | Remove the credential |

### `auth` -- Companies and authentication

| Command | Description |
|---------|-------------|
| `auth login <CUI>` | Look up company from ANAF, authenticate, register, set as active |
| `auth login <CUI> --no-callback-server` | Manual OAuth flow (print URL, paste code) |
| `auth use <CUI>` | Switch the active company |
| `auth whoami` | Show active company + environment + token status |
| `auth ls` | List all registered companies |
| `auth rm <CUI>` | Remove a registered company |
| `auth logout` | Discard tokens |
| `auth refresh` | Force-refresh the access token |

### `efactura` -- Invoice operations

**Upload:**

```bash
anaf-cli efactura upload --xml invoice.xml [--standard UBL|CN|CII|RASP]
anaf-cli efactura upload-b2c --xml invoice.xml
```

**Status and download:**

```bash
anaf-cli efactura status --upload-id 12345
anaf-cli efactura download --download-id 67890 [--out response.zip]
```

Downloads are ZIP archives by default. `--as` unwraps them for you:

```bash
anaf-cli efactura download --download-id 67890 --as xml --out invoice.xml
anaf-cli efactura download --download-id 67890 --as pdf --out invoice.pdf
```

`--as pdf` renders the downloaded invoice through the ANAF transform service; it
accepts the same `--standard FACT1|FCN` and `--no-validation` flags as `efactura pdf`.
Those two flags are rejected with any other `--as` value, so a mistyped format never
passes silently.

**Messages:**

```bash
anaf-cli efactura messages --days 7 [--filter T|P|E|R]
anaf-cli efactura messages --start-time 1646037374000 --end-time 1646170574000 --page 1
```

Filter values: `T` = sent, `P` = received, `E` = errors, `R` = buyer messages.

**Validation and conversion:**

```bash
anaf-cli efactura validate --xml invoice.xml [--standard FACT1|FCN]
anaf-cli efactura validate-signature --xml invoice.xml --signature sig.xml
anaf-cli efactura pdf --xml invoice.xml [--out invoice.pdf] [--no-validation]
```

### `lookup` -- Company data

```bash
anaf-cli lookup company 12345678
anaf-cli lookup company 12345678 87654321       # batch
anaf-cli lookup validate-cui RO12345678         # format check
```

### `ubl` -- Invoice building

```bash
anaf-cli ubl build --from-yaml invoice.yaml --out invoice.xml
anaf-cli ubl build --from-json invoice.json --out invoice.xml
anaf-cli ubl inspect --xml invoice.xml
```

### `run` + `schema` -- YAML manifests

```bash
anaf-cli run -f job.yaml            # execute a manifest
anaf-cli run -f job.yaml --dry-run  # validate without executing
anaf-cli schema print UblBuild      # print JSON schema for a manifest kind
anaf-cli schema print EFacturaUpload
```

Manifests are the preferred interface for CI pipelines and AI agents — they are fully declarative, versionable, and validated before execution. Both YAML and JSON formats are accepted.

#### Envelope

Every manifest shares the same top-level envelope:

```yaml
apiVersion: anaf-cli/v1          # required, literal
kind: UblBuild | EFacturaUpload  # required
context: "12345678"              # required — the supplier/operator CUI
spec:                            # required — kind-specific payload
  ...
output:                          # optional
  mode: stdout | file            # default: stdout
  path: ./invoice.xml            # required when mode: file
```

> **Context resolution:** `context` must be set in the manifest (or inside `spec.context`). The top-level `context` key always wins over `spec.context`. At execution time the value is further overridden by the active company's authenticated session, so the value in the file acts as documentation/fallback — but must be non-empty for the manifest to parse correctly.

> **Strict validation:** all manifests reject unknown fields. A typo in a field name is a hard error.

---

#### Kind: `UblBuild`

Generates a CIUS-RO compliant UBL 2.1 XML invoice. Supplier data is fetched from ANAF using the resolved CUI — you only need the customer CUI and the invoice lines.

```yaml
apiVersion: anaf-cli/v1
kind: UblBuild
spec:
  invoiceNumber: FCT-2026-0001    # required
  issueDate: "2026-04-11"         # required, YYYY-MM-DD
  dueDate: "2026-05-11"           # optional, YYYY-MM-DD
  customerCui: "RO87654321"       # required, (RO)?\d{2,10}
  currency: RON                   # optional, default RON
  taxCurrencyTaxAmount: 530.25    # optional — total VAT in RON when currency ≠ RON (CIUS-RO BR-53)
  paymentIban: RO49AAAA1B31007593840000  # optional
  note: "Plata in 30 de zile"    # optional
  lines:                          # required, min 1
    - "Consultanta IT|10|250|21"  # string shorthand: desc|qty|unitPrice|taxPct[|unitCode]
    - description: Licenta software  # or object form
      quantity: 1
      unitPrice: 1500
      taxPercent: 21
      unitCode: C62               # optional, UN/CEFACT unit code (default: C62 = piece)
  overrides:                      # optional — override ANAF-fetched party data
    supplier:
      registrationName: "Custom Name SRL"
      address:
        street: "Str. Override 1"
        city: "Cluj-Napoca"
        postalZone: "400000"
        county: "RO-CJ"           # ISO 3166-2:RO code
        countryCode: RO
    customer:
      registrationName: "Client Override SRL"
output:
  mode: file
  path: ./invoice.xml
```

**`spec` field reference:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `invoiceNumber` | string | yes | Any string, no format constraint |
| `issueDate` | string | yes | `YYYY-MM-DD` |
| `dueDate` | string | no | `YYYY-MM-DD`; defaults to `issueDate` |
| `customerCui` | string | yes | `(RO)?\d{2,10}` — ANAF will be queried |
| `currency` | string | no | ISO 4217 code; default `RON` |
| `taxCurrencyTaxAmount` | number | no | Total VAT in RON when `currency ≠ RON`. Required for ANAF validation of non-RON invoices (BR-53 / BT-111) |
| `paymentIban` | string | no | |
| `note` | string | no | Free-form invoice note |
| `lines` | array | yes | Min 1. Each item: string shorthand or object (see below) |
| `overrides.supplier` | object | no | Any field overrides the ANAF-fetched value |
| `overrides.customer` | object | no | Any field overrides the ANAF-fetched value |
| `overrides.currency` | string | no | Fallback if top-level `currency` not set |
| `overrides.dueDate` | string | no | Fallback if top-level `dueDate` not set |
| `overrides.paymentIban` | string | no | Fallback if top-level `paymentIban` not set |
| `overrides.note` | string | no | Fallback if top-level `note` not set |

**Invoice line formats:**

```yaml
# String shorthand (4 or 5 pipe-separated segments):
lines:
  - "Serviciu consultanta|10|250|21"           # desc|qty|unitPrice|taxPct
  - "Ore de mentenanta|8|150|21|HUR"           # ...with unit code HUR (hour)
  - "Produs scutit TVA|5|100|0"                # 0% tax (VAT-exempt)

# Object form (same fields, explicit):
lines:
  - description: Licenta software
    quantity: 1
    unitPrice: 1500.00
    taxPercent: 21
    unitCode: C62    # optional
```

Both forms can be mixed in the same `lines` array. Common unit codes: `C62` (piece, default), `HUR` (hour), `KGM` (kilogram), `MTR` (metre), `LTR` (litre).

**Party override fields** (same shape for `overrides.supplier` and `overrides.customer`):

```yaml
overrides:
  supplier:
    registrationName: "New Legal Name SRL"
    companyId: "12345678"          # CUI digits, no RO prefix
    vatNumber: "RO12345678"        # only for VAT-registered companies
    telephone: "0264-123456"
    email: "contact@example.ro"
    address:
      street: "Str. Exemplu 10"
      city: "Cluj-Napoca"
      postalZone: "400000"
      county: "RO-CJ"             # ISO 3166-2:RO (RO-B for Bucharest)
      countryCode: "RO"
```

Any subset of party fields can be specified; the rest come from the ANAF lookup.

---

#### Kind: `EFacturaUpload`

Uploads an invoice XML to ANAF e-Factura. The XML source is one of: a file path, or an inline `UblBuild` spec (build-then-upload in one step).

```yaml
apiVersion: anaf-cli/v1
kind: EFacturaUpload
spec:
  source:
    xmlFile: ./invoice.xml         # option A: existing file
    # OR:
    ublBuild:                      # option B: build inline, then upload
      invoiceNumber: FCT-2026-0001
      issueDate: "2026-04-11"
      customerCui: "RO87654321"
      lines:
        - "Consultanta|10|250|21"
  upload:
    standard: UBL                  # optional, UBL | CN | CII | RASP — default UBL
    isB2C: false                   # optional, B2C upload
    isExecutare: false             # optional
output:
  mode: stdout                     # returns upload ID as JSON/text
```

Exactly one of `source.xmlFile` or `source.ublBuild` must be set. Using both (or neither) is a validation error.

**`spec.source` options:**

| Field | Type | Notes |
|-------|------|-------|
| `xmlFile` | string | Path to an existing XML file |
| `ublBuild` | object | Full `UblBuild` spec — built in-memory and uploaded immediately |

**`spec.upload` options:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `standard` | `UBL \| CN \| CII \| RASP` | `UBL` | Document standard |
| `isB2C` | boolean | — | Set `true` for B2C invoices |
| `isExecutare` | boolean | — | Set `true` for executor uploads |

> **Requires** `ANAF_CLIENT_SECRET` env var (or stored in credential via `cred set --client-secret`).

**Build-and-upload in one step:**

```yaml
apiVersion: anaf-cli/v1
kind: EFacturaUpload
spec:
  source:
    ublBuild:
      invoiceNumber: FCT-2026-0042
      issueDate: "2026-04-15"
      customerCui: "RO87654321"
      lines:
        - "Servicii IT|20|200|21"
        - description: Licenta anuala
          quantity: 1
          unitPrice: 5000
          taxPercent: 21
      paymentIban: RO49AAAA1B31007593840000
      note: "Termen de plata: 30 zile"
  upload:
    standard: UBL
```

---

#### Error codes from manifests

| Code | Cause |
|------|-------|
| `INVALID_MANIFEST_FILE` | File not found or not valid YAML/JSON |
| `UNSUPPORTED_API_VERSION` | `apiVersion` is not `anaf-cli/v1` |
| `UNKNOWN_MANIFEST_KIND` | `kind` is not `UblBuild` or `EFacturaUpload` |
| `INVALID_MANIFEST_DOCUMENT` | Unknown fields, wrong types, or missing required fields in envelope |
| `INVALID_INVOICE_INPUT` | `UblBuild` spec failed zod validation |
| `INVALID_UPLOAD_INPUT` | `EFacturaUpload` spec failed zod validation (e.g. no source, two sources) |
| `INVALID_DATE` | `issueDate` or `dueDate` not in `YYYY-MM-DD` format |
| `INVALID_CUI` | `customerCui` doesn't match `(RO)?\d{2,10}` |
| `INVALID_LINE` | Invoice line string doesn't have 4 or 5 segments |

## Global flags

| Flag | Description |
|------|-------------|
| `--format <fmt>` | Output format: `text` (default), `json`, or `yaml` |
| `--verbose` | Print HTTP requests and responses to stderr |
| `-v, --version` | Print version |
| `-h, --help` | Print help |

## Output formats

Every command supports `--format text|json|yaml`. The format applies to the entire response envelope.

### JSON (`--format json`)

Use for scripting and CI pipelines. Success goes to **stdout**, errors go to **stderr**.

```bash
$ anaf-cli efactura status --upload-id 12345 --format json
{"success":true,"data":{"stare":"ok","idDescarcare":"67890"}}

$ anaf-cli auth whoami --format json
{"success":true,"data":{"cui":"12345678","name":"SC ACME SRL","tokenStatus":"fresh","env":"test","expiresAt":"2026-07-11T..."}}
```

Error envelope (on stderr):

```json
{"success":false,"error":{"code":"AUTH_FAILED","message":"..."}}
```

### YAML (`--format yaml`)

Same envelope as JSON but YAML-serialised — useful for piping into config files or `yq`.

```bash
$ anaf-cli auth whoami --format yaml
success: true
data:
  cui: "12345678"
  name: SC ACME SRL
  env: test
  tokenStatus: fresh
  expiresAt: "2026-07-11T..."
```

### Scripting tips

```bash
# Extract a field with jq
anaf-cli efactura upload --xml invoice.xml --format json \
  | jq -r '.data.uploadId'

# Check exit code in CI
anaf-cli efactura status --upload-id 12345 --format json \
  && echo "ok" || echo "failed with exit $?"

# Pipe YAML output into yq
anaf-cli auth ls --format yaml | yq '.data.companies[].cui'
```

## Exit codes

| Code | Category | Meaning |
|------|----------|---------|
| 0 | success | Command completed |
| 1 | generic | Unexpected failure |
| 2 | user_input | Bad flags or input |
| 3 | auth | OAuth / token issue |
| 4 | anaf_api | ANAF rejected the request |
| 5 | local_state | Config / company file problem |

## Environment variables

| Variable | Description |
|----------|-------------|
| `ANAF_CLIENT_SECRET` | OAuth client secret (fallback when not stored in credential) |
| `XDG_CONFIG_HOME` | Override config dir (default: `~/.config`) |
| `XDG_DATA_HOME` | Override data dir (default: `~/.local/share`) |

## File locations

```
~/.config/anaf-cli/
  config.yaml              # active company CUI + default environment
  credential.yaml          # OAuth app credential (clientId, redirectUri, optional secret)
  companies/
    12345678.yaml          # company name + CUI, looked up from ANAF at login time
    87654321.yaml

~/.local/share/anaf-cli/
  tokens/token.json        # OAuth tokens (single shared token)
  tls/cert.pem, key.pem   # self-signed cert for callback server
```

## Development

```bash
pnpm install
pnpm --filter @florinszilagyi/anaf-ts-sdk run build
pnpm --filter @florinszilagyi/anaf-cli run verify   # lint + build + test
pnpm --filter @florinszilagyi/anaf-cli run test     # jest only
```

## License

MIT
