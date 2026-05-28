# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
