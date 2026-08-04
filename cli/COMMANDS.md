<!-- AUTO-GENERATED — do not edit by hand. Run: pnpm --filter anaf-cli exec tsx scripts/gen-docs.ts -->

# anaf-cli command reference

## Global options

```
Usage: anaf-cli [options] [command]

CLI for the ANAF e-Factura SDK

Options:
  -v, --version   print the CLI version
  --format <fmt>  output format: text, json, or yaml (default: text)
  --verbose       show HTTP requests and responses
  --no-color      disable ANSI color (reserved; no effect in current builds)
  -h, --help      display help for command

Commands:
  auth            Companies and OAuth authentication
  cred            Manage OAuth credentials
  efactura        e-Factura document operations
  lookup          Public ANAF company lookup
  ubl             UBL invoice authoring
  run [options]   Execute a manifest file (YAML or JSON)
  schema          Manifest schema utilities
  help [command]  display help for command
```

## `auth`

Companies and OAuth authentication

### `anaf-cli auth login`

Look up a company from ANAF, authenticate, and set as active

```
Usage: anaf-cli auth login [options] <cui>

Look up a company from ANAF, authenticate, and set as active

Options:
  --scope <scope>        OAuth scope override
  --no-callback-server   skip local server, print URL for manual flow
  --client-secret-stdin  read the client secret from stdin
  -v, --version          print the CLI version
  --format <fmt>         output format: text, json, or yaml (default: text)
  --verbose              show HTTP requests and responses
  --no-color             disable ANSI color (reserved; no effect in current
                         builds)
  -h, --help             display help for command
```

### `anaf-cli auth use`

Switch the active company

```
Usage: anaf-cli auth use [options] <cui>

Switch the active company

Options:
  -v, --version   print the CLI version
  --format <fmt>  output format: text, json, or yaml (default: text)
  --verbose       show HTTP requests and responses
  --no-color      disable ANSI color (reserved; no effect in current builds)
  -h, --help      display help for command
```

### `anaf-cli auth whoami`

Show active company + token status

```
Usage: anaf-cli auth whoami [options]

Show active company + token status

Options:
  -v, --version   print the CLI version
  --format <fmt>  output format: text, json, or yaml (default: text)
  --verbose       show HTTP requests and responses
  --no-color      disable ANSI color (reserved; no effect in current builds)
  -h, --help      display help for command
```

### `anaf-cli auth ls`

List all registered companies

```
Usage: anaf-cli auth ls [options]

List all registered companies

Options:
  -v, --version   print the CLI version
  --format <fmt>  output format: text, json, or yaml (default: text)
  --verbose       show HTTP requests and responses
  --no-color      disable ANSI color (reserved; no effect in current builds)
  -h, --help      display help for command
```

### `anaf-cli auth rm`

Remove a registered company

```
Usage: anaf-cli auth rm [options] <cui>

Remove a registered company

Options:
  -v, --version   print the CLI version
  --format <fmt>  output format: text, json, or yaml (default: text)
  --verbose       show HTTP requests and responses
  --no-color      disable ANSI color (reserved; no effect in current builds)
  -h, --help      display help for command
```

### `anaf-cli auth logout`

Discard tokens

```
Usage: anaf-cli auth logout [options]

Discard tokens

Options:
  -v, --version   print the CLI version
  --format <fmt>  output format: text, json, or yaml (default: text)
  --verbose       show HTTP requests and responses
  --no-color      disable ANSI color (reserved; no effect in current builds)
  -h, --help      display help for command
```

### `anaf-cli auth refresh`

Force-refresh the access token

```
Usage: anaf-cli auth refresh [options]

Force-refresh the access token

Options:
  --client-secret-stdin  read the client secret from stdin
  -v, --version          print the CLI version
  --format <fmt>         output format: text, json, or yaml (default: text)
  --verbose              show HTTP requests and responses
  --no-color             disable ANSI color (reserved; no effect in current
                         builds)
  -h, --help             display help for command
```

### `anaf-cli auth token`

