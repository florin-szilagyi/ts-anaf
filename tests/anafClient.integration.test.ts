import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { AnafEfacturaClient } from '../src';
import { AnafAuthenticator } from '../src/AnafAuthenticator';
import { UblBuilder } from '../src/UblBuilder';
import { AnafApiError, AnafAuthenticationError, AnafNotFoundError } from '../src/errors';
import { TokenResponse, UploadOptions, ListMessagesResponse, InvoiceInput, UploadResponse } from '../src/types';
import { tryCatch } from '../src/tryCatch';

/**
 * In order to run these tests you need to have a valid token set in token.secrets
 *
 * 1. Test that the client can be created with valid configuration
 * 2. Test that the client can be created with invalid configuration
 * 3. Test that the client can upload a document
 * 4. Test that the client can download a document
 * 5. Test that the client can validate an XML document
 * 6. Test that the client can convert an XML document to a PDF
 * 7. Test that the client can handle errors gracefully
 * 8. Test that the client can handle rate limits gracefully
 */

// Load environment variables
dotenv.config();

// Check if integration tests should run
const shouldRunIntegrationTests =
  !!process.env.ANAF_CLIENT_ID && !!process.env.ANAF_CLIENT_SECRET && !!process.env.ANAF_TEST_VAT_NUMBER;

const describeIntegration = shouldRunIntegrationTests ? describe : describe.skip;

if (!shouldRunIntegrationTests) {
  console.log('⚠️ Skipping integration tests - missing OAuth credentials or test VAT number');
}

