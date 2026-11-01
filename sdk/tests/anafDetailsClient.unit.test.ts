import { AnafDetailsClient } from '../src/AnafDetailsClient';
import {
  AnafCompanyResult,
  AnafApiResponse,
  AnafAsyncSubmitResponse,
  AnafAsyncResultResponse,
  AnafCompanyFullDetails,
  EFacturaRegistryResponse,
} from '../src/types';

// Mock fetch globally
global.fetch = jest.fn();

const mockJsonResponse = (data: any) => ({
  ok: true,
  status: 200,
  headers: {
    get: (name: string) => (name === 'content-type' ? 'application/json' : null),
  },
  json: () => Promise.resolve(data),
});

const mockRegistryFound = (cui: number): EFacturaRegistryResponse => ({
  found: [
    {
      cui,
      denumire: 'Test Company SRL',
      adresa: 'Str. Test Nr. 1',
      registru: 'RO e-Factura',
      categorie: 'Mare contribuabil',
      dataInscriere: '2022-01-01',
      dataRenuntare: null,
      dataRadiere: null,
      dataOptiuneB2G: '2022-06-01',
      stare: 'inregistrat',
    },
  ],
  notFound: [],
});

const mockRegistryNotFound = (cui: number): EFacturaRegistryResponse => ({
  found: [],
  notFound: [cui],
});