Print the stored access and refresh tokens (for debugging)

```
Usage: anaf-cli auth token [options]

Print the stored access and refresh tokens (for debugging)

Options:
  --client-secret-stdin  refresh first, then print
  -v, --version          print the CLI version
  --format <fmt>         output format: text, json, or yaml (default: text)
  --verbose              show HTTP requests and responses
  --no-color             disable ANSI color (reserved; no effect in current
                         builds)
  -h, --help             display help for command
```

## `cred`

Manage OAuth credentials

### `anaf-cli cred set`

Set or update the OAuth credential

```
Usage: anaf-cli cred set [options]

Set or update the OAuth credential

Options:
  --client-id <id>          OAuth client id
  --client-secret <secret>  OAuth client secret
  --redirect-uri <uri>      OAuth redirect uri
  --env <env>               default environment (test|prod)
  -v, --version             print the CLI version
  --format <fmt>            output format: text, json, or yaml (default: text)
  --verbose                 show HTTP requests and responses
  --no-color                disable ANSI color (reserved; no effect in current
                            builds)
  -h, --help                display help for command
```

### `anaf-cli cred show`

Print the current credential (masked secret)

```
Usage: anaf-cli cred show [options]

Print the current credential (masked secret)

Options:
  -v, --version   print the CLI version
  --format <fmt>  output format: text, json, or yaml (default: text)
  --verbose       show HTTP requests and responses
  --no-color      disable ANSI color (reserved; no effect in current builds)
  -h, --help      display help for command
```

### `anaf-cli cred clear`

Remove the credential file

```
Usage: anaf-cli cred clear [options]

Remove the credential file

Options:
  -v, --version   print the CLI version
  --format <fmt>  output format: text, json, or yaml (default: text)
  --verbose       show HTTP requests and responses
  --no-color      disable ANSI color (reserved; no effect in current builds)
  -h, --help      display help for command
```

## `efactura`

e-Factura document operations

### `anaf-cli efactura upload`

Upload an XML document to e-Factura

```
Usage: anaf-cli efactura upload [options]

Upload an XML document to e-Factura

Options:
  --xml <path>           path to XML file
  --stdin                read XML from stdin
  --client-secret-stdin  read OAuth client secret from stdin
  --standard <std>       document standard (UBL|CN|CII|RASP)
  --extern               mark as external invoice
  --autofactura          mark as self-invoice
  --executare            execute immediately
  -v, --version          print the CLI version
  --format <fmt>         output format: text, json, or yaml (default: text)
  --verbose              show HTTP requests and responses
  --no-color             disable ANSI color (reserved; no effect in current
                         builds)
  -h, --help             display help for command
```

### `anaf-cli efactura upload-b2c`

Upload a B2C XML document

```
Usage: anaf-cli efactura upload-b2c [options]

Upload a B2C XML document

Options:
  --xml <path>           path to XML file
  --stdin                read XML from stdin
  --client-secret-stdin  read OAuth client secret from stdin
  --standard <std>       document standard (UBL|CN|CII|RASP)
  -v, --version          print the CLI version
  --format <fmt>         output format: text, json, or yaml (default: text)
  --verbose              show HTTP requests and responses
  --no-color             disable ANSI color (reserved; no effect in current
                         builds)
  -h, --help             display help for command
```

### `anaf-cli efactura status`

Check upload status

```
Usage: anaf-cli efactura status [options]

Check upload status

Options:
  --upload-id <id>       ANAF upload id
  --client-secret-stdin  read OAuth client secret from stdin
  -v, --version          print the CLI version
  --format <fmt>         output format: text, json, or yaml (default: text)
  --verbose              show HTTP requests and responses
  --no-color             disable ANSI color (reserved; no effect in current
                         builds)
  -h, --help             display help for command
```

### `anaf-cli efactura download`

Download an e-Factura document by id