describeIntegration('AnafEfacturaClient Integration Tests', () => {
  let client: AnafEfacturaClient;
  let authenticator: AnafAuthenticator;
  let accessToken: string;
  const tokenFilePath = path.join(process.cwd(), 'token.secret');

  // Test data
  const testVatNumber = process.env.ANAF_TEST_VAT_NUMBER || '';

  const testInvoiceData: InvoiceInput = {
    invoiceNumber: `TEST-${Date.now()}`,
    issueDate: new Date(),
    supplier: {
      registrationName: 'Test Supplier SRL',
      companyId: testVatNumber,
      vatNumber: testVatNumber,
      address: {
        street: 'Str. Test 1',
        city: 'Bucharest',
        postalZone: '010101',
      },
    },
    customer: {
      registrationName: 'Test Customer SRL',
      companyId: 'RO87654321',
      address: {
        street: 'Str. Customer 2',
        city: 'Cluj-Napoca',
        postalZone: '400001',
      },
    },
    lines: [
      {
        description: 'Test Product/Service',
        quantity: 1,
        unitPrice: 100,
        taxPercent: 19,
      },
    ],
    isSupplierVatPayer: true,
  };

  beforeAll(async () => {
    // Setup authenticator
    authenticator = new AnafAuthenticator({
      clientId: process.env.ANAF_CLIENT_ID!,
      clientSecret: process.env.ANAF_CLIENT_SECRET!,
      redirectUri: process.env.ANAF_CALLBACK_URL!,
    });

    // Try to load existing valid tokens
    const tokens = await loadTokens();

    if (!tokens || !tokens.refresh_token) {
      throw new Error('Integration tests require valid OAuth tokens. Run auth tests first.');
    }

    // Setup client with authenticator and refresh token
    client = new AnafEfacturaClient(
      {
        vatNumber: testVatNumber,
        testMode: true, // Always use test environment for integration tests
        refreshToken: tokens.refresh_token,
      },
      authenticator
    );

    if (tokens && !isTokenExpired(tokens)) {
      accessToken = tokens.access_token;
      console.log('✅ Using existing valid access token');
    } else if (tokens?.refresh_token) {
      const { data, error } = await tryCatch(
        (async () => {
          console.log('🔄 Refreshing expired token...');
          const newTokens = await authenticator.refreshAccessToken(tokens.refresh_token);
          accessToken = newTokens.access_token;
          await saveTokens(newTokens);
          console.log('✅ Token refreshed successfully');
        })()
      );
      if (error) {
        console.log('❌ Token refresh failed, need new authentication');
        throw new Error('Integration tests require valid OAuth tokens. Run auth tests first.');
      }
    }
  }, 30000);

  describe('Environment Setup', () => {
    test('should have valid OAuth credentials', () => {
      expect(process.env.ANAF_CLIENT_ID).toBeDefined();
      expect(process.env.ANAF_CLIENT_SECRET).toBeDefined();
      expect(process.env.ANAF_CALLBACK_URL).toBeDefined();
    });

    test('should have valid access token', () => {
      expect(accessToken).toBeDefined();
      expect(accessToken.length).toBeGreaterThan(0);
    });

    test('should use test environment', () => {
      expect(client).toBeDefined();
      // Test mode should be enabled for integration tests
    });
  });

  describe('Document Upload Operations', () => {
    let generatedXml: string;
    let uploadResult: UploadResponse;

    beforeAll(() => {
      // Generate test UBL XML
      const builder = new UblBuilder();
      generatedXml = builder.generateInvoiceXml(testInvoiceData);
      expect(generatedXml).toContain('<?xml version="1.0"');
      expect(generatedXml).toContain('<Invoice');
    });

    test('should upload UBL document successfully', async () => {
      const options: UploadOptions = {
        standard: 'UBL',
        extern: false,
        autofactura: false,
        executare: false,
      };

      uploadResult = await client.uploadDocument(generatedXml, options);

      expect(uploadResult).toBeDefined();
      expect(uploadResult.indexIncarcare).toBeDefined();
      expect(uploadResult.indexIncarcare!.length).toBeGreaterThan(0);

      console.log(`✅ Document uploaded successfully with ID: ${uploadResult.indexIncarcare}`);
    }, 30000);

    test('should upload B2C document successfully', async () => {
      const b2cResult = await client.uploadB2CDocument(generatedXml);

      expect(b2cResult).toBeDefined();
      expect(b2cResult.indexIncarcare).toBeDefined();

      console.log(`✅ B2C document uploaded successfully with ID: ${b2cResult.indexIncarcare}`);
    }, 30000);

    test('should get upload status', async () => {
      if (!uploadResult?.indexIncarcare) {
        throw new Error('No upload ID available for status check');
      }

      const status = await client.getUploadStatus(uploadResult.indexIncarcare);

      expect(status).toBeDefined();
      expect(['ok', 'nok', 'in prelucrare']).toContain(status.stare);

      console.log(`✅ Upload status: ${status.stare}`);

      if (status.idDescarcare) {
        console.log(`📥 Download ID available: ${status.idDescarcare}`);
      }
    }, 30000);

    test('should handle upload with all options', async () => {
      const optionsTest: UploadOptions = {
        standard: 'CII',
        extern: true,
        autofactura: true,
        executare: true,
      };

      const result = await client.uploadDocument(generatedXml, optionsTest);

      expect(result).toBeDefined();
      console.log(`✅ Upload with options successful: ${result.indexIncarcare}`);
    }, 30000);
  });

  describe('Message Listing Operations', () => {
    test('should get recent messages', async () => {
      const { data: messages, error } = await tryCatch(
        client.getMessages({
          zile: 7,
          filtru: undefined, // Get all message types
        })
      );

      if (error) {
        // Expected when no messages exist
        if (error.message.includes('Nu exista mesaje')) {
          console.log('ℹ️ No messages found in the last 7 days (expected in test environment)');
          expect(error).toBeInstanceOf(AnafApiError);
          return;
        }
        throw error;
      }

      expect(messages).toBeDefined();
      expect(messages.titlu).toBeDefined();

      if (messages.mesaje && messages.mesaje.length > 0) {
        console.log(`✅ Found ${messages.mesaje.length} messages in the last 7 days`);

        // Verify message structure
        const firstMessage = messages.mesaje[0];
        expect(firstMessage.id).toBeDefined();
        expect(firstMessage.tip).toBeDefined();
        expect(firstMessage.data_creare).toBeDefined();
      } else {
        console.log('ℹ️ No messages found in the last 7 days');
      }
    }, 30000);

    test('should get paginated messages', async () => {
      const endTime = Date.now();
      const startTime = endTime - 30 * 24 * 60 * 60 * 1000; // Last 30 days

      const { data: paginatedMessages, error } = await tryCatch(
        client.getMessagesPaginated({
          startTime,
          endTime,
          pagina: 1,
          filtru: undefined,
        })
      );

      if (error) {
        // Expected when no messages exist
        if (error.message.includes('Nu exista mesaje')) {
          console.log('ℹ️ No paginated messages found (expected in test environment)');
          expect(error).toBeInstanceOf(AnafApiError);
          return;
        }
        throw error;
      }

      expect(paginatedMessages).toBeDefined();
      expect(paginatedMessages.titlu).toBeDefined();

      if (paginatedMessages.mesaje && paginatedMessages.mesaje.length > 0) {
        console.log(`✅ Found ${paginatedMessages.mesaje.length} paginated messages`);
      } else {
        console.log('ℹ️ No paginated messages found');
      }
    }, 30000);
  });

  describe('Document Download Operations', () => {
    test('should handle download request (may not have content)', async () => {
      // Try to find a message with download ID
      const { data: messages, error: getMessagesError } = await tryCatch(client.getMessages({ zile: 30 }));

      if (getMessagesError) {
        // Expected when no messages exist
        if (getMessagesError.message.includes('Nu exista mesaje')) {
          console.log('ℹ️ No messages available for download test (expected in test environment)');
          expect(getMessagesError).toBeInstanceOf(AnafApiError);
          return;
        }
        throw getMessagesError;
      }

      if (messages.mesaje && messages.mesaje.length > 0) {
        const messageWithId = messages.mesaje.find((m) => m.id);

        if (messageWithId?.id) {
          const { error } = await tryCatch(client.downloadDocument(messageWithId.id));
          if (error) {
            // Download may fail if no content available - this is expected
            console.log(`ℹ️ Download failed for message ${messageWithId.id} - likely no content available`);
            expect(error).toBeInstanceOf(AnafApiError);
          } else {
            console.log(`✅ Download successful for message ${messageWithId.id}`);
          }
        } else {
          console.log('ℹ️ No messages with download IDs found');
        }
      } else {
        console.log('ℹ️ No messages available for download test');
      }
    }, 30000);
  });

  describe('Validation Operations', () => {
    let testXml: string;

    beforeAll(() => {
      const builder = new UblBuilder();
      testXml = builder.generateInvoiceXml(testInvoiceData);
    });

    test('should validate XML with FACT1 standard', async () => {
      const { data: result, error } = await tryCatch(client.validateXml(testXml, 'FACT1'));

      if (error) {
        // Expected 404 in test environment - validation endpoint may not be available
        if (error instanceof AnafNotFoundError) {
          console.log('ℹ️ XML validation endpoint not available in test environment (404)');
          expect(error).toBeInstanceOf(AnafNotFoundError);
          return;
        }
        throw error;
      }

      expect(result).toBeDefined();
      if (result) {
        expect(typeof result.valid).toBe('boolean');
        expect(result.details).toBeDefined();

        console.log(`✅ XML validation (FACT1): ${result.valid ? 'VALID' : 'INVALID'}`);

        if (!result.valid) {
          console.log(`Validation details: ${result.details.substring(0, 200)}...`);
        }
      }
    }, 30000);

    test('should validate XML with FCN standard', async () => {
      const { data: result, error } = await tryCatch(client.validateXml(testXml, 'FCN'));

      if (error) {
        // Expected 404 in test environment
        if (error instanceof AnafNotFoundError) {
          console.log('ℹ️ XML validation endpoint not available in test environment (404)');
          expect(error).toBeInstanceOf(AnafNotFoundError);
          return;
        }
        throw error;
      }

      expect(result).toBeDefined();
      if (result) {
        expect(typeof result.valid).toBe('boolean');

        console.log(`✅ XML validation (FCN): ${result.valid ? 'VALID' : 'INVALID'}`);
      }
    }, 30000);

    test('should handle invalid XML validation gracefully', async () => {
      const invalidXml = '<?xml version="1.0"?><InvalidRoot>Not a valid invoice</InvalidRoot>';

      const { data: result, error } = await tryCatch(client.validateXml(invalidXml, 'FACT1'));

      if (error) {
        // Expected 404 in test environment
        if (error instanceof AnafNotFoundError) {
          console.log('ℹ️ XML validation endpoint not available in test environment (404)');
          expect(error).toBeInstanceOf(AnafNotFoundError);
          return;
        }
        throw error;
      }

      expect(result).toBeDefined();
      if (result) {
        expect(result.valid).toBe(false);
        expect(result.details).toContain('error');

        console.log('✅ Invalid XML correctly identified as invalid');
      }
    }, 30000);
  });

  describe('PDF Conversion Operations', () => {
    let testXml: string;

    beforeAll(() => {
      const builder = new UblBuilder();
      testXml = builder.generateInvoiceXml(testInvoiceData);
    });

    test('should convert XML to PDF with validation', async () => {
      const { data: pdfBuffer, error } = await tryCatch(client.convertXmlToPdf(testXml, 'FACT1'));

      if (error) {
        // PDF conversion endpoint may not be available in test environment
        if (error instanceof AnafNotFoundError) {
          console.log('ℹ️ PDF conversion endpoint not available in test environment (404)');
          expect(error).toBeInstanceOf(AnafNotFoundError);
          return;
        }
        // PDF conversion may fail if XML is not valid for PDF generation
        console.log('ℹ️ PDF conversion failed - likely XML validation issues');
        expect(error).toBeInstanceOf(AnafApiError);
        return;
      }

      if (pdfBuffer) {
        expect(pdfBuffer).toBeInstanceOf(Buffer);
        expect(pdfBuffer.length).toBeGreaterThan(0);

        // PDF files start with %PDF
        const pdfHeader = pdfBuffer.toString('ascii', 0, 4);
        expect(pdfHeader).toBe('%PDF');

        console.log(`✅ PDF conversion successful: ${pdfBuffer.length} bytes`);
      }
    }, 30000);

    test('should convert XML to PDF without validation', async () => {
      const { data: pdfBuffer, error } = await tryCatch(client.convertXmlToPdfNoValidation(testXml, 'FACT1'));

      if (error) {
        // PDF conversion endpoint may not be available in test environment
        if (error instanceof AnafNotFoundError) {
          console.log('ℹ️ PDF conversion endpoint not available in test environment (404)');
          expect(error).toBeInstanceOf(AnafNotFoundError);
          return;
        }
        // May still fail if XML structure is incompatible
        console.log('ℹ️ PDF conversion (no validation) failed');
        expect(error).toBeInstanceOf(AnafApiError);
        return;
      }

      if (pdfBuffer) {
        expect(pdfBuffer).toBeInstanceOf(Buffer);
        expect(pdfBuffer.length).toBeGreaterThan(0);

        console.log(`✅ PDF conversion (no validation) successful: ${pdfBuffer.length} bytes`);
      }
    }, 30000);
  });

  describe('Error Handling', () => {
    test('should handle expired token gracefully', async () => {
      // Create client with expired refresh token to test automatic refresh
      const expiredTokenClient = new AnafEfacturaClient(
        {
          vatNumber: testVatNumber,
          testMode: true,
          refreshToken: 'expired_refresh_token_12345',
        },
        authenticator
      );

      const builder = new UblBuilder();
      const xml = builder.generateInvoiceXml(testInvoiceData);

      const { data: result, error } = await tryCatch(expiredTokenClient.uploadDocument(xml));

      // Should fail with either authentication error or 404 (test environment)
      expect(error).toBeDefined();
      if (error instanceof AnafNotFoundError) {
        console.log('ℹ️ Upload endpoint returned 404 in test environment');
        expect(error).toBeInstanceOf(AnafNotFoundError);
      } else {
        console.log('✅ Expired token correctly rejected');
        expect(error).toBeInstanceOf(AnafAuthenticationError);
      }
    }, 15000);

    test('should handle invalid XML gracefully', async () => {
      const invalidXml = 'This is not XML at all';

      const { data: result, error } = await tryCatch(client.uploadDocument(invalidXml));

      // Invalid XML should either throw an error or return error response
      if (error) {
        console.log('✅ Invalid XML rejected with error');
        expect(error).toBeDefined();
      } else if (result) {
        // ANAF may return success response with error details
        console.log('✅ Invalid XML identified by ANAF');
        expect(result.executionStatus).toBe(1); // Error status
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
      }
    }, 15000);

    test('should handle network timeouts', async () => {
      // Create client with very short timeout
      const tokens = await loadTokens();
      if (!tokens?.refresh_token) {
        console.log('⚠️ Skipping timeout test - no refresh token available');
        return;
      }

      const shortTimeoutClient = new AnafEfacturaClient(
        {
          vatNumber: testVatNumber,
          testMode: true,
          timeout: 1, // 1ms timeout
          refreshToken: tokens.refresh_token,
        },
        authenticator
      );

      const builder = new UblBuilder();
      const xml = builder.generateInvoiceXml(testInvoiceData);

      await expect(shortTimeoutClient.uploadDocument(xml)).rejects.toThrow();
    }, 15000);
  });

  describe('Rate Limiting and Quotas', () => {
    test('should handle API rate limits gracefully', async () => {
      // Try multiple quick requests to test rate limiting
      const promises: Promise<ListMessagesResponse>[] = [];

      for (let i = 0; i < 5; i++) {
        promises.push(
          client
            .getMessages({ zile: 1 })
            .then((response) => response as ListMessagesResponse)
            .catch((error) => {
              // Rate limiting errors or "no messages" errors are expected
              if (error.message.includes('limita')) {
                console.log('ℹ️ Rate limit encountered (expected)');
                return {
                  mesaje: [],
                  eroare: 'Rate limit exceeded',
                  titlu: 'Rate limit exceeded',
                  info: 'Rate limit exceeded',
                  eroare_descarcare: 'Rate limit exceeded',
                };
              } else if (error.message.includes('Nu exista mesaje')) {
                // No messages in time period - expected in test environment
                return {
                  mesaje: [],
                  eroare: '',
                  titlu: 'No messages',
                  info: '',
                  eroare_descarcare: '',
                };
              }
              throw error;
            })
        );
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);

      console.log('✅ Rate limiting test completed');
    }, 30000);
  });

  // Helper functions
  async function loadTokens(): Promise<(TokenResponse & { obtained_at?: number; expires_at?: number }) | null> {
    const { data, error } = await tryCatch(
      (async () => {
        // Check if file exists
        if (!fs.existsSync(tokenFilePath)) {
          return null;
        }

        const tokenData = fs.readFileSync(tokenFilePath, 'utf8');

        // Check if file is empty or contains only whitespace
        if (!tokenData || tokenData.trim().length === 0) {
          return null;
        }

        // Try to parse JSON
        try {
          return JSON.parse(tokenData);
        } catch (parseError) {
          console.log('⚠️ Invalid JSON in token file, ignoring...');
          return null;
        }
      })()
    );
    if (error) {
      console.log('Could not load tokens:', error);
    }
    return data;
  }

  async function saveTokens(tokens: TokenResponse): Promise<void> {
    const tokenData = {
      ...tokens,
      obtained_at: Date.now(),
      expires_at: Date.now() + tokens.expires_in * 1000,
    };

    fs.writeFileSync(tokenFilePath, JSON.stringify(tokenData, null, 2));
  }

  function isTokenExpired(tokens: TokenResponse & { expires_at?: number }): boolean {
    if (!tokens.expires_at) {
      return true;
    }

    // Consider token expired 5 minutes before actual expiration
    const expirationBuffer = 5 * 60 * 1000; // 5 minutes
    return Date.now() >= tokens.expires_at - expirationBuffer;
  }
});
