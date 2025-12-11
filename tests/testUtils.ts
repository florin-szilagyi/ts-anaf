import fs from 'fs';
import path from 'path';
import { TokenResponse, InvoiceInput } from '../src/types';
import { tryCatch } from '../src/tryCatch';

/**
 * Test utilities for ANAF SDK tests
 */

// Test data
export const mockTestData = {
  vatNumber: 'RO12345678',
  accessToken: 'mock_access_token_12345',

  // Mock invoice data for testing
  invoiceData: {
    invoiceNumber: `TEST-${Date.now()}`,
    issueDate: new Date(),
    supplier: {
      registrationName: 'Test Supplier SRL',
      companyId: 'RO12345678',
      vatNumber: 'RO12345678',
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
  } as InvoiceInput,

  // Mock XML responses
  mockXmlResponses: {
    uploadSuccess: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202312011200" ExecutionStatus="0" index_incarcare="12345"/>`,

    uploadError: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202312011200" ExecutionStatus="1">
    <Errors errorMessage="Invalid XML format"/>
</header>`,

    // Specific upload error examples from OpenAPI spec
    uploadErrorInvalidStandard: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202312011200" ExecutionStatus="1">
    <Errors errorMessage="Valorile acceptate pentru parametrul standard sunt UBL, CN, CII sau RASP"/>
</header>`,

    uploadErrorFileTooLarge: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202312011200" ExecutionStatus="1">
    <Errors errorMessage="Marime fisier transmis mai mare de 10 MB."/>
</header>`,

    uploadErrorInvalidCif: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202312011200" ExecutionStatus="1">
    <Errors errorMessage="CIF introdus= 123a nu este un numar"/>
</header>`,

    uploadErrorNoRights: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202312011200" ExecutionStatus="1">
    <Errors errorMessage="Nu exista niciun CIF pentru care sa aveti drept in SPV"/>
</header>`,

    uploadErrorInvalidXmlStructure: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202312011200" ExecutionStatus="1">
    <Errors errorMessage="Fisierul transmis nu este valid. org.xml.sax.SAXParseException; lineNumber: 15; columnNumber: 155; cvc-elt.1.a: Cannot find the declaration of element 'Invoice1'. "/>
</header>`,

    statusSuccess: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:efactura:stareMesajFactura:v1" stare="ok" id_descarcare="67890"/>`,

    statusInProgress: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:efactura:stareMesajFactura:v1" stare="in prelucrare"/>`,

    statusError: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:efactura:stareMesajFactura:v1" stare="nok" id_descarcare="67890"/>`,

    // Status error responses from OpenAPI examples
    statusErrorNoRights: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:efactura:stareMesajFactura:v1">
  <Errors errorMessage="Nu aveti dreptul sa consultati starea acestui upload."/>
</header>`,

    statusErrorInvalidId: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:efactura:stareMesajFactura:v1">
  <Errors errorMessage="Id invalid pentru starea de upload."/>
</header>`,

    statusErrorDailyLimit: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<header xmlns="mfp:anaf:dgti:efactura:stareMesajFactura:v1">
  <Errors errorMessage="Limita zilnica de interogari a fost depasita."/>
</header>`,
  },

  // Mock JSON responses
  mockJsonResponses: {
    messagesSuccess: {
      mesaje: [
        {
          id: '1',
          tip: 'FACTURA TRIMISA',
          data_creare: '202312010800',
          detalii: 'Test message 1',
          id_solicitare: '123',
          cif: 'RO12345678',
        },
        {
          id: '2',
          tip: 'ERORI FACTURA',
          data_creare: '202312011000',
          detalii: 'Test error message',
          id_solicitare: '124',
          cif: 'RO12345678',
        },
      ],
      serial: 'TEST123',
      titlu: 'Test Messages',
      numar_total_inregistrari: 2,
    },

    messagesEmpty: {
      mesaje: [],
      serial: 'TEST456',
      titlu: 'No Messages',
      eroare: 'Nu exista mesaje in intervalul selectat',
    },

    validationSuccess: {
      stare: 'ok',
      trace_id: 'test-trace-123',
    },

    validationError: {
      stare: 'nok',
      Messages: [
        {
          message: 'E: validari globale SCHEMATRON eroare: [BR-CO-09] Invalid VAT identifier format',
        },
      ],
      trace_id: 'test-trace-456',
    },
  },
};

/**
 * Token management utilities for tests
 */
export class TestTokenManager {
  private static tokenFilePath = path.join(process.cwd(), 'token.secret');

  static async loadTokens(): Promise<(TokenResponse & { obtained_at?: number; expires_at?: number }) | null> {
    try {
      if (!fs.existsSync(this.tokenFilePath)) {
        return null;
      }

      const tokenData = fs.readFileSync(this.tokenFilePath, 'utf8');
      if (!tokenData || tokenData.trim().length === 0) {
        return null;
      }

      try {
        return JSON.parse(tokenData);
      } catch {
        console.log('⚠️ Invalid JSON in token file, ignoring...');
        return null;
      }
    } catch (error) {
      console.log('Could not load tokens:', error);
      return null;
    }
  }

  static async saveTokens(tokens: TokenResponse): Promise<void> {
    const tokenData = {
      ...tokens,
      obtained_at: Date.now(),
      expires_at: Date.now() + tokens.expires_in * 1000,
    };

    fs.writeFileSync(this.tokenFilePath, JSON.stringify(tokenData, null, 2));
  }

  static async deleteTokens(): Promise<void> {
    const { data, error } = await tryCatch(
      (async () => {
        if (fs.existsSync(this.tokenFilePath)) {
          fs.unlinkSync(this.tokenFilePath);
          console.log('🗑️ Tokens deleted');
        }
      })()
    );
    if (error) {
      console.log('Could not delete tokens:', error);
    }
  }

  static isTokenExpired(tokens: TokenResponse & { expires_at?: number }): boolean {
    if (!tokens.expires_at) {
      return true;
    }

    // Consider token expired 5 minutes before actual expiration
    const expirationBuffer = 5 * 60 * 1000; // 5 minutes
    return Date.now() >= tokens.expires_at - expirationBuffer;
  }

  static hasValidTokens(): boolean {
    const { data, error } = tryCatch(() => {
      const tokens = this.loadTokens();
      return tokens !== null && !this.isTokenExpired(tokens as any);
    });
    if (error) {
      return false;
    }

    return data;
  }
}

/**
 * Mock HTTP client for unit tests
 */
export class MockHttpClient {
  public post = jest.fn();
  public get = jest.fn();
  public interceptors = {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  };

  reset() {
    this.post.mockReset();
    this.get.mockReset();
  }

  mockUploadSuccess(uploadId: string = '12345') {
    this.post.mockResolvedValue({
      data: mockTestData.mockXmlResponses.uploadSuccess.replace('12345', uploadId),
    });
  }

  mockUploadError(errorMessage: string = 'Invalid XML format') {
    this.post.mockResolvedValue({
      data: mockTestData.mockXmlResponses.uploadError.replace('Invalid XML format', errorMessage),
    });
  }

  mockStatusSuccess(downloadId: string = '67890') {
    this.get.mockResolvedValue({
      data: mockTestData.mockXmlResponses.statusSuccess.replace('67890', downloadId),
    });
  }

  mockStatusInProgress() {
    this.get.mockResolvedValue({
      data: mockTestData.mockXmlResponses.statusInProgress,
    });
  }

  mockMessagesSuccess(messageCount: number = 2) {
    const response = { ...mockTestData.mockJsonResponses.messagesSuccess };
    response.mesaje = response.mesaje.slice(0, messageCount);
    response.numar_total_inregistrari = messageCount;

    this.get.mockResolvedValue({ data: response });
  }

  mockMessagesEmpty() {
    this.get.mockResolvedValue({
      data: mockTestData.mockJsonResponses.messagesEmpty,
    });
  }

  mockValidationSuccess() {
    this.post.mockResolvedValue({
      data: mockTestData.mockJsonResponses.validationSuccess,
    });
  }

  mockValidationError() {
    this.post.mockResolvedValue({
      data: mockTestData.mockJsonResponses.validationError,
    });
  }

  mockPdfConversion(size: number = 1024) {
    const pdfBuffer = Buffer.alloc(size);
    pdfBuffer.write('%PDF-1.4', 0, 'ascii'); // Valid PDF header

    this.post.mockResolvedValue({
      data: pdfBuffer,
    });
  }

  mockNetworkError(message: string = 'Network error') {
    this.post.mockRejectedValue(new Error(message));
    this.get.mockRejectedValue(new Error(message));
  }

  mockHttpError(status: number, message: string = 'HTTP error') {
    const error = new Error(message);
    (error as any).isAxiosError = true;
    (error as any).response = { status, data: message };

    this.post.mockRejectedValue(error);
    this.get.mockRejectedValue(error);
  }
}

/**
 * Test environment checks
 */
export const testEnvironment = {
  hasOAuthCredentials(): boolean {
    return !!(process.env.ANAF_CLIENT_ID && process.env.ANAF_CLIENT_SECRET && process.env.ANAF_CALLBACK_URL);
  },

  skipIfNoCredentials(message: string = 'OAuth credentials not available') {
    if (!this.hasOAuthCredentials()) {
      console.log(`⚠️ Skipping test: ${message}`);
      return true;
    }
    return false;
  },

  getCredentials() {
    if (!this.hasOAuthCredentials()) {
      throw new Error('OAuth credentials not available for integration tests');
    }

    return {
      clientId: process.env.ANAF_CLIENT_ID!,
      clientSecret: process.env.ANAF_CLIENT_SECRET!,
      redirectUri: process.env.ANAF_CALLBACK_URL!,
    };
  },
};

/**
 * XML and file utilities for tests
 */
export const testFileUtils = {
  generateTestXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ID>TEST-${Date.now()}</cbc:ID>
  <cbc:IssueDate>${new Date().toISOString().split('T')[0]}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Test Supplier SRL</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Test Customer SRL</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
</Invoice>`;
  },

  generateInvalidXml(): string {
    return 'This is not valid XML content';
  },

  createMockFile(content: string, filename: string, mimeType: string = 'text/xml'): File {
    return new File([content], filename, { type: mimeType });
  },

  createMockBuffer(content: string): Buffer {
    return Buffer.from(content, 'utf8');
  },
};

/**
 * Test assertion helpers
 */
export const testAssertions = {
  expectValidUploadResult(result: any) {
    expect(result).toBeDefined();
    expect(result.index_incarcare).toBeDefined();
    expect(typeof result.index_incarcare).toBe('string');
    expect(result.index_incarcare.length).toBeGreaterThan(0);
  },

  expectValidStatusResult(result: any) {
    expect(result).toBeDefined();
    expect(result.stare).toBeDefined();
    expect(['ok', 'nok', 'in prelucrare']).toContain(result.stare);
  },

  expectValidMessagesResult(result: any) {
    expect(result).toBeDefined();
    expect(result.titlu).toBeDefined();

    if (result.mesaje && result.mesaje.length > 0) {
      const message = result.mesaje[0];
      expect(message.id).toBeDefined();
      expect(message.tip).toBeDefined();
      expect(message.data_creare).toBeDefined();
    }
  },

  expectValidValidationResult(result: any) {
    expect(result).toBeDefined();
    expect(typeof result.valid).toBe('boolean');
    expect(result.details).toBeDefined();
  },

  expectValidPdfBuffer(buffer: any) {
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // Check for PDF header if it's a real PDF
    const header = buffer.toString('ascii', 0, 4);
    if (header === '%PDF') {
      expect(header).toBe('%PDF');
    }
  },
};

/**
 * Delay utility for tests
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Random test data generators
 */
export const testDataGenerators = {
  randomVatNumber(): string {
    const randomNum = Math.floor(Math.random() * 100000000);
    return `RO${randomNum.toString().padStart(8, '0')}`;
  },

  randomInvoiceNumber(): string {
    return `TEST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  },

  randomUploadId(): string {
    return Math.floor(Math.random() * 1000000).toString();
  },

  randomDownloadId(): string {
    return Math.floor(Math.random() * 1000000).toString();
  },
};