```
Usage: anaf-cli efactura download [options]

Download an e-Factura document by id

Options:
  --download-id <id>     ANAF download id
  --out <path>           output file path
  --client-secret-stdin  read OAuth client secret from stdin
  -v, --version          print the CLI version
  --format <fmt>         output format: text, json, or yaml (default: text)
  --verbose              show HTTP requests and responses
  --no-color             disable ANSI color (reserved; no effect in current
                         builds)
  -h, --help             display help for command
```

### `anaf-cli efactura messages`

List recent e-Factura messages

```
Usage: anaf-cli efactura messages [options]

List recent e-Factura messages

Options:
  --days <n>             lookback window in days
  --filter <type>        sent | received | errors | buyer-messages (or raw:
                         T|P|E|R)
  --page <n>             page number
  --start-time <ms>      pagination start time (epoch ms)
  --end-time <ms>        pagination end time (epoch ms)
  --client-secret-stdin  read OAuth client secret from stdin
  -v, --version          print the CLI version
  --format <fmt>         output format: text, json, or yaml (default: text)
  --verbose              show HTTP requests and responses
  --no-color             disable ANSI color (reserved; no effect in current
                         builds)
  -h, --help             display help for command
```

### `anaf-cli efactura validate`

Validate an XML document via the ANAF tools service

```
Usage: anaf-cli efactura validate [options]

Validate an XML document via the ANAF tools service

Options:
  --xml <path>           path to XML file
  --stdin                read XML from stdin
  --standard <std>       standard (FACT1|FCN)
  --client-secret-stdin  read OAuth client secret from stdin
  -v, --version          print the CLI version
  --format <fmt>         output format: text, json, or yaml (default: text)
  --verbose              show HTTP requests and responses
  --no-color             disable ANSI color (reserved; no effect in current
                         builds)
  -h, --help             display help for command
```

### `anaf-cli efactura validate-signature`

Validate an XML signature via ANAF

```
Usage: anaf-cli efactura validate-signature [options]

Validate an XML signature via ANAF

Options:
  --xml <path>           path to XML file
  --signature <path>     path to signature file
  --client-secret-stdin  read OAuth client secret from stdin
  -v, --version          print the CLI version
  --format <fmt>         output format: text, json, or yaml (default: text)
  --verbose              show HTTP requests and responses
  --no-color             disable ANSI color (reserved; no effect in current
                         builds)
  -h, --help             display help for command
```

### `anaf-cli efactura pdf`

Convert an XML document to PDF via ANAF

```
Usage: anaf-cli efactura pdf [options]

Convert an XML document to PDF via ANAF

Options:
  --xml <path>           path to XML file
  --stdin                read XML from stdin
  --standard <std>       standard (FACT1|FCN)
  --no-validation        use the no-validation conversion endpoint
  --out <path>           output PDF file path
  --client-secret-stdin  read OAuth client secret from stdin
  -v, --version          print the CLI version
  --format <fmt>         output format: text, json, or yaml (default: text)
  --verbose              show HTTP requests and responses
  --no-color             disable ANSI color (reserved; no effect in current
                         builds)
  -h, --help             display help for command
```

## `lookup`

Public ANAF company lookup

### `anaf-cli lookup company`

Sync company data lookup (one or more CUIs)

```
Usage: anaf-cli lookup company [options] <cui...>

Sync company data lookup (one or more CUIs)

Options:
  --no-cache       bypass the company cache for both reads and writes
  --refresh-cache  force a fresh fetch and overwrite the cache
  -v, --version    print the CLI version
  --format <fmt>   output format: text, json, or yaml (default: text)
  --verbose        show HTTP requests and responses
  --no-color       disable ANSI color (reserved; no effect in current builds)
  -h, --help       display help for command
```

### `anaf-cli lookup company-async`

Async company lookup with submit + poll

```
Usage: anaf-cli lookup company-async [options] <cui>

Async company lookup with submit + poll

Options:
  --initial-delay <ms>  initial poll delay in ms
  --retry-delay <ms>    retry delay in ms
  --max-retries <n>     max poll attempts
  -v, --version         print the CLI version
  --format <fmt>        output format: text, json, or yaml (default: text)
  --verbose             show HTTP requests and responses
  --no-color            disable ANSI color (reserved; no effect in current
                        builds)
  -h, --help            display help for command
```

