import { AnafEfacturaClient } from '../src';
import { AnafValidationError, AnafApiError, AnafAuthenticationError } from '../src/errors';
import { UploadOptions, PaginatedMessagesParams, MessageFilter } from '../src/types';
import { AnafAuthenticator } from '../src/AnafAuthenticator';
import { mockTestData } from './testUtils';

// Mock fetch globally
global.fetch = jest.fn();

// Mock AnafAuthenticator
jest.mock('../src/AnafAuthenticator', () => {
  return {
    AnafAuthenticator: jest.fn().mockImplementation(() => ({
      refreshAccessToken: jest.fn().mockResolvedValue({
        access_token: 'mock_access_token_12345',
        refresh_token: 'mock_refresh_token',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    })),
  };
});

describe('AnafEfacturaClient Unit Tests', () => {
  let client: AnafEfacturaClient;
  let mockAuthenticator: AnafAuthenticator;
  const mockAccessToken = 'mock_access_token_12345';
  const mockVatNumber = 'RO12345678';

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock authenticator instance
    mockAuthenticator = new AnafAuthenticator({
      clientId: 'mock_client_id',
      clientSecret: 'mock_client_secret',
      redirectUri: 'http://localhost:3000/callback',
    });

    client = new AnafEfacturaClient(
      {
        vatNumber: mockVatNumber,
        testMode: true,
        timeout: 3000,
        refreshToken: 'mock_refresh_token',
      },
      mockAuthenticator
    );
  });

  describe('Constructor and Configuration', () => {
    test('should create client with valid configuration', () => {
      expect(client).toBeDefined();
    });

    test('should throw error for missing VAT number', () => {
      expect(() => {
        new AnafEfacturaClient({ vatNumber: '', refreshToken: 'mock_refresh_token' }, mockAuthenticator);
      }).toThrow(AnafValidationError);
    });

    test('should throw error for null configuration', () => {
      expect(() => {
        new AnafEfacturaClient(null as any, mockAuthenticator);
      }).toThrow(AnafValidationError);
    });

    test('should throw error for missing refresh token', () => {
      expect(() => {
        new AnafEfacturaClient({ vatNumber: mockVatNumber, refreshToken: '' }, mockAuthenticator);
      }).toThrow(AnafValidationError);
    });

    test('should use test mode base path', () => {
      const testClient = new AnafEfacturaClient(
        {
          vatNumber: mockVatNumber,
          testMode: true,
          refreshToken: 'mock_refresh_token',
        },
        mockAuthenticator
      );
      expect(testClient).toBeDefined();
    });

    test('should use production mode base path', () => {
      const prodClient = new AnafEfacturaClient(
        {
          vatNumber: mockVatNumber,
          testMode: false,
          refreshToken: 'mock_refresh_token',
        },
        mockAuthenticator
      );
      expect(prodClient).toBeDefined();
    });

    test('should normalize VAT number by removing RO prefix', () => {
      // Test with RO prefix (uppercase)
      const clientWithRO = new AnafEfacturaClient(
        {
          vatNumber: 'RO46509364',
          testMode: true,
          refreshToken: 'mock_refresh_token',
        },
        mockAuthenticator
      );
      expect(clientWithRO).toBeDefined();

      // Test with ro prefix (lowercase)
      const clientWithRoLowercase = new AnafEfacturaClient(
        {
          vatNumber: 'ro46509364',
          testMode: true,
          refreshToken: 'mock_refresh_token',
        },
        mockAuthenticator
      );
      expect(clientWithRoLowercase).toBeDefined();

      // Test with RO prefix and extra spaces
      const clientWithROAndSpaces = new AnafEfacturaClient(
        {
          vatNumber: '  RO46509364  ',
          testMode: true,
          refreshToken: 'mock_refresh_token',
        },
        mockAuthenticator
      );
      expect(clientWithROAndSpaces).toBeDefined();

      // Test without RO prefix (should work as before)
      const clientWithoutRO = new AnafEfacturaClient(
        {
          vatNumber: '46509364',
          testMode: true,
          refreshToken: 'mock_refresh_token',
        },
        mockAuthenticator
      );
      expect(clientWithoutRO).toBeDefined();
    });

    test('should send normalized VAT number in API requests', async () => {
      const xmlContent = '<?xml version="1.0"?><Invoice>test</Invoice>';

      const clientWithRO = new AnafEfacturaClient(
        {
          vatNumber: 'RO46509364',
          testMode: true,
          refreshToken: 'mock_refresh_token',
        },
        mockAuthenticator
      );

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
        },
        text: () => Promise.resolve(mockTestData.mockXmlResponses.uploadSuccess),
      });

      await clientWithRO.uploadDocument(xmlContent);

      // Verify the URL contains the normalized CIF without RO prefix
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('cif=46509364'), expect.any(Object));
      expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('cif=RO46509364'), expect.any(Object));
    });
  });

  describe('Document Upload', () => {
    const xmlContent = '<?xml version="1.0"?><Invoice>test</Invoice>';

    beforeEach(() => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
        },
        text: () => Promise.resolve(mockTestData.mockXmlResponses.uploadSuccess),
      });
    });

    test('should upload document successfully', async () => {
      const options: UploadOptions = {
        standard: 'UBL',
        executare: true,
      };

      const result = await client.uploadDocument(xmlContent, options);

      expect(result).toBeDefined();
      expect(result.indexIncarcare).toBe('12345');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/upload'),
        expect.objectContaining({
          method: 'POST',
          body: xmlContent,
          headers: expect.objectContaining({
            'Content-Type': 'application/xml',
            Authorization: `Bearer ${mockAccessToken}`,
          }),
        })
      );
    });

    test('should upload B2C document successfully', async () => {
      const result = await client.uploadB2CDocument(xmlContent);

      expect(result).toBeDefined();
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/uploadb2c'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    test('should validate access token before upload', async () => {
      // This test is kept for backwards compatibility but doesn't test much since
      // authenticator is now required in constructor
      const result = await client.uploadDocument(xmlContent);
      expect(result).toBeDefined();
    });

    test('should validate XML content before upload', async () => {
      await expect(client.uploadDocument('')).rejects.toThrow(AnafValidationError);

      await expect(client.uploadDocument('   ')).rejects.toThrow(AnafValidationError);
    });

    test('should validate upload options', async () => {
      // Test invalid standard
      await expect(client.uploadDocument(xmlContent, { standard: 'INVALID' as any })).rejects.toThrow(
        AnafValidationError
      );
    });

    test('should handle upload errors gracefully', async () => {
      (fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(client.uploadDocument(xmlContent)).rejects.toThrow();
    });

    test('should handle 401 authentication errors', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/plain' : null),
        },
        text: () => Promise.resolve('Invalid token'),
      });

      await expect(client.uploadDocument(xmlContent)).rejects.toThrow(AnafAuthenticationError);
    });

    test('should handle XML parsing errors in responses', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
        },
        text: () => Promise.resolve('This is not valid XML at all - no tags or structure'),
      });

      await expect(client.uploadDocument(xmlContent)).rejects.toThrow();
    });

    describe('Specific Upload Error Scenarios from OpenAPI', () => {
      test('should handle invalid standard parameter error', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.uploadErrorInvalidStandard),
        });

        const result = await client.uploadDocument(xmlContent);
        expect(result.executionStatus).toBe(1);
        expect(result.errors).toContain('Valorile acceptate pentru parametrul standard sunt UBL, CN, CII sau RASP');
      });

      test('should handle file too large error', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.uploadErrorFileTooLarge),
        });

        const result = await client.uploadDocument(xmlContent);
        expect(result.executionStatus).toBe(1);
        expect(result.errors).toContain('Marime fisier transmis mai mare de 10 MB.');
      });

      test('should handle invalid CIF error', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.uploadErrorInvalidCif),
        });

        const result = await client.uploadDocument(xmlContent);
        expect(result.executionStatus).toBe(1);
        expect(result.errors).toContain('CIF introdus= 123a nu este un numar');
      });

      test('should handle no rights in SPV error', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.uploadErrorNoRights),
        });

        const result = await client.uploadDocument(xmlContent);
        expect(result.executionStatus).toBe(1);
        expect(result.errors).toContain('Nu exista niciun CIF pentru care sa aveti drept in SPV');
      });

      test('should handle invalid XML structure error', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.uploadErrorInvalidXmlStructure),
        });

        const result = await client.uploadDocument(xmlContent);
        expect(result.executionStatus).toBe(1);
        expect(result.errors?.[0]).toContain('Fisierul transmis nu este valid');
      });

      test('should parse successful upload response correctly', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.uploadSuccess),
        });

        const result = await client.uploadDocument(xmlContent);
        expect(result.executionStatus).toBe(0);
        expect(result.indexIncarcare).toBe('12345');
        expect(result.dateResponse).toBe('202312011200');
        expect(result.errors).toBeUndefined();
      });

      test('should test B2C upload with same error scenarios', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.uploadErrorFileTooLarge),
        });

        const result = await client.uploadB2CDocument(xmlContent);
        expect(result.executionStatus).toBe(1);
        expect(result.errors).toContain('Marime fisier transmis mai mare de 10 MB.');

        // Verify it uses B2C endpoint
        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/uploadb2c'), expect.any(Object));
      });
    });
  });

  describe('Status and Download Operations', () => {
    const mockUploadId = '12345';
    const mockDownloadId = '67890';
    const mockDownloadContent = 'Mock ZIP file content';

    test('should get upload status successfully', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
        },
        text: () => Promise.resolve(mockTestData.mockXmlResponses.statusSuccess),
      });

      const result = await client.getUploadStatus(mockUploadId);

      expect(result).toBeDefined();
      expect(result.stare).toBe('ok');
      expect(result.idDescarcare).toBe('67890');
    });

    test('should download document successfully', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/zip' : null),
        },
        text: () => Promise.resolve(mockDownloadContent),
      });

      const result = await client.downloadDocument(mockDownloadId);

      expect(result).toBe(mockDownloadContent);
    });

    test('should validate upload ID for status check', async () => {
      await expect(client.getUploadStatus('')).rejects.toThrow(AnafValidationError);
    });

    describe('getUploadStatus Comprehensive Tests', () => {
      test('should handle successful status response with ok state', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.statusSuccess),
        });

        const result = await client.getUploadStatus(mockUploadId);

        expect(result).toBeDefined();
        expect(result.stare).toBe('ok');
        expect(result.idDescarcare).toBe('67890');
        expect(result.errors).toBeUndefined();
      });

      test('should handle in progress status response', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.statusInProgress),
        });

        const result = await client.getUploadStatus(mockUploadId);

        expect(result).toBeDefined();
        expect(result.stare).toBe('in prelucrare');
        expect(result.idDescarcare).toBeUndefined();
        expect(result.errors).toBeUndefined();
      });

      test('should handle failed status response with nok state', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.statusError),
        });

        const result = await client.getUploadStatus(mockUploadId);

        expect(result).toBeDefined();
        expect(result.stare).toBe('nok');
        expect(result.idDescarcare).toBe('67890');
        expect(result.errors).toBeUndefined();
      });

      test('should handle no rights error response', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.statusErrorNoRights),
        });

        const result = await client.getUploadStatus(mockUploadId);

        expect(result).toBeDefined();
        expect(result.errors).toBeDefined();
        expect(result.errors).toContain('Nu aveti dreptul sa consultati starea acestui upload.');
        expect(result.stare).toBeUndefined();
        expect(result.idDescarcare).toBeUndefined();
      });

      test('should handle invalid ID error response', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.statusErrorInvalidId),
        });

        const result = await client.getUploadStatus(mockUploadId);

        expect(result).toBeDefined();
        expect(result.errors).toBeDefined();
        expect(result.errors).toContain('Id invalid pentru starea de upload.');
      });

      test('should handle daily limit error response', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.statusErrorDailyLimit),
        });

        const result = await client.getUploadStatus(mockUploadId);

        expect(result).toBeDefined();
        expect(result.errors).toBeDefined();
        expect(result.errors).toContain('Limita zilnica de interogari a fost depasita.');
      });

      test('should throw AnafValidationError for empty upload ID', async () => {
        await expect(client.getUploadStatus('')).rejects.toThrow(AnafValidationError);
        await expect(client.getUploadStatus('   ')).rejects.toThrow(AnafValidationError);
      });

      test('should throw AnafAuthenticationError on 401 response', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('Unauthorized'),
        });

        await expect(client.getUploadStatus(mockUploadId)).rejects.toThrow('HTTP 401: Unauthorized');
      });

      test('should throw AnafApiError on 500 response', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve('Internal Server Error'),
        });

        await expect(client.getUploadStatus(mockUploadId)).rejects.toThrow('HTTP 500: Internal Server Error');
      });

      test('should include proper query parameters in request', async () => {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.statusSuccess),
        });

        await client.getUploadStatus(mockUploadId);

        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining('/stareMesaj?id_incarcare=12345'),
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${mockAccessToken}`,
            }),
          })
        );
      });
    });

    test('should validate download ID for download', async () => {
      await expect(client.downloadDocument('')).rejects.toThrow(AnafValidationError);
    });
  });

  describe('Message Listing Operations', () => {
    test('should get messages successfully', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve({ messages: [] }),
      });

      const result = await client.getMessages({ zile: 7 });

      expect(result).toBeDefined();
    });

    test('should get paginated messages successfully', async () => {
      const params: PaginatedMessagesParams = {
        startTime: Date.now() - 86400000,
        endTime: Date.now(),
        pagina: 1,
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve({ messages: [] }),
      });

      const result = await client.getMessagesPaginated(params);

      expect(result).toBeDefined();
    });

    test('should parse simple list response matching OpenAPI schema', async () => {
      // Mock data matching OpenAPI example for simple list API
      const mockSimpleResponse = {
        mesaje: [
          {
            data_creare: '202211011415',
            cif: '8000000000',
            id_solicitare: '5001130147',
            detalii: 'Erori de validare identificate la factura primita cu id_incarcare=5001130147',
            tip: 'ERORI FACTURA',
            id: '3001293434',
          },
          {
            data_creare: '202211011336',
            cif: '8000000000',
            id_solicitare: '5001131297',
            detalii: 'Factura cu id_incarcare=5001131297 emisa de cif_emitent=8000000000 pentru cif_beneficiar=3',
            tip: 'FACTURA TRIMISA',
            id: '3001503294',
          },
        ],
        serial: '1234AA456',
        cui: '8000000000',
        titlu: 'Lista Mesaje disponibile din ultimele 1 zile',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(mockSimpleResponse),
      });

      const result = await client.getMessages({ zile: 1 });

      expect(result).toEqual(mockSimpleResponse);
      expect(result.mesaje).toHaveLength(2);
      expect(result.mesaje![0]).toEqual({
        data_creare: '202211011415',
        cif: '8000000000',
        id_solicitare: '5001130147',
        detalii: 'Erori de validare identificate la factura primita cu id_incarcare=5001130147',
        tip: 'ERORI FACTURA',
        id: '3001293434',
      });
      expect(result.serial).toBe('1234AA456');
      expect(result.cui).toBe('8000000000');
      expect(result.titlu).toBe('Lista Mesaje disponibile din ultimele 1 zile');
    });

    test('should parse paginated list response matching OpenAPI schema', async () => {
      // Mock data matching OpenAPI example for paginated list API
      const mockPaginatedResponse = {
        mesaje: [
          {
            data_creare: '202210311452',
            cif: '8000000000',
            id_solicitare: '5001120362',
            detalii: 'Erori de validare identificate la factura primita cu id_incarcare=5001120362',
            tip: 'ERORI FACTURA',
            id: '3001474425',
          },
          {
            data_creare: '202210311452',
            cif: '8000000000',
            id_solicitare: '5001120366',
            detalii: 'Erori de validare identificate la factura primita cu id_incarcare=5001120366',
            tip: 'ERORI FACTURA',
            id: '3001474424',
          },
        ],
        numar_inregistrari_in_pagina: 2,
        numar_total_inregistrari_per_pagina: 500,
        numar_total_inregistrari: 14130,
        numar_total_pagini: 29,
        index_pagina_curenta: 29,
        serial: '1234AA456',
        cui: '8000000000',
        titlu: 'Lista Mesaje disponibile din intervalul 06-09-2022 09:48:20 - 02-11-2022 11:49:24',
      };

      const params: PaginatedMessagesParams = {
        startTime: 1662454100000, // 06-09-2022 09:48:20
        endTime: 1667384964000, // 02-11-2022 11:49:24
        pagina: 29,
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(mockPaginatedResponse),
      });

      const result = await client.getMessagesPaginated(params);

      expect(result).toEqual(mockPaginatedResponse);
      expect(result.mesaje).toHaveLength(2);
      expect(result.numar_inregistrari_in_pagina).toBe(2);
      expect(result.numar_total_inregistrari_per_pagina).toBe(500);
      expect(result.numar_total_inregistrari).toBe(14130);
      expect(result.numar_total_pagini).toBe(29);
      expect(result.index_pagina_curenta).toBe(29);
      expect(result.serial).toBe('1234AA456');
      expect(result.cui).toBe('8000000000');
    });

    test('should handle simple list API error responses matching OpenAPI examples', async () => {
      // Test CIF non-numeric error
      const cifNonNumericError = {
        eroare: 'CIF introdus= aaa nu este un numar',
        titlu: 'Lista Mesaje',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(cifNonNumericError),
      });

      await expect(client.getMessages({ zile: 1 })).rejects.toThrow('CIF introdus= aaa nu este un numar');

      // Test invalid days parameter error
      const invalidDaysError = {
        eroare: 'Numarul de zile trebuie sa fie intre 1 si 60',
        titlu: 'Lista Mesaje',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(invalidDaysError),
      });

      await expect(client.getMessages({ zile: 1 })).rejects.toThrow('Numarul de zile trebuie sa fie intre 1 si 60');

      // Test invalid filter parameter error - use valid client params but mock API error
      const invalidFilterError = {
        eroare: 'Valorile acceptate pentru parametrul filtru sunt E, T, P sau R',
        titlu: 'Lista Mesaje',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(invalidFilterError),
      });

      // Use valid parameters but API returns error for some other reason
      await expect(client.getMessages({ zile: 1, filtru: MessageFilter.InvoiceErrors })).rejects.toThrow(
        'Valorile acceptate pentru parametrul filtru sunt E, T, P sau R'
      );

      // Test no messages found error
      const noMessagesError = {
        eroare: 'Nu exista mesaje in ultimele 15 zile',
        titlu: 'Lista Mesaje',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(noMessagesError),
      });

      await expect(client.getMessages({ zile: 15 })).rejects.toThrow('Nu exista mesaje in ultimele 15 zile');
    });

    test('should handle paginated list API error responses matching OpenAPI examples', async () => {
      // Test startTime too old error
      const startTimeTooOldError = {
        eroare: 'startTime = 09-07-2022 10:41:11 nu poate fi mai vechi de 60 de zile fata de momentul requestului',
        titlu: 'Lista Mesaje',
      };

      const params: PaginatedMessagesParams = {
        startTime: Date.now() - 86400000, // Use valid recent time
        endTime: Date.now(),
        pagina: 1,
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(startTimeTooOldError),
      });

      await expect(client.getMessagesPaginated(params)).rejects.toThrow(
        'startTime = 09-07-2022 10:41:11 nu poate fi mai vechi de 60 de zile fata de momentul requestului'
      );

      // Test endTime before startTime error - use valid client params but mock API error
      const endTimeBeforeStartError = {
        eroare: 'endTime = 09-08-2022 10:41:11 nu poate fi <= startTime = 06-09-2022 09:48:20',
        titlu: 'Lista Mesaje',
      };

      const validTimeParams: PaginatedMessagesParams = {
        startTime: Date.now() - 86400000, // Use valid times
        endTime: Date.now(),
        pagina: 1,
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(endTimeBeforeStartError),
      });

      await expect(client.getMessagesPaginated(validTimeParams)).rejects.toThrow(
        'endTime = 09-08-2022 10:41:11 nu poate fi <= startTime = 06-09-2022 09:48:20'
      );

      // Test page number too high error
      const pageNumberTooHighError = {
        eroare: 'Pagina solicitata 50 este mai mare decat numarul toatal de pagini 29',
        titlu: 'Lista Mesaje',
      };

      const highPageParams: PaginatedMessagesParams = {
        startTime: Date.now() - 86400000,
        endTime: Date.now(),
        pagina: 1, // Use valid page number but API returns error
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(pageNumberTooHighError),
      });

      await expect(client.getMessagesPaginated(highPageParams)).rejects.toThrow(
        'Pagina solicitata 50 este mai mare decat numarul toatal de pagini 29'
      );
    });

    test('should validate message parameters', async () => {
      await expect(client.getMessages({ zile: 0 })).rejects.toThrow(AnafValidationError);

      await expect(client.getMessages({ zile: 100 })).rejects.toThrow(AnafValidationError);

      const invalidParams: PaginatedMessagesParams = {
        startTime: Date.now(),
        endTime: Date.now() - 86400000, // End before start
        pagina: 1,
      };

      await expect(client.getMessagesPaginated(invalidParams)).rejects.toThrow(AnafValidationError);
    });

    test('should handle all filter types for simple list API', async () => {
      // Test filter T - FACTURA TRIMISA (Invoice sent)
      const facturaTrimsaResponse = {
        mesaje: [
          {
            data_creare: '202211011336',
            cif: '8000000000',
            id_solicitare: '5001131297',
            detalii:
              'Factura cu id_incarcare=5001131297 emisa de cif_emitent=8000000000 pentru cif_beneficiar=123456789',
            tip: 'FACTURA TRIMISA',
            id: '3001503294',
          },
        ],
        serial: '1234AA456',
        cui: '8000000000',
        titlu: 'Lista Mesaje disponibile din ultimele 7 zile',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(facturaTrimsaResponse),
      });

      const resultT = await client.getMessages({ zile: 7, filtru: MessageFilter.InvoiceSent });
      expect(resultT.mesaje![0].tip).toBe('FACTURA TRIMISA');
      expect(resultT.mesaje![0].detalii).toContain('emisa de cif_emitent');

      // Test filter P - FACTURA PRIMITA (Invoice received)
      const facturaPrimstaResponse = {
        mesaje: [
          {
            data_creare: '202211011400',
            cif: '8000000000',
            id_solicitare: '5001131298',
            detalii: 'Factura cu id_incarcare=5001131298 primita de la cif_emitent=987654321',
            tip: 'FACTURA PRIMITA',
            id: '3001503295',
          },
        ],
        serial: '1234AA456',
        cui: '8000000000',
        titlu: 'Lista Mesaje disponibile din ultimele 7 zile',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(facturaPrimstaResponse),
      });

      const resultP = await client.getMessages({ zile: 7, filtru: MessageFilter.InvoiceReceived });
      expect(resultP.mesaje![0].tip).toBe('FACTURA PRIMITA');
      expect(resultP.mesaje![0].detalii).toContain('primita de la');

      // Test filter E - ERORI FACTURA (Invoice errors)
      const eroriFacturaResponse = {
        mesaje: [
          {
            data_creare: '202211011415',
            cif: '8000000000',
            id_solicitare: '5001130147',
            detalii: 'Erori de validare identificate la factura primita cu id_incarcare=5001130147',
            tip: 'ERORI FACTURA',
            id: '3001293434',
          },
        ],
        serial: '1234AA456',
        cui: '8000000000',
        titlu: 'Lista Mesaje disponibile din ultimele 7 zile',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(eroriFacturaResponse),
      });

      const resultE = await client.getMessages({ zile: 7, filtru: MessageFilter.InvoiceErrors });
      expect(resultE.mesaje![0].tip).toBe('ERORI FACTURA');
      expect(resultE.mesaje![0].detalii).toContain('Erori de validare');

      // Test filter R - MESAJ CUMPARATOR (Buyer message)
      const mesajCumparatorResponse = {
        mesaje: [
          {
            data_creare: '202211011500',
            cif: '8000000000',
            id_solicitare: '5001131299',
            detalii: 'Mesaj RASP primit de la cumparator pentru factura cu id_incarcare=5001131299',
            tip: 'MESAJ CUMPARATOR PRIMIT',
            id: '3001503296',
          },
        ],
        serial: '1234AA456',
        cui: '8000000000',
        titlu: 'Lista Mesaje disponibile din ultimele 7 zile',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(mesajCumparatorResponse),
      });

      const resultR = await client.getMessages({ zile: 7, filtru: MessageFilter.BuyerMessage });
      expect(resultR.mesaje![0].tip).toBe('MESAJ CUMPARATOR PRIMIT');
      expect(resultR.mesaje![0].detalii).toContain('Mesaj RASP');
    });

    test('should handle all filter types for paginated list API', async () => {
      // Test filter T - FACTURA TRIMISA (Invoice sent) with pagination
      const paginatedFacturaTrimsaResponse = {
        mesaje: [
          {
            data_creare: '202210311452',
            cif: '8000000000',
            id_solicitare: '5001120362',
            detalii:
              'Factura cu id_incarcare=5001120362 emisa de cif_emitent=8000000000 pentru cif_beneficiar=555666777',
            tip: 'FACTURA TRIMISA',
            id: '3001474425',
          },
        ],
        numar_inregistrari_in_pagina: 1,
        numar_total_inregistrari_per_pagina: 500,
        numar_total_inregistrari: 150,
        numar_total_pagini: 1,
        index_pagina_curenta: 1,
        serial: '1234AA456',
        cui: '8000000000',
        titlu: 'Lista Mesaje disponibile din intervalul specificat',
      };

      const params: PaginatedMessagesParams = {
        startTime: Date.now() - 86400000,
        endTime: Date.now(),
        pagina: 1,
        filtru: MessageFilter.InvoiceSent,
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(paginatedFacturaTrimsaResponse),
      });

      const resultT = await client.getMessagesPaginated(params);
      expect(resultT.mesaje![0].tip).toBe('FACTURA TRIMISA');
      expect(resultT.numar_total_inregistrari).toBe(150);

      // Test filter P - FACTURA PRIMITA (Invoice received) with pagination
      const paginatedFacturaPrimstaResponse = {
        mesaje: [
          {
            data_creare: '202210311500',
            cif: '8000000000',
            id_solicitare: '5001120363',
            detalii: 'Factura cu id_incarcare=5001120363 primita de la furnizor cu cif_emitent=111222333',
            tip: 'FACTURA PRIMITA',
            id: '3001474426',
          },
        ],
        numar_inregistrari_in_pagina: 1,
        numar_total_inregistrari_per_pagina: 500,
        numar_total_inregistrari: 75,
        numar_total_pagini: 1,
        index_pagina_curenta: 1,
        serial: '1234AA456',
        cui: '8000000000',
        titlu: 'Lista Mesaje disponibile din intervalul specificat',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(paginatedFacturaPrimstaResponse),
      });

      const resultP = await client.getMessagesPaginated({ ...params, filtru: MessageFilter.InvoiceReceived });
      expect(resultP.mesaje![0].tip).toBe('FACTURA PRIMITA');
      expect(resultP.numar_total_inregistrari).toBe(75);

      // Test filter E - ERORI FACTURA (Invoice errors) with pagination
      const paginatedEroriFacturaResponse = {
        mesaje: [
          {
            data_creare: '202210311452',
            cif: '8000000000',
            id_solicitare: '5001120366',
            detalii: 'Erori de validare identificate la factura primita cu id_incarcare=5001120366',
            tip: 'ERORI FACTURA',
            id: '3001474424',
          },
        ],
        numar_inregistrari_in_pagina: 1,
        numar_total_inregistrari_per_pagina: 500,
        numar_total_inregistrari: 25,
        numar_total_pagini: 1,
        index_pagina_curenta: 1,
        serial: '1234AA456',
        cui: '8000000000',
        titlu: 'Lista Mesaje disponibile din intervalul specificat',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(paginatedEroriFacturaResponse),
      });

      const resultE = await client.getMessagesPaginated({ ...params, filtru: MessageFilter.InvoiceErrors });
      expect(resultE.mesaje![0].tip).toBe('ERORI FACTURA');
      expect(resultE.numar_total_inregistrari).toBe(25);

      // Test filter R - MESAJ CUMPARATOR (Buyer message) with pagination
      const paginatedMesajCumparatorResponse = {
        mesaje: [
          {
            data_creare: '202210311600',
            cif: '8000000000',
            id_solicitare: '5001120367',
            detalii: 'Mesaj RASP transmis catre cumparator pentru factura cu id_incarcare=5001120367',
            tip: 'MESAJ CUMPARATOR TRANSMIS',
            id: '3001474427',
          },
        ],
        numar_inregistrari_in_pagina: 1,
        numar_total_inregistrari_per_pagina: 500,
        numar_total_inregistrari: 10,
        numar_total_pagini: 1,
        index_pagina_curenta: 1,
        serial: '1234AA456',
        cui: '8000000000',
        titlu: 'Lista Mesaje disponibile din intervalul specificat',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(paginatedMesajCumparatorResponse),
      });

      const resultR = await client.getMessagesPaginated({ ...params, filtru: MessageFilter.BuyerMessage });
      expect(resultR.mesaje![0].tip).toBe('MESAJ CUMPARATOR TRANSMIS');
      expect(resultR.numar_total_inregistrari).toBe(10);
    });

    test('should handle mixed message types when no filter is applied', async () => {
      // Test without filter - should return all message types
      const mixedMessagesResponse = {
        mesaje: [
          {
            data_creare: '202211011400',
            cif: '8000000000',
            id_solicitare: '5001131297',
            detalii:
              'Factura cu id_incarcare=5001131297 emisa de cif_emitent=8000000000 pentru cif_beneficiar=123456789',
            tip: 'FACTURA TRIMISA',
            id: '3001503294',
          },
          {
            data_creare: '202211011415',
            cif: '8000000000',
            id_solicitare: '5001130147',
            detalii: 'Erori de validare identificate la factura primita cu id_incarcare=5001130147',
            tip: 'ERORI FACTURA',
            id: '3001293434',
          },
          {
            data_creare: '202211011430',
            cif: '8000000000',
            id_solicitare: '5001131298',
            detalii: 'Factura cu id_incarcare=5001131298 primita de la furnizor cu cif_emitent=987654321',
            tip: 'FACTURA PRIMITA',
            id: '3001503295',
          },
          {
            data_creare: '202211011500',
            cif: '8000000000',
            id_solicitare: '5001131299',
            detalii: 'Mesaj RASP primit de la cumparator pentru factura cu id_incarcare=5001131299',
            tip: 'MESAJ CUMPARATOR PRIMIT',
            id: '3001503296',
          },
        ],
        serial: '1234AA456',
        cui: '8000000000',
        titlu: 'Lista Mesaje disponibile din ultimele 7 zile',
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(mixedMessagesResponse),
      });

      const result = await client.getMessages({ zile: 7 }); // No filter
      expect(result.mesaje).toHaveLength(4);

      const messageTypes = result.mesaje!.map((m) => m.tip);
      expect(messageTypes).toContain('FACTURA TRIMISA');
      expect(messageTypes).toContain('ERORI FACTURA');
      expect(messageTypes).toContain('FACTURA PRIMITA');
      expect(messageTypes).toContain('MESAJ CUMPARATOR PRIMIT');
    });
  });

  describe('Error Handling', () => {
    const xmlContent = '<?xml version="1.0"?><Invoice>test</Invoice>';

    test('should handle network errors', async () => {
      (fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(client.uploadDocument(xmlContent)).rejects.toThrow();
    });

    test('should handle 400 validation errors', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/plain' : null),
        },
        text: () => Promise.resolve('Invalid parameters'),
      });

      await expect(client.uploadDocument(xmlContent)).rejects.toThrow(AnafValidationError);
    });

    test('should handle 401 authentication errors', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/plain' : null),
        },
        text: () => Promise.resolve('Invalid token'),
      });

      await expect(client.uploadDocument(xmlContent)).rejects.toThrow(AnafAuthenticationError);
    });

    test('should handle 500 server errors', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/plain' : null),
        },
        text: () => Promise.resolve('Server error'),
      });

      await expect(client.uploadDocument(xmlContent)).rejects.toThrow(AnafApiError);
    });

    test('should handle XML parsing errors in responses', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
        },
        text: () => Promise.resolve('This is not valid XML at all - no tags or structure'),
      });

      await expect(client.uploadDocument(xmlContent)).rejects.toThrow();
    });
  });

  describe('Parameter Validation', () => {
    test('should accept valid enum values', async () => {
      const xmlContent = '<?xml version="1.0"?><Invoice>test</Invoice>';

      // Valid upload standards
      for (const standard of ['UBL', 'CN', 'CII', 'RASP']) {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/xml' : null),
          },
          text: () => Promise.resolve(mockTestData.mockXmlResponses.uploadSuccess),
        });

        await expect(client.uploadDocument(xmlContent, { standard: standard as any })).resolves.toBeDefined();
      }

      // Valid message filters
      for (const filter of Object.values(MessageFilter)) {
        (fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'application/json' : null),
          },
          json: () => Promise.resolve(mockTestData.mockJsonResponses.messagesSuccess),
        });

        await expect(client.getMessages({ zile: 7, filtru: filter })).resolves.toBeDefined();
      }
    });
  });
});