describe('AnafDetailsClient Unit Tests', () => {
  let client: AnafDetailsClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new AnafDetailsClient();
  });

  describe('Constructor and Configuration', () => {
    test('should create client with default configuration', () => {
      const defaultClient = new AnafDetailsClient();
      expect(defaultClient).toBeInstanceOf(AnafDetailsClient);
    });

    test('should create client with custom configuration', () => {
      const customClient = new AnafDetailsClient({
        timeout: 60000,
      });
      expect(customClient).toBeInstanceOf(AnafDetailsClient);
    });
  });

  describe('VAT Code Validation', () => {
    test('should validate correct VAT codes', async () => {
      expect(await client.isValidVatCode('RO12345678')).toBe(true);
      expect(await client.isValidVatCode('12345678')).toBe(true);
      expect(await client.isValidVatCode('RO123')).toBe(true);
      expect(await client.isValidVatCode('1234567890')).toBe(true);
    });

    test('should reject invalid VAT codes', async () => {
      expect(await client.isValidVatCode('')).toBe(false);
      expect(await client.isValidVatCode('RO')).toBe(false);
      expect(await client.isValidVatCode('ROABC')).toBe(false);
      expect(await client.isValidVatCode('12345678901')).toBe(false); // Too long
      expect(await client.isValidVatCode('0')).toBe(false); // Zero
      expect(await client.isValidVatCode('-123')).toBe(false); // Negative
    });
  });

  describe('Company Data Fetching', () => {
    const mockSuccessResponse: AnafApiResponse = {
      found: [
        {
          date_generale: {
            cui: 12345678,
            denumire: 'Test Company SRL',
            adresa: 'Str. Test Nr. 1, Bucuresti',
            nrRegCom: 'J40/1234/2020',
            telefon: '0212345678',
            codPostal: '010101',
            cod_CAEN: '6201',
          },
          inregistrare_scop_Tva: {
            scpTVA: true,
          },
        },
      ],
    };

    const mockNotFoundResponse: AnafApiResponse = {
      notFound: [99999999],
    };

    test('should fetch company data with e-Factura registry info', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse(mockSuccessResponse))
        .mockResolvedValueOnce(mockJsonResponse(mockRegistryFound(12345678)));

      const result = await client.getCompanyData('RO12345678');

      expect(result.success).toBe(true);
      expect(result.data?.[0]).toEqual({
        vatCode: '12345678',
        name: 'Test Company SRL',
        registrationNumber: 'J40/1234/2020',
        address: 'Str. Test Nr. 1, Bucuresti',
        postalCode: '010101',
        contactPhone: '0212345678',
        scpTva: true,
        caenCode: '6201',
        efacturaRegistry: {
          registered: true,
          registru: 'RO e-Factura',
          categorie: 'Mare contribuabil',
          dataInscriere: '2022-01-01',
          dataRenuntare: null,
          dataRadiere: null,
          dataOptiuneB2G: '2022-06-01',
          stare: 'inregistrat',
        },
      });

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledWith(
        'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('12345678'),
        })
      );
      expect(fetch).toHaveBeenCalledWith(
        'https://webservicesp.anaf.ro/api/registruroefactura/v1/interogare',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('12345678'),
        })
      );
    });

    test('should return the fiscal inactive flag when ANAF sends it', async () => {
      const found = mockSuccessResponse.found![0]!;
      (fetch as jest.Mock).mockResolvedValueOnce(
        mockJsonResponse({ found: [{ ...found, stare_inactiv: { statusInactivi: true } }] })
      );

      const result = await client.batchGetCompanyData(['RO12345678'], { includeEfacturaRegistry: false });

      expect(result.data?.[0]?.inactive).toBe(true);
    });

    test('should leave the fiscal inactive flag out when ANAF does not send it', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse(mockSuccessResponse));

      const result = await client.batchGetCompanyData(['RO12345678'], { includeEfacturaRegistry: false });

      expect(result.data?.[0]).not.toHaveProperty('inactive');
    });

    test('should mark company as not registered when not in e-Factura registry', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse(mockSuccessResponse))
        .mockResolvedValueOnce(mockJsonResponse(mockRegistryNotFound(12345678)));

      const result = await client.getCompanyData('RO12345678');

      expect(result.success).toBe(true);
      expect(result.data?.[0]?.efacturaRegistry).toEqual({ registered: false });
    });

    test('should gracefully degrade when registry call fails', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse(mockSuccessResponse))
        .mockRejectedValueOnce(new Error('Registry service unavailable'));

      const result = await client.getCompanyData('RO12345678');

      expect(result.success).toBe(true);
      expect(result.data?.[0]?.name).toBe('Test Company SRL');
      expect(result.data?.[0]?.efacturaRegistry).toBeUndefined();
      expect(result.efacturaRegistryError?.message).toContain('Registry service unavailable');
    });

    test('should handle company not found', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse(mockNotFoundResponse))
        .mockResolvedValueOnce(mockJsonResponse(mockRegistryNotFound(99999999)));

      const result = await client.getCompanyData('RO99999999');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Company not found for the provided VAT code.');
    });

    test('should handle invalid VAT code format', async () => {
      const result = await client.getCompanyData('invalid');

      expect(result.success).toBe(false);
      expect(result.error).toBe('All 1 provided VAT code(s) are invalid.');
      expect(fetch).not.toHaveBeenCalled();
    });

    test('should handle empty VAT code', async () => {
      const result = await client.getCompanyData('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('All 1 provided VAT code(s) are invalid.');
      expect(fetch).not.toHaveBeenCalled();
    });

    test('should handle network errors', async () => {
      (fetch as jest.Mock).mockRejectedValue(new Error('fetch failed'));

      const result = await client.getCompanyData('RO12345678');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error: Could not connect to ANAF service.');
    });

    test('should handle API errors', async () => {
      (fetch as jest.Mock).mockRejectedValue(new Error('API error'));

      const result = await client.getCompanyData('RO12345678');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error: Could not connect to ANAF service.');
    });

    test('should handle unexpected response structure', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse({}))
        .mockResolvedValueOnce(mockJsonResponse(mockRegistryNotFound(12345678)));

      const result = await client.getCompanyData('RO12345678');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unexpected response structure from ANAF API: {}');
    });
  });

  describe('Batch Operations', () => {
    const mockResponse1: AnafApiResponse = {
      found: [
        {
          date_generale: {
            cui: 11111111,
            denumire: 'Company One SRL',
            adresa: 'Address One',
            nrRegCom: 'J40/1111/2020',
            telefon: '0211111111',
            codPostal: '010101',
            cod_CAEN: '6201',
          },
          inregistrare_scop_Tva: { scpTVA: true },
        },
      ],
    };

    const mockResponse2: AnafApiResponse = {
      found: [
        {
          date_generale: {
            cui: 22222222,
            denumire: 'Company Two SRL',
            adresa: 'Address Two',
            nrRegCom: 'J40/2222/2020',
            telefon: '0212222222',
            codPostal: '020202',
            cod_CAEN: '6201',
          },
          inregistrare_scop_Tva: { scpTVA: false },
        },
      ],
    };

    const mockNotFound: AnafApiResponse = {
      notFound: [99999999],
    };

    test('should batch fetch multiple companies with registry data', async () => {
      const batchCompanyResponse = {
        found: [
          {
            date_generale: {
              cui: 12345678,
              denumire: 'Company One SRL',
              adresa: 'Address One',
              nrRegCom: 'J40/1234/2020',
              telefon: '0211111111',
              codPostal: '010101',
              cod_CAEN: '6201',
            },
            inregistrare_scop_Tva: { scpTVA: true },
          },
          {
            date_generale: {
              cui: 87654321,
              denumire: 'Company Two SRL',
              adresa: 'Address Two',
              nrRegCom: 'J40/5678/2020',
              telefon: '0222222222',
              codPostal: '020202',
              cod_CAEN: '6201',
            },
            inregistrare_scop_Tva: { scpTVA: false },
          },
        ],
      };

      const batchRegistryResponse: EFacturaRegistryResponse = {
        found: [
          {
            cui: 12345678,
            denumire: 'Company One SRL',
            adresa: 'Address One',
            registru: 'RO e-Factura',
            categorie: 'Mare contribuabil',
            dataInscriere: '2022-01-01',
            dataRenuntare: null,
            dataRadiere: null,
            dataOptiuneB2G: null,
            stare: 'inregistrat',
          },
        ],
        notFound: [87654321],
      };

      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse(batchCompanyResponse))
        .mockResolvedValueOnce(mockJsonResponse(batchRegistryResponse));

      const result = await client.batchGetCompanyData(['RO12345678', 'RO87654321']);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0]?.name).toBe('Company One SRL');
      expect(result.data?.[0]?.scpTva).toBe(true);
      expect(result.data?.[0]?.efacturaRegistry?.registered).toBe(true);
      expect(result.data?.[0]?.efacturaRegistry?.stare).toBe('inregistrat');
      expect(result.data?.[1]?.name).toBe('Company Two SRL');
      expect(result.data?.[1]?.scpTva).toBe(false);
      expect(result.data?.[1]?.efacturaRegistry?.registered).toBe(false);

      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases', () => {
    test('should handle VAT codes with different formats', async () => {
      const mockResponse: AnafApiResponse = {
        found: [
          {
            date_generale: {
              cui: 123,
              denumire: 'Short CUI Company',
              adresa: 'Test Address',
              nrRegCom: 'J40/123/2020',
              telefon: '0211234567',
              codPostal: null,
              cod_CAEN: '6201',
            },
            inregistrare_scop_Tva: { scpTVA: false },
          },
        ],
      };

      (fetch as jest.Mock).mockResolvedValue(mockJsonResponse(mockResponse));

      // Test with different VAT code formats
      const result1 = await client.getCompanyData('RO123');
      const result2 = await client.getCompanyData('123');
      const result3 = await client.getCompanyData('  RO123  ');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);

      expect(result1.data?.[0]?.vatCode).toBe('123');
      expect(result1.data?.[0]?.postalCode).toBe(null);
    });

    test('should handle missing optional fields', async () => {
      const mockResponse: AnafApiResponse = {
        found: [
          {
            date_generale: {
              cui: 12345678,
              denumire: 'Minimal Company',
              adresa: 'Minimal Address',
              nrRegCom: '',
              telefon: '',
              codPostal: null,
              cod_CAEN: '6201',
            },
            inregistrare_scop_Tva: { scpTVA: false },
          },
        ],
      };

      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse(mockResponse))
        .mockResolvedValueOnce(mockJsonResponse(mockRegistryNotFound(12345678)));

      const result = await client.getCompanyData('RO12345678');

      expect(result.success).toBe(true);
      expect(result.data?.[0]?.name).toBe('Minimal Company');
      expect(result.data?.[0]?.registrationNumber).toBe('');
      expect(result.data?.[0]?.contactPhone).toBe('');
      expect(result.data?.[0]?.postalCode).toBe(null);
      expect(result.data?.[0]?.scpTva).toBe(false);
      expect(result.data?.[0]?.efacturaRegistry?.registered).toBe(false);
    });
  });

  describe('Bulk lookup (sync v9)', () => {
    const found = (cui: number, codCaen: string): AnafApiResponse['found'] => [
      {
        date_generale: {
          cui,
          denumire: `Company ${cui} SRL`,
          adresa: 'Address',
          nrRegCom: 'J40/1/2020',
          telefon: '',
          codPostal: null,
          cod_CAEN: codCaen,
        },
        inregistrare_scop_Tva: { scpTVA: true },
      },
    ];

    const mockErrorResponse = (status: number, statusText: string, body: string, retryAfter?: string) => ({
      ok: false,
      status,
      statusText,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null),
      },
      text: () => Promise.resolve(body),
    });

    const sentBody = (call = 0) => JSON.parse((fetch as jest.Mock).mock.calls[call][1].body);

    test('returns the main CAEN code', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({ found: found(12345678, '6201'), notFound: [] }));

      const result = await client.batchGetCompanyData(['RO12345678'], { includeEfacturaRegistry: false });

      expect(result.data?.[0]?.caenCode).toBe('6201');
    });

    test('returns found companies and not-found CUIs together', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce(
        mockJsonResponse({ found: found(12345678, '6201'), notFound: [99999999] })
      );

      const result = await client.batchGetCompanyData(['12345678', '99999999'], { includeEfacturaRegistry: false });

      expect(result.success).toBe(true);
      expect(result.data?.map((c) => c.vatCode)).toEqual(['12345678']);
      expect(result.notFound).toEqual([99999999]);
    });

    test('returns the not-found CUIs when ANAF answers 404 because none exist', async () => {
      const body = JSON.stringify({ cod: 404, message: 'NOT_FOUND', found: [], notFound: [1, 2] });
      (fetch as jest.Mock).mockResolvedValueOnce(mockErrorResponse(404, 'Not Found', body));

      const result = await client.batchGetCompanyData(['RO11', 'RO22'], { includeEfacturaRegistry: false });

      expect(result).toMatchObject({ success: false, notFound: [1, 2], statusCode: 404, retryable: false });
    });

    test('marks a company as not registered when the e-Factura registry answers 404 with it in notFound', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse({ found: found(12345678, '6201'), notFound: [] }))
        .mockResolvedValueOnce(
          mockErrorResponse(404, 'Not Found', JSON.stringify({ found: [], notFound: [12345678] }))
        );

      const result = await client.batchGetCompanyData(['RO12345678']);

      expect(result.data?.[0]?.efacturaRegistry).toEqual({ registered: false });
    });

    test('leaves e-Factura out when the registry 404 body is not the ANAF list', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse({ found: found(12345678, '6201'), notFound: [] }))
        .mockResolvedValueOnce(mockErrorResponse(404, 'Not Found', '<html>Not Found</html>'));

      const result = await client.batchGetCompanyData(['RO12345678']);

      expect(result.data?.[0]?.efacturaRegistry).toBeUndefined();
      expect(result.efacturaRegistryError?.statusCode).toBe(404);
    });

    test('reports a registry 503 on the result and still returns the company', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse({ found: found(12345678, '6201'), notFound: [] }))
        .mockResolvedValueOnce(mockErrorResponse(503, 'Service Unavailable', 'down'));

      const result = await client.batchGetCompanyData(['RO12345678']);

      expect(result.success).toBe(true);
      expect(result.data?.[0]?.efacturaRegistry).toBeUndefined();
      expect(result.efacturaRegistryError).toMatchObject({ statusCode: 503 });
    });

    test('reports no registry error when the registry answers 404 with the CUI in notFound', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse({ found: found(12345678, '6201'), notFound: [] }))
        .mockResolvedValueOnce(
          mockErrorResponse(404, 'Not Found', JSON.stringify({ found: [], notFound: [12345678] }))
        );

      const result = await client.batchGetCompanyData(['RO12345678']);

      expect(result).not.toHaveProperty('efacturaRegistryError');
    });

    test('returns the registration date, status and legal-form fields ANAF sends', async () => {
      const [company] = found(12345678, '6201')!;
      Object.assign(company!.date_generale, {
        data_inregistrare: '2020-01-15',
        stare_inregistrare: 'INREGISTRAT din data 15.01.2020',
        forma_juridica: 'PERSOANA JURIDICA',
        forma_organizare: 'SRL',
        forma_de_proprietate: '',
      });
      (fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({ found: [company], notFound: [] }));

      const result = await client.batchGetCompanyData(['RO12345678'], { includeEfacturaRegistry: false });

      expect(result.data?.[0]).toMatchObject({
        registrationDate: '2020-01-15',
        registrationStatus: 'INREGISTRAT din data 15.01.2020',
        legalForm: 'PERSOANA JURIDICA',
        organizationForm: 'SRL',
      });
      expect(result.data?.[0]).not.toHaveProperty('ownershipForm', '');
    });

    test('does not invent not-found CUIs when the 404 body is not the ANAF list', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce(mockErrorResponse(404, 'Not Found', '<html>Not Found</html>'));

      const result = await client.batchGetCompanyData(['RO11'], { includeEfacturaRegistry: false });

      expect(result).toMatchObject({ success: false, statusCode: 404, retryable: false });
      expect(result.notFound).toBeUndefined();
    });

    test('sends exactly one request to v9 when the registry is not wanted', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({ found: found(12345678, '6201'), notFound: [] }));

      const result = await client.batchGetCompanyData(['RO12345678'], { includeEfacturaRegistry: false });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith('https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva', expect.anything());
      expect(result.data?.[0]?.efacturaRegistry).toBeUndefined();
    });

    test('exposes status and Retry-After on 429 and marks it retryable', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce(mockErrorResponse(429, 'Too Many Requests', '', '5'));

      const result = await client.batchGetCompanyData(['RO12345678'], { includeEfacturaRegistry: false });

      expect(result).toMatchObject({ success: false, statusCode: 429, retryAfter: '5', retryable: true });
    });

    test('marks 5xx and network errors retryable and other 4xx final', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockErrorResponse(503, 'Service Unavailable', 'down'))
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce(mockErrorResponse(400, 'Bad Request', 'bad'));
      const opts = { includeEfacturaRegistry: false };

      expect(await client.batchGetCompanyData(['RO12345678'], opts)).toMatchObject({
        statusCode: 503,
        retryable: true,
      });
      expect(await client.batchGetCompanyData(['RO12345678'], opts)).toMatchObject({
        statusCode: undefined,
        retryable: true,
      });
      expect(await client.batchGetCompanyData(['RO12345678'], opts)).toMatchObject({
        statusCode: 400,
        retryable: false,
      });
    });

    test('rejects more than 100 CUIs without calling ANAF, and sends 100 in one request', async () => {
      const cuis = Array.from({ length: 101 }, (_, i) => String(1000 + i));

      const result = await client.batchGetCompanyData(cuis);

      expect(result).toEqual({ success: false, error: 'Maximum 100 CUI codes per request.' });
      expect(fetch).not.toHaveBeenCalled();

      (fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({ found: [], notFound: [] }));
      await client.batchGetCompanyData(cuis.slice(0, 100), { includeEfacturaRegistry: false });
      expect(sentBody()).toHaveLength(100);
    });

    test('sends the caller-set request date', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({ found: found(12345678, '6201'), notFound: [] }));

      await client.batchGetCompanyData(['RO12345678'], { date: '2025-01-31', includeEfacturaRegistry: false });

      expect(sentBody()).toEqual([{ cui: 12345678, data: '2025-01-31' }]);
    });

    test('rejects a malformed or impossible request date without calling ANAF', async () => {
      for (const date of ['31.01.2025', '2025-02-30', '2025-13-01']) {
        expect((await client.batchGetCompanyData(['RO12345678'], { date })).success).toBe(false);
      }
      expect(fetch).not.toHaveBeenCalled();
    });

    test('rejects CUIs that are not digits after an optional RO prefix', async () => {
      const result = await client.batchGetCompanyData(['12abc', 'RO12 34', '1.5e3']);

      expect(result).toEqual({ success: false, error: 'All 3 provided VAT code(s) are invalid.' });
      expect(fetch).not.toHaveBeenCalled();
      expect(await client.isValidVatCode('12abc')).toBe(false);
    });

    test('accepts whitespace between the RO prefix and the digits', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({ found: found(123, '6201'), notFound: [] }));

      await client.batchGetCompanyData(['RO 123'], { includeEfacturaRegistry: false });

      expect(sentBody()[0].cui).toBe(123);
      expect(await client.isValidVatCode('RO 123')).toBe(true);
      expect(await client.isValidVatCode('RO 1')).toBe(false);
      expect((await client.batchGetCompanyData(['RO1'])).error).toBe('All 1 provided VAT code(s) are invalid.');
    });
  });

  describe('Async API', () => {
    const mockFullDetails: AnafCompanyFullDetails = {
      date_generale: {
        cui: 12345678,
        data: '2026-04-10',
        denumire: 'Test Company SRL',
        adresa: 'Str. Test Nr. 1, Bucuresti',
        nrRegCom: 'J40/1234/2020',
        telefon: '0212345678',
        fax: '',
        codPostal: '010101',
        act: '',
        stare_inregistrare: 'INREGISTRAT',
        data_inregistrare: '2020-01-15',
        cod_CAEN: '6201',
        iban: '',
        statusRO_e_Factura: true,
        organFiscalCompetent: 'ADMINISTRATIA SECTOR 1',
        forma_de_proprietate: 'PRIVAT',
        forma_organizare: 'SRL',
        forma_juridica: 'SRL',
      },
      inregistrare_scop_Tva: {
        scpTVA: true,
        perioade_TVA: {
          data_inceput_ScpTVA: '2020-01-15',
          data_sfarsit_ScpTVA: '',
          data_anul_imp_ScpTVA: '',
          mesaj_ScpTVA: '',
        },
      },
      inregistrare_RTVAI: {
        dataInceputTvaInc: '',
        dataSfarsitTvaInc: '',
        dataActualizareTvaInc: '',
        dataPublicareTvaInc: '',
        tipActTvaInc: '',
        statusTvaIncasare: false,
      },
      stare_inactiv: {
        dataInactivare: '',
        dataReactivare: '',
        dataPublicare: '',
        dataRadiere: '',
        statusInactivi: false,
      },
      inregistrare_SplitTVA: {
        dataInceputSplitTVA: '',
        dataAnulareSplitTVA: '',
        statusSplitTVA: false,
      },
      adresa_sediu_social: {
        sdenumire_Strada: 'Str. Test',
        snumar_Strada: '1',
        sdenumire_Localitate: 'Bucuresti',
        scod_Localitate: '1',
        sdenumire_Judet: 'MUNICIPIUL BUCURESTI',
        scod_Judet: '40',
        scod_JudetAuto: 'B',
        stara: 'Romania',
        sdetalii_Adresa: '',
        scod_Postal: '010101',
      },
      adresa_domiciliu_fiscal: {
        ddenumire_Strada: 'Str. Test',
        dnumar_Strada: '1',
        ddenumire_Localitate: 'Bucuresti',
        dcod_Localitate: '1',
        ddenumire_Judet: 'MUNICIPIUL BUCURESTI',
        dcod_Judet: '40',
        dcod_JudetAuto: 'B',
        dtara: 'Romania',
        ddetalii_Adresa: '',
        dcod_Postal: '010101',
      },
    };

    const mockSubmitResponse: AnafAsyncSubmitResponse = {
      cod: 200,
      message: 'Successful',
      correlationId: 'test-correlation-id-123',
    };

    const mockAsyncResult: AnafAsyncResultResponse = {
      cod: 200,
      message: 'SUCCESS',
      found: [mockFullDetails],
      notFound: [],
    };

    test('should fetch company data via async API', async () => {
      // POST submit
      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse(mockSubmitResponse))
        // GET result
        .mockResolvedValueOnce(mockJsonResponse(mockAsyncResult));

      const result = await client.getCompanyDataAsync('RO12345678', {
        initialDelay: 0, // speed up test (will be clamped to 2000ms minimum)
      });

      // Note: initialDelay minimum is 2000ms, so this test takes at least 2s
      expect(result.success).toBe(true);
      expect(result.data?.[0]?.vatCode).toBe('12345678');
      expect(result.data?.[0]?.name).toBe('Test Company SRL');
      expect(result.data?.[0]?.scpTva).toBe(true);
      expect(result.fullDetails?.[0]?.date_generale.statusRO_e_Factura).toBe(true);
      expect(result.fullDetails?.[0]?.stare_inactiv.statusInactivi).toBe(false);
      expect(result.fullDetails?.[0]?.adresa_sediu_social.sdenumire_Judet).toBe('MUNICIPIUL BUCURESTI');
      expect(result.notFound).toEqual([]);
    }, 15000);

    test('should handle async submit failure', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.getCompanyDataAsync('RO12345678');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to submit async request');
    });

    test('should handle missing correlationId', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({ cod: 200, message: 'Successful' }));

      const result = await client.getCompanyDataAsync('RO12345678');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No correlationId');
    });

    test('should reject more than 100 CUIs', async () => {
      const codes = Array.from({ length: 101 }, (_, i) => `RO${10000000 + i}`);

      const result = await client.batchGetCompanyDataAsync(codes);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Maximum 100 CUI codes per request.');
      expect(fetch).not.toHaveBeenCalled();
    });

    test('should poll and retry when result is not ready', async () => {
      const pendingResponse = { cod: 0, message: 'Processing' };

      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse(mockSubmitResponse))
        // First poll: not ready
        .mockResolvedValueOnce(mockJsonResponse(pendingResponse))
        // Second poll: ready
        .mockResolvedValueOnce(mockJsonResponse(mockAsyncResult));

      const result = await client.getCompanyDataAsync('RO12345678', {
        initialDelay: 2000,
        retryDelay: 100, // fast retries for testing
        maxRetries: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data?.[0]?.name).toBe('Test Company SRL');
      // submit POST + 2 GET polls
      expect(fetch).toHaveBeenCalledTimes(3);
    }, 15000);

    test('should return error after max retries exceeded', async () => {
      const pendingResponse = { cod: 0, message: 'Processing' };

      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse(mockSubmitResponse))
        .mockResolvedValue(mockJsonResponse(pendingResponse));

      const result = await client.getCompanyDataAsync('RO12345678', {
        initialDelay: 2000,
        retryDelay: 100,
        maxRetries: 2,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available after 2 poll attempts');
    }, 15000);

    test('should handle notFound CUIs in async response', async () => {
      const resultWithNotFound: AnafAsyncResultResponse = {
        cod: 200,
        message: 'SUCCESS',
        found: [mockFullDetails],
        notFound: [{ cui: 99999999 }],
      };

      (fetch as jest.Mock)
        .mockResolvedValueOnce(mockJsonResponse(mockSubmitResponse))
        .mockResolvedValueOnce(mockJsonResponse(resultWithNotFound));

      const result = await client.batchGetCompanyDataAsync(['RO12345678', 'RO99999999'], {
        initialDelay: 2000,
        retryDelay: 100,
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.notFound).toEqual([99999999]);
    }, 15000);

    test('should validate empty VAT codes for async', async () => {
      const result = await client.batchGetCompanyDataAsync([]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No VAT codes provided.');
    });

    test('should validate invalid VAT codes for async', async () => {
      const result = await client.batchGetCompanyDataAsync(['invalid', 'abc']);

      expect(result.success).toBe(false);
      expect(result.error).toContain('provided VAT code(s) are invalid');
    });
  });
});
