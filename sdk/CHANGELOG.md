# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.1] - 2026-08-06

### Fixed

- Document-level allowances/charges no longer collapse VAT breakdown groups
  that share a category but differ in rate (e.g. Romania's 21% and 11%, both
  category `S`). Tax groups are now keyed by the (category, percent) pair, so
  a mixed-rate invoice with a document discount emits one `cac:TaxSubtotal`
  per rate. Additionally, an allowance whose category matches several line
  rates without an explicit `taxPercent` now throws instead of silently
  inheriting the first rate.

## [1.5.0] - 2026-08-04

### Added

- **`InvoiceInput.invoiceTypeCode`** — optional invoice type code (BT-3),
  emitted as `cbc:InvoiceTypeCode`. Accepts the CIUS-RO subset of UNTDID 1001:
  `'380'` (commercial invoice), `'384'` (corrective invoice), `'389'`
  (self-billed invoice), `'751'` (invoice information for accounting purposes).
  Any other value is rejected locally with an `AnafValidationError` naming the
  allowed codes — instead of an opaque schematron rejection from ANAF after
  upload.

  ```typescript
  builder.generateInvoiceXml({
    // ...
    invoiceTypeCode: '751', // omit for the default '380'
  });
  ```

  Backwards compatible: when omitted, the type code defaults to `'380'` and the
  emitted XML is byte-identical to previous versions.

## [1.4.0] - 2026-06-16

### Added

- **`InvoiceInput.billingReference`** — an optional reference to a preceding
  invoice (BG-3 / BT-25, BT-26), emitted as `cac:BillingReference` /
  `cac:InvoiceDocumentReference` at its UBL 2.1 slot (after `cac:InvoicePeriod`,
  before the parties). `cbc:IssueDate` (BT-26) is omitted when the referenced
  invoice's issue date is not supplied.

  ```typescript
  // Storno (reversal) of invoice PA-2026-00042: a single −1 × 100 @ 19% line.
  builder.generateInvoiceXml({
    // ...
    lines: [{ description: 'Storno servicii', quantity: -1, unitPrice: 100, taxPercent: 19 }],
    billingReference: { invoiceId: 'PA-2026-00042', issueDate: '2026-05-10' },
  });
  ```

- **Corrective ("storno") invoice support.** When a `billingReference` is
  present the document is treated as corrective: negative line **quantities**
  are allowed (so the line nets out as a reversal), the `cbc:PayableAmount`
  zero-clamp is skipped (the total is legitimately negative), and the prepaid
  upper-bound guard is bypassed. The item net price `cac:Price/cbc:PriceAmount`
  stays non-negative (EN16931 BR-27) — the reversal sign lives on the quantity,
  never on the price. The `cbc:InvoiceTypeCode` remains `'380'` (this is not a
  credit note). A zero quantity is still rejected in every mode.

  Normal (non-corrective) invoices — those without a `billingReference` — are
  completely unchanged: the emitted XML, totals, and validation behaviour are
  byte-identical to previous versions.

### Fixed

- **UBL-CR-480** — document-level `AllowanceCharge` entries no longer emit
  `cbc:TaxExemptionReasonCode` inside their `cac:TaxCategory`, which ANAF rejects
  via schematron rule `UBL-CR-480`. The exemption reason (BT-121) remains where
  it is valid, on `cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory`. This affected
  only allowances/charges resolving to an exempt-style category (`O` for non-VAT
  suppliers, or an inherited `E`/`Z`/`AE` line group); standard-rated (`S`)
  allowances were never affected, which is why the rejection hit ~1% of invoices.

## [1.3.2] - 2026-05-29

### Added

