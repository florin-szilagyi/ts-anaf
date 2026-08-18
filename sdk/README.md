# ANAF e-Factura TypeScript SDK

A comprehensive TypeScript SDK for interacting with the Romanian ANAF e-Factura system. This SDK provides OAuth 2.0 authentication, document upload/download, validation, UBL generation, and company data lookup capabilities.

## Features

- **OAuth 2.0 Authentication**: Complete OAuth flow with USB token support
- **Document Operations**: Upload, status checking, and download
- **Message Management**: List and paginate invoice messages
- **Validation**: XML validation and digital signature verification
- **PDF Conversion**: Convert XML invoices to PDF format
- **UBL Generation**: Create compliant UBL 2.1 XML invoices
- **Company Data Lookup**: Fetch Romanian company details from public ANAF API
- **TypeScript**: Full type safety and IntelliSense support

## Installation

```bash
pnpm add @florinszilagyi/anaf-ts-sdk
```

## Quick Start

The SDK is organized into four main classes:

### 1. AnafAuthenticator - OAuth 2.0 Authentication

```typescript
import { AnafAuthenticator } from '@florinszilagyi/anaf-ts-sdk';

const auth = new AnafAuthenticator({
  clientId: 'your-oauth-client-id',
  clientSecret: 'your-oauth-client-secret',
  redirectUri: 'https://your-app.com/oauth/callback',
});

// Get authorization URL (user will authenticate with USB token)
const authUrl = auth.getAuthorizationUrl();
console.log('Redirect user to:', authUrl);

// Exchange authorization code for tokens
const tokens = await auth.exchangeCodeForToken(authorizationCode);
console.log('Access token:', tokens.access_token);

// Refresh tokens when needed
const newTokens = await auth.refreshAccessToken(tokens.refresh_token);
```

### 2. AnafClient - API Operations

```typescript
import { AnafClient } from '@florinszilagyi/anaf-ts-sdk';

const client = new AnafClient({
  vatNumber: 'RO12345678',
  testMode: true, // Use test environment
});

// Upload a document
const uploadResult = await client.uploadDocument(tokens.access_token, xmlContent, {
  standard: 'UBL',
  executare: true,
});

// Check upload status
const status = await client.getUploadStatus(tokens.access_token, uploadResult.index_incarcare);

// Download processed document (ZIP archive: invoice + detached signature)
if (status.id_descarcare) {
  const result = await client.downloadDocument(tokens.access_token, status.id_descarcare);

  // Or unwrap the archive and get the invoice XML directly
  const invoiceXml = await client.downloadDocumentXml(status.id_descarcare);

  // …which is what you need to render the invoice as a PDF
  const pdf = await client.convertXmlToPdf(invoiceXml, 'FACT1');
}

// List recent messages
const messages = await client.getMessages(tokens.access_token, {
  zile: 7, // Last 7 days
  filtru: 'E', // Only errors
});

// Validate XML
const validation = await client.validateXml(tokens.access_token, xmlContent, 'FACT1');

// Convert XML to PDF
const pdfBuffer = await client.convertXmlToPdf(tokens.access_token, xmlContent, 'FACT1');
```

### 3. UblBuilder - UBL XML Generation

```typescript
import { UblBuilder } from '@florinszilagyi/anaf-ts-sdk';

const builder = new UblBuilder();

const xml = builder.generateInvoiceXml({
  invoiceNumber: 'INV-2024-001',
  issueDate: new Date(),
  supplier: {
    registrationName: 'Company SRL',
    companyId: 'RO12345678',
    vatNumber: 'RO12345678',
    address: {
      street: 'Str. Example 1',
      city: 'Bucharest',
      postalZone: '010101',
    },
  },
  customer: {
    registrationName: 'Customer SRL',
    companyId: 'RO87654321',
    address: {
      street: 'Str. Customer 2',
      city: 'Cluj-Napoca',
      postalZone: '400001',
    },
  },
  lines: [
    {
      description: 'Product/Service',
      quantity: 1,
      unitPrice: 100,
      taxPercent: 19,
    },
  ],
  isSupplierVatPayer: true,
});
```

### 4. AnafDetailsClient - Company Data Lookup