### `anaf-cli lookup validate-cui`

Cheap CUI format validation

```
Usage: anaf-cli lookup validate-cui [options] <cui>

Cheap CUI format validation

Options:
  -v, --version   print the CLI version
  --format <fmt>  output format: text, json, or yaml (default: text)
  --verbose       show HTTP requests and responses
  --no-color      disable ANSI color (reserved; no effect in current builds)
  -h, --help      display help for command
```

## `ubl`

UBL invoice authoring

### `anaf-cli ubl build`

Build a UBL invoice from flags or a structured input file

```
Usage: anaf-cli ubl build [options]

Build a UBL invoice from flags or a structured input file

Options:
  --invoice-number <n>                invoice number
  --issue-date <date>                 issue date (YYYY-MM-DD)
  --due-date <date>                   due date (YYYY-MM-DD)
  --customer-cui <cui>                customer CUI
  --line <line>                       invoice line:
                                      "desc|qty|unitPrice|taxPct[|unitCode]"
                                      (default: [])
  --invoice-type-code <code>          invoice type code (BT-3): 380 commercial
                                      (default), 384 corrective, 389
                                      self-billed, 751 accounting
  --currency <code>                   currency code
  --tax-currency-tax-amount <amount>  total VAT in RON (required when
                                      --currency is not RON, CIUS-RO BR-53)
  --payment-iban <iban>               payment IBAN
  --note <text>                       free-form note
  --out <path>                        output XML file path
  --from-json <path>                  load invoice from a JSON file
  --from-yaml <path>                  load invoice from a YAML file
  --supplier-name <name>              supplier registration name override
  --supplier-street <street>          supplier street override
  --supplier-city <city>              supplier city override
  --supplier-postal-zone <zone>       supplier postal zone override
  --supplier-country-code <code>      supplier country code override
  --customer-name <name>              customer registration name override
  --customer-street <street>          customer street override
  --customer-city <city>              customer city override
  --customer-postal-zone <zone>       customer postal zone override
  --customer-country-code <code>      customer country code override
  -v, --version                       print the CLI version
  --format <fmt>                      output format: text, json, or yaml
                                      (default: text)
  --verbose                           show HTTP requests and responses
  --no-color                          disable ANSI color (reserved; no effect
                                      in current builds)
  -h, --help                          display help for command
```

### `anaf-cli ubl inspect`

Inspect a UBL XML document and emit normalized JSON

```
Usage: anaf-cli ubl inspect [options]

Inspect a UBL XML document and emit normalized JSON

Options:
  --xml <path>    path to XML file
  -v, --version   print the CLI version
  --format <fmt>  output format: text, json, or yaml (default: text)
  --verbose       show HTTP requests and responses
  --no-color      disable ANSI color (reserved; no effect in current builds)
  -h, --help      display help for command
```

## `run`

Execute a manifest file (YAML or JSON)

```
Usage: anaf-cli run [options]

Execute a manifest file (YAML or JSON)

Options:
  -f, --file <path>  path to the manifest file
  --dry-run          normalize the action but do not execute
  -v, --version      print the CLI version
  --format <fmt>     output format: text, json, or yaml (default: text)
  --verbose          show HTTP requests and responses
  --no-color         disable ANSI color (reserved; no effect in current builds)
  -h, --help         display help for command
```

## `schema`

Manifest schema utilities

### `anaf-cli schema print`

Print the JSON schema for a manifest kind (UblBuild | EFacturaUpload)

```
Usage: anaf-cli schema print [options] <kind>

Print the JSON schema for a manifest kind (UblBuild | EFacturaUpload)

Options:
  -v, --version   print the CLI version
  --format <fmt>  output format: text, json, or yaml (default: text)
  --verbose       show HTTP requests and responses
  --no-color      disable ANSI color (reserved; no effect in current builds)
  -h, --help      display help for command
```