- **`InvoiceInput.documentAllowanceCharges`** — document-level allowances
  (discounts) and charges (extra fees), emitted as `cac:AllowanceCharge`
  children of `cac:Invoice` per UBL 2.1 / CIUS-RO. This is the canonical way
  to express things like voucher discounts on a kiosk receipt — previously
  callers tried to encode them as negative-priced `InvoiceLine` entries,
  which is invalid UBL and rejected by the SDK's `unitPrice >= 0`
  validation.

  ```typescript
  // 50 RON service, 45 RON voucher discount, customer pays 5 RON.
  builder.generateInvoiceXml({
    // ...
    lines: [{ description: 'Wash', quantity: 1, unitPrice: 50, taxPercent: 0 }],
    documentAllowanceCharges: [
      { chargeIndicator: false, amount: 45, reason: 'Voucher' },
    ],
    prepaidAmount: 5, // → PayableAmount = 0
  });
  ```

  Each allowance/charge carries a `TaxCategory` (inherited from the lines
  when they share a single category, or explicit via `taxCategoryId` +
  `taxPercent`). `LegalMonetaryTotal` is recomputed accordingly:
  `TaxExclusiveAmount = LineExtension − AllowanceTotal + ChargeTotal`, and
  the matching `cac:TaxSubtotal` taxable base is adjusted to satisfy
  BR-CO-17 / BR-DEC-19. `cbc:AllowanceTotalAmount` (BT-107) and
  `cbc:ChargeTotalAmount` (BT-108) are emitted when non-zero.

  Defaults that minimize caller pain:
  - `reasonCode` defaults to `'95'` (Discount) for allowances and `'ZZZ'`
    (Mutually defined) for charges.
  - `taxCategoryId` / `taxPercent` are inherited from the lines' single tax
    group; an `AnafValidationError` is thrown if the lines have mixed
    categories and the allowance doesn't disambiguate.
  - Non-VAT suppliers (`isSupplierVatPayer: false`) coerce every
    allowance/charge to category `'O'` with the matching
    `VATEX-EU-O` exemption code, mirroring how line tax categories are
    coerced.

  Validation: each entry must have `amount > 0` and a non-empty `reason`.

  Backwards compatible: omitting the field (or passing `[]`) produces XML
  byte-identical to v1.3.1.

## [1.3.0] - 2026-05-28

### Added

- **`InvoiceInput.paymentMeansCode`** — override the hardcoded `31` (SEPA credit
  transfer) with any UN/ECE 4461 code (`10` cash, `48` bank card, `30` credit
  transfer, etc.). Backwards compatible: when omitted and `paymentIban` is set,
  defaults to `31` to preserve the old behaviour. When `paymentMeansCode` is set
  without `paymentIban`, the `<cac:PaymentMeans>` block is still emitted but
  with no `<cac:PayeeFinancialAccount>` — the right shape for cash and card
  payments captured at a POS / kiosk.
- **`InvoiceInput.prepaidAmount`** — emit `<cbc:PrepaidAmount>` inside
  `<cac:LegalMonetaryTotal>` and auto-recompute `<cbc:PayableAmount>` as
  `TaxInclusiveAmount − PrepaidAmount`, satisfying CIUS-RO rule BR-CO-25.
  A fully-paid invoice (e.g. cash at kiosk) therefore renders with
  `PayableAmount = 0.00`. Rejected at build time if `prepaidAmount > grandTotal`
  (with a 1-cent rounding tolerance) or if it is negative.
- Validated end-to-end against the live ANAF test-mode validator
  (`EfacturaToolsClient.validateXml`) — a fully-prepaid cash invoice returns
  `valid: true`.

## [1.2.0] - 2026-05-08

### Fixed

- **Binary downloads no longer corrupted.** ANAF returns invoice ZIP archives
  with `Content-Type: application/zip`, which the HTTP layer was routing
  through `response.text()` and UTF-8-decoding into garbage bytes.
  `EfacturaClient.downloadDocument()` now consistently returns intact binary
  data.

### Changed

- **`EfacturaClient.downloadDocument()` and `AnafEfacturaClient.downloadDocument()`
  now return `Promise<Buffer>` instead of `Promise<string>`.** The previous
  string return was always corrupted bytes, so no working consumer could have
  relied on it; this is a type-level cleanup of a broken contract. Callers
  should write the buffer straight to disk (or pipe it).
- **`HttpClient.parseResponse` now defaults to `arrayBuffer()` and only
  decodes text for known text content types** (`text/*`, `application/xml`,
  `application/*+xml`, `application/x-www-form-urlencoded`). JSON detection
  is unchanged. This is a fail-closed posture: a future ANAF endpoint that
  returns a new binary content-type will surface as `ArrayBuffer` instead of
  silently corrupting bytes via `text()`.