```typescript
import { AnafDetailsClient } from '@florinszilagyi/anaf-ts-sdk';

const detailsClient = new AnafDetailsClient({
  timeout: 30000,
  url: 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva', // Optional: custom ANAF API URL
});

// Fetch company data by VAT code (single company)
const result = await detailsClient.getCompanyData('RO12345678');
if (result.success) {
  console.log('Company:', result.data[0].name);
  console.log('Address:', result.data[0].address);
  console.log('VAT registered:', result.data[0].scpTva);
  console.log('Registration number:', result.data[0].registrationNumber);
  console.log('Phone:', result.data[0].contactPhone);
} else {
  console.error('Error:', result.error);
}

// Validate VAT code format
const isValid = await detailsClient.isValidVatCode('RO12345678');
console.log('Valid format:', isValid);

// Batch fetch multiple companies (single API call)
const batchResult = await detailsClient.batchGetCompanyData(['RO12345678', 'RO87654321', 'RO11111111']);
if (batchResult.success) {
  batchResult.data.forEach((company, index) => {
    console.log(`Company ${index + 1}:`, company.name);
    console.log(`VAT registered:`, company.scpTva);
  });
} else {
  console.error('Batch error:', batchResult.error);
}

// Configuration options
const customClient = new AnafDetailsClient({
  timeout: 60000, // 60 second timeout
  url: 'https://custom-anaf-proxy.example.com/api/tva', // Custom endpoint (e.g., proxy server)
});
```

## AnafDetailsClient Configuration

The `AnafDetailsClient` supports the following configuration options:

| Option    | Type     | Default                                                     | Description                     |
| --------- | -------- | ----------------------------------------------------------- | ------------------------------- |
| `timeout` | `number` | `30000`                                                     | Request timeout in milliseconds |
| `url`     | `string` | `'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva'` | ANAF API endpoint URL           |

### Configuration Examples

```typescript
// Default configuration
const client = new AnafDetailsClient();

// Custom timeout
const clientWithTimeout = new AnafDetailsClient({
  timeout: 60000, // 60 seconds
});

// Custom API endpoint (useful for proxy servers or testing)
const clientWithCustomUrl = new AnafDetailsClient({
  url: 'https://your-proxy.example.com/anaf-api',
  timeout: 45000,
});

// Minimal configuration
const minimalClient = new AnafDetailsClient({
  timeout: 15000, // Fast timeout for quick responses
});
```

### Use Cases for Custom URL

- **Proxy Server**: Route requests through your own proxy for logging/monitoring
- **Load Balancer**: Distribute requests across multiple ANAF endpoints
- **Testing**: Point to a mock server during development
- **Regional Endpoints**: Use different ANAF regional servers if available
- **Corporate Firewall**: Route through approved corporate gateways

## Complete Example

```typescript
import { AnafAuthenticator, AnafClient, AnafDetailsClient, UblBuilder } from '@florinszilagyi/anaf-ts-sdk';

// Setup
const auth = new AnafAuthenticator({
  clientId: process.env.ANAF_CLIENT_ID,
  clientSecret: process.env.ANAF_CLIENT_SECRET,
  redirectUri: 'https://myapp.com/oauth/callback',
});

const client = new AnafClient({
  vatNumber: 'RO12345678',
  testMode: true,
});

const detailsClient = new AnafDetailsClient();
const builder = new UblBuilder();

// 1. Get customer company data
const customerData = await detailsClient.getCompanyData('RO87654321');
if (!customerData.success) {
  throw new Error(`Customer not found: ${customerData.error}`);
}

// 2. Authentication (one-time setup)
const authUrl = auth.getAuthorizationUrl();
// Direct user to authUrl, they authenticate with USB token
const tokens = await auth.exchangeCodeForToken(authCode);

// 3. Generate invoice XML using fetched company data
const xml = builder.generateInvoiceXml({
  invoiceNumber: 'INV-2024-001',
  issueDate: new Date(),
  supplier: {
    registrationName: 'My Company SRL',
    companyId: 'RO12345678',
    vatNumber: 'RO12345678',
    address: {
      street: 'Str. Example 1',
      city: 'Bucharest',
      postalZone: '010101',
    },
  },
  customer: {
    registrationName: customerData.data[0].name,
    companyId: customerData.data[0].vatCode,
    vatNumber: customerData.data[0].vatCode,
    address: {
      street: customerData.data[0].address,
      city: 'Cluj-Napoca', // Parse from address if needed
      postalZone: customerData.data[0].postalCode || '400001',
    },
  },
  lines: [
    {
      description: 'Consulting Services',
      quantity: 1,
      unitPrice: 1000,
      taxPercent: customerData.data[0].scpTva ? 19 : 0, // Apply VAT if customer is VAT registered
    },
  ],
  isSupplierVatPayer: true,
});

// 4. Upload to ANAF
const uploadResult = await client.uploadDocument(tokens.access_token, xml);

// 5. Monitor status
const status = await client.getUploadStatus(tokens.access_token, uploadResult.index_incarcare);

// 6. Download result
if (status.id_descarcare) {
  const result = await client.downloadDocument(tokens.access_token, status.id_descarcare);
}
```

## Development & Testing

### Prerequisites

1. **USB Security Token**: Required for ANAF authentication

   - Supported tokens: Any qualified certificate from Romanian CA
   - Install manufacturer drivers (SafeNet, Gemalto, etc.)
   - Certificate must be registered with ANAF SPV