## [1.0.0] - 2025-01-25

### Added

#### Core Features
- **Complete ANAF e-Factura API Integration**
  - OAuth2 authentication with automatic token refresh
  - Certificate-based authentication support (USB tokens, smart cards)
  - Document upload (standard and B2C)
  - Upload status checking and document download
  - Message listing with pagination and filtering
  - XML validation with FACT1 and FCN standards
  - PDF conversion with and without validation

#### UBL XML Generation
- **UBL 2.1 Invoice Builder** compliant with Romanian CIUS-RO specification
- Support for multiple VAT rates and tax categories
- Automatic tax calculation and grouping
- Proper XML encoding and character escaping
- Comprehensive validation for all invoice components
- Support for empty invoices and zero-value lines
- Decimal precision handling for financial calculations

#### HTTP Client Architecture
- **Native Fetch Implementation** replacing Axios
- Custom `HttpClient` with timeout support via AbortController
- Automatic status code checking and error handling
- Response type parsing (JSON, text, ArrayBuffer)
- Built-in development logging
- Reduced bundle size by ~13KB

#### Error Handling
- **Custom Error Types**:
  - `AnafValidationError` for input validation failures
  - `AnafApiError` for API-related errors
  - `AnafAuthenticationError` for authentication issues
- Comprehensive error messages with context
- Proper error propagation and handling

#### Validation & Utilities
- **Robust Input Validation**
  - Parameter validation for all API methods
  - Enum validation for document standards and filters
  - File type validation for signature verification
  - Date formatting utilities for ANAF API compatibility
- **tryCatch Utility** for consistent error handling
- **XML Parsing** with proper attribute handling

#### Testing Infrastructure
- **Comprehensive Test Suite** (94 tests total)
  - Unit tests for all core functionality (70 passing)
  - Integration tests with OAuth flow simulation
  - UBL builder tests with edge cases
  - Mock system with realistic API responses
- **Test Coverage** with 80% threshold for all metrics
- **Performance Tests** for XML generation efficiency

#### Developer Experience
- **Full TypeScript Support** with comprehensive type definitions
- **ESLint & Prettier** configuration for code quality
- **Jest** testing framework with coverage reporting
- **TypeDoc** documentation generation
- **Multiple Build Targets** (CommonJS, ESM, TypeScript declarations)

### Technical Specifications

#### Dependencies
- `date-fns` ^3.6.0 - Date manipulation utilities
- `qs` ^6.11.2 - Query string parsing
- `xml2js` ^0.6.2 - XML parsing
- `xmlbuilder2` ^3.1.1 - XML generation

#### Compatibility
- **Node.js** >= 14.0.0
- **NPM** >= 6.0.0
- **TypeScript** ^5.3.3
- **Modern Browsers** with fetch support

#### Build Outputs
- **CommonJS** (`dist/index.js`) - Node.js compatibility
- **ES Modules** (`dist/index.esm.js`) - Modern bundlers
- **TypeScript Declarations** (`dist/index.d.ts`) - Type support

### Documentation
- Comprehensive README with setup instructions
- API documentation with examples
- OAuth2 flow documentation
- UBL invoice generation examples
- Integration test examples

### Performance
- **Fast XML Generation**: 100 simple invoices in <1 second
- **Large Invoice Support**: 100-line invoices in <500ms
- **Lightweight Bundle**: Reduced size with native fetch
- **Memory Efficient**: Proper resource cleanup

### Security
- **OAuth2 Best Practices** with PKCE support
- **Certificate Authentication** for enhanced security
- **Input Sanitization** and validation
- **Secure Token Storage** recommendations

---

## Future Releases

### Planned Features
- Batch document processing
- Webhook support for status notifications
- Additional document standards (CII, CN)
- Enhanced error recovery mechanisms
- Performance optimizations
- Additional validation rules

---

## Contributing

Please read our contributing guidelines and ensure all tests pass before submitting pull requests.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