2. **ANAF OAuth Application**: Register at [ANAF Portal](https://anaf.ro)
   - Navigate: Servicii Online → Înregistrare utilizatori → DEZVOLTATORI APLICAȚII
   - Register application with your callback URL

### Environment Setup

Create a `.env` file in your project root:

```env
ANAF_CLIENT_ID=your_oauth_client_id_here
ANAF_CLIENT_SECRET=your_oauth_client_secret_here
```

### Local Development with ngrok

For local testing, you need a public HTTPS URL for OAuth callbacks:

1. **Install ngrok**:

   ```bash
   # Using npm
   npm install -g ngrok

   # Or download from https://ngrok.com/
   ```

2. **Expose local server**:

   ```bash
   # Start your local server on port 3000
   npm start

   # In another terminal, expose it publicly
   ngrok http 3000
   ```

3. **Update OAuth Settings**:

   - Copy the ngrok HTTPS URL (e.g., `https://abc123.ngrok.io`)
   - Register callback URL: `https://abc123.ngrok.io/oauth/callback`
   - Update your AnafAuthenticator configuration:

   ```typescript
   const auth = new AnafAuthenticator({
     clientId: process.env.ANAF_CLIENT_ID,
     clientSecret: process.env.ANAF_CLIENT_SECRET,
     redirectUri: 'https://abc123.ngrok.io/oauth/callback', // Your ngrok URL
   });
   ```

### OAuth Authentication Flow

The complete OAuth flow with USB token authentication:

1. **Generate Authorization URL**:

   ```typescript
   const authUrl = auth.getAuthorizationUrl();
   console.log('Direct user to:', authUrl);
   ```

2. **User Authentication Process**:

   - User clicks/visits the authorization URL
   - ANAF login page opens
   - **Insert USB Token**: User inserts USB security token
   - **Enter PIN**: User enters token PIN when prompted
   - **Certificate Selection**: Browser shows certificate selection dialog
   - **Select Certificate**: User selects appropriate certificate
   - **Authorize Application**: User grants permissions to your app
   - **Redirect**: Browser redirects to your callback URL with authorization code

3. **Handle Callback**:

   ```typescript
   // Your callback endpoint receives: ?code=AUTH_CODE&state=STATE
   app.get('/oauth/callback', async (req, res) => {
     const { code } = req.query;

     try {
       const tokens = await auth.exchangeCodeForToken(code);
       // Store tokens securely
       res.send('Authentication successful!');
     } catch (error) {
       res.status(400).send('Authentication failed');
     }
   });
   ```

4. **Use Access Token**:

   ```typescript
   // Token is valid for 1 hour
   const client = new AnafClient({ vatNumber: 'RO12345678' });
   const result = await client.uploadDocument(tokens.access_token, xmlContent);
   ```

5. **Refresh Tokens**:
   ```typescript
   // Refresh before expiration
   const newTokens = await auth.refreshAccessToken(tokens.refresh_token);
   ```

### Automated Testing

The SDK includes comprehensive Jest tests with an integrated OAuth flow:

```bash
# Run all tests
pnpm test

# Run OAuth authentication tests with callback server
pnpm test:auth

# Run tests with coverage
pnpm test:coverage
```

### Manual OAuth Testing

The test suite includes a helpful OAuth testing flow:

1. **Start Test**:

   ```bash
   pnpm test:auth
   ```

2. **Callback Server**: Automatically starts on `http://localhost:4040`

3. **Get OAuth URL**: Test displays authorization URL in console

4. **Complete OAuth**:

   - Copy URL to browser
   - Insert USB token when prompted
   - Enter PIN and select certificate
   - Authorize application
   - Browser redirects to `localhost:4040/callback`

5. **Automatic Token Handling**: Test captures code and exchanges for tokens

### Testing Environment

- **Test Environment**: All tests use ANAF test environment
- **OAuth Endpoints**: `logincert.anaf.ro`
- **API Endpoints**: `api.anaf.ro/test`
- **Callback URL**: `http://localhost:4040/callback` (for tests)

### Token Management

- Tokens are automatically saved to `token.secret` during tests
- Access tokens expire in 1 hour
- Refresh tokens have longer validity
- Tests automatically refresh expired tokens
- Invalid tokens are cleaned up automatically

### Troubleshooting

#### USB Token Issues

```
❌ Certificate selection failed
```

**Solutions**:

- Ensure USB token is properly inserted
- Install manufacturer drivers
- Try different browsers (Chrome recommended)
- Check certificate validity in browser settings

#### OAuth Callback Issues

```
❌ Redirect URI mismatch
```

**Solutions**:

- Verify callback URL matches registered URL exactly
- Include protocol (https://) and path
- For ngrok: use HTTPS URL, not HTTP
- Check for trailing slashes

#### Network Issues

```
❌ Connection refused or timeout
```

**Solutions**:

- Check internet connection
- Verify firewall settings
- For ngrok: ensure tunnel is active
- Try different ngrok region: `ngrok http 3000 --region eu`

#### Token Expiration

```
❌ Access token expired
```

**Solutions**:

- Use refresh token to get new access token
- Implement automatic token refresh in your app
- Store token expiration time and refresh proactively

## API Coverage

The SDK implements all endpoints from the ANAF e-Factura OpenAPI specification:

### Authentication

- ✅ OAuth 2.0 authorization flow
- ✅ Token exchange and refresh

### Document Operations

- ✅ Upload documents (`/upload`, `/uploadb2c`)
- ✅ Check upload status (`/stareMesaj`)
- ✅ Download processed documents (`/descarcare`)

### Message Management

- ✅ List messages with pagination (`/listaMesajePaginatieFactura`)
- ✅ List recent messages (`/listaMesajeFactura`)

### Validation & Conversion

- ✅ XML validation (`/validare/{standard}`)
- ✅ Digital signature validation (`/api/validate/signature`)
- ✅ XML to PDF conversion (`/transformare/{standard}`)
- ✅ XML to PDF without validation (`/transformare/{standard}/DA`)

### UBL Generation

- ✅ UBL 2.1 compliant XML generation
- ✅ Romanian CIUS-RO specification support

### Company Data Lookup

- ✅ Fetch company data by VAT code
- ✅ Validate VAT code format
- ✅ Batch fetch multiple companies
- ✅ Cache management

## Environment Configuration

The SDK supports both test and production environments:

```typescript
// Test environment (recommended for development)
const client = new AnafClient({
  vatNumber: 'RO12345678',
  testMode: true,
});

// Production environment
const client = new AnafClient({
  vatNumber: 'RO12345678',
  testMode: false,
});
```

## Error Handling

The SDK provides specific error types for different scenarios:

```typescript
import { AnafAuthenticationError, AnafValidationError, AnafApiError } from '@florinszilagyi/anaf-ts-sdk';

try {
  await client.uploadDocument(token, xml);
} catch (error) {
  if (error instanceof AnafAuthenticationError) {
    // Handle authentication issues - refresh token or re-authenticate
    console.log('Authentication failed:', error.message);
  } else if (error instanceof AnafValidationError) {
    // Handle validation errors - fix XML or parameters
    console.log('Validation error:', error.message);
  } else if (error instanceof AnafApiError) {
    // Handle API errors - check status, retry, or contact support
    console.log('API error:', error.message);
  }
}
```

## TypeScript Support

The SDK is written in TypeScript and provides comprehensive type definitions:

```typescript
import type { InvoiceInput, UploadStatus, ListMessagesResponse, ValidationResult, OAuthTokens } from '@florinszilagyi/anaf-ts-sdk';
```

## Security Best Practices

- **Never commit tokens**: Add `token.secret` and `.env` to `.gitignore`
- **Use HTTPS**: Always use HTTPS for OAuth callbacks in production
- **Validate certificates**: Ensure USB token certificates are valid and not expired
- **Secure token storage**: Store tokens securely (encrypted, database, secure storage)
- **Implement refresh**: Automatically refresh tokens before expiration
- **Test environment**: Use test mode for development and staging

## Production Deployment

When deploying to production:

1. **Register Production OAuth App**:

   - Use your production domain for callback URL
   - Get separate client credentials for production

2. **Environment Configuration**:

   ```typescript
   const client = new AnafClient({
     vatNumber: 'RO12345678',
     testMode: false, // Production mode
   });
   ```

3. **Secure Callback Handling**:

   - Use HTTPS for all OAuth callbacks
   - Validate state parameter
   - Implement CSRF protection
   - Log authentication events

4. **Token Management**:
   - Store tokens securely (encrypted database)
   - Implement automatic refresh
   - Handle refresh token expiration gracefully
   - Monitor token usage and expiration

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run tests and linting
6. Submit a pull request

## Support

For questions about:

- **ANAF e-Factura API**: Check [ANAF official documentation](https://mfinante.gov.ro/web/efactura/informatii-tehnice)
- **This SDK**: Open an issue on GitHub
- **OAuth Setup**: Consult ANAF SPV documentation: [ANAF official documentation](https://static.anaf.ro/static/10/Anaf/Informatii_R/API/Oauth_procedura_inregistrare_aplicatii_portal_ANAF.pdf)
- **USB Token Issues**: Contact your certificate provider

---

**Perfect for**: SaaS applications, accounting software, ERP integrations, invoicing systems

**Requirements**: USB security token, ANAF OAuth registration, Node.js 16+
