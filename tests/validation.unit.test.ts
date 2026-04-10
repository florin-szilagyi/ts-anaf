import { AnafEfacturaClient } from '../src/AnafClient';
import { AnafAuthenticator } from '../src/AnafAuthenticator';
import { ValidationResult } from '../src/types';
import { AnafApiError, AnafValidationError } from '../src/errors';

// Mock fetch globally
(global as any).fetch = jest.fn();
const fetchMock = fetch as jest.Mock;

// Mock AnafAuthenticator to return a fixed access token
jest.mock('../src/AnafAuthenticator', () => ({
  AnafAuthenticator: jest.fn().mockImplementation(() => ({
    refreshAccessToken: jest.fn().mockResolvedValue({
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
    }),
  })),
}));

// Helper for Headers-like object
const createMockHeaders = (entries: [string, string][]): Headers => {
  const map = new Map(entries.map(([k, v]) => [k.toLowerCase(), v]));
  return {
    get: (name: string) => map.get(name.toLowerCase()) || null,
    has: (name: string) => map.has(name.toLowerCase()),
    forEach: (cb: (value: string, key: string) => void) => map.forEach(cb),
  } as any;
};

describe('ANAF Validation Operations', () => {
  let client: AnafEfacturaClient;
  const xml = `<?xml version="1.0"?><Invoice>TEST</Invoice>`;

  beforeEach(() => {
    jest.clearAllMocks();
    const auth = new AnafAuthenticator({ clientId: 'id', clientSecret: 'secret', redirectUri: 'uri' });
    client = new AnafEfacturaClient({ vatNumber: 'RO123', testMode: true, refreshToken: 'rt' }, auth);
  });

  describe('validateXml', () => {
    it('should validate XML successfully with FACT1 standard', async () => {
      const resp = { stare: 'ok', trace_id: 'tid1' };
      (fetchMock as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/json']]),
        json: () => Promise.resolve(resp),
      });

      const result = await client.validateXml(xml, 'FACT1');
      expect(result).toEqual({
        valid: true,
        details: 'Validation passed',
        info: `Validation performed using FACT1 standard (trace_id: ${resp.trace_id})`,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/validare/FACT1'),
        expect.objectContaining({ method: 'POST', body: xml })
      );
    });

    it('should validate XML successfully with FCN standard', async () => {
      const resp = { stare: 'ok', trace_id: 'tid2' };
      (fetchMock as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/json']]),
        json: () => Promise.resolve(resp),
      });

      const result = await client.validateXml(xml, 'FCN');
      expect(result.valid).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/validare/FCN'),
        expect.objectContaining({ method: 'POST', body: xml })
      );
    });

    it('should handle validation errors from OpenAPI example', async () => {
      const resp = { stare: 'nok', Messages: [{ message: 'err1' }, { message: 'err2' }], trace_id: 'tid3' };
      (fetchMock as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/json']]),
        json: () => Promise.resolve(resp),
      });

      const result = await client.validateXml(xml, 'FACT1');
      expect(result.valid).toBe(false);
      expect(result.details).toContain('err1');
      expect(result.details).toContain('err2');
    });

    it('should throw validation error for empty XML content', async () => {
      await expect(client.validateXml('', 'FACT1')).rejects.toThrow(AnafValidationError);
      await expect(client.validateXml('   ', 'FACT1')).rejects.toThrow(AnafValidationError);
    });

    it('should throw validation error for invalid standard', async () => {
      await expect(client.validateXml(xml, 'INVALID' as any)).rejects.toThrow(AnafValidationError);
    });

    it('should use default FACT1 standard when not specified', async () => {
      const resp = { stare: 'ok', trace_id: 'tid4' };
      (fetchMock as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/json']]),
        json: () => Promise.resolve(resp),
      });

      const result = await client.validateXml(xml);
      expect(result.valid).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/validare/FACT1'),
        expect.objectContaining({ method: 'POST', body: xml })
      );
    });

    it('should handle HTTP error responses correctly', async () => {
      fetchMock.mockRejectedValue(new AnafApiError('HTTP 500'));
      await expect(client.validateXml(xml, 'FACT1')).rejects.toThrow(AnafApiError);
    });
  });

  describe('Signature Validation - /api/validate/signature', () => {
    const mockXmlBuffer = Buffer.from('<?xml version="1.0"?><test/>', 'utf-8');
    const mockSignatureBuffer = Buffer.from('signature-data', 'utf-8');

    test('should validate signature successfully from OpenAPI example', async () => {
      const successResponse = {
        msg: 'Fișierele încărcate au fost validate cu succes, din perspectiva autenticității semnăturii aplicate și a apartenenței acesteia la XML-ul ce reprezintă factura electronică. Documentul factură de tip XML cu semnătura de validare atașată, este considerat document original din perspectiva legislativă și este generat prin intermediul sistemului național RO e-Factura.',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/json']]),
        json: jest.fn().mockResolvedValue(successResponse),
        text: jest.fn().mockResolvedValue(''),
      });

      const result = await client.validateSignature(mockXmlBuffer, mockSignatureBuffer, 'test.xml', 'test.sig');

      expect(result.valid).toBe(true);
      expect(result.details).toContain('validate cu succes');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/validate/signature'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-access-token',
          }),
          body: expect.any(FormData),
        })
      );
    });

    test('should validate signature with File objects (browser scenario)', async () => {
      const mockXmlFile = new File(['<?xml version="1.0"?><test/>'], 'test.xml', { type: 'application/xml' });
      const mockSigFile = new File(['signature-data'], 'test.sig', { type: 'application/octet-stream' });

      const successResponse = {
        msg: 'Fișierele încărcate au fost validate cu succes',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/json']]),
        json: jest.fn().mockResolvedValue(successResponse),
        text: jest.fn().mockResolvedValue(''),
      });

      const result = await client.validateSignature(mockXmlFile, mockSigFile);

      expect(result.valid).toBe(true);
      expect(result.details).toContain('validate cu succes');

      // Verify FormData was created correctly
      const formDataCall = fetchMock.mock.calls[0];
      expect(formDataCall[1].body).toBeInstanceOf(FormData);
    });

    test('should validate signature with Buffer objects (Node.js scenario)', async () => {
      const successResponse = {
        msg: 'Fișierele încărcate au fost validate cu succes',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/json']]),
        json: jest.fn().mockResolvedValue(successResponse),
        text: jest.fn().mockResolvedValue(''),
      });

      const result = await client.validateSignature(mockXmlBuffer, mockSignatureBuffer, 'invoice.xml', 'signature.sig');

      expect(result.valid).toBe(true);
      expect(result.details).toContain('validate cu succes');
    });

    test('should handle signature validation failure from OpenAPI example', async () => {
      const failureResponse = {
        msg: 'Fișierele încărcate NU au putut fi validate cu succes, din perspectiva autenticității semnăturii aplicate și a apartenenței acesteia la XML-ul ce reprezintă factura electronică. Documentul factură de tip XML cu semnătura de validare atașată, NU poate fi considerat document original din perspectiva legislativă și NU este generat prin intermediul sistemului național RO e-Factura.',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/json']]),
        json: jest.fn().mockResolvedValue(failureResponse),
        text: jest.fn().mockResolvedValue(''),
      });

      const result = await client.validateSignature(mockXmlBuffer, mockSignatureBuffer, 'test.xml', 'test.sig');

      expect(result.valid).toBe(false);
      expect(result.details).toContain('NU au putut fi validate cu succes');
    });

    test('should handle technical error from OpenAPI example', async () => {
      const technicalErrorResponse = {
        msg: 'Eroare tehnică: request incorect. Cauza: cel puțin unul din documente NU a fost încărcat sau NU este un fisier de tip XML specific facturii electronice.',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/json']]),
        json: jest.fn().mockResolvedValue(technicalErrorResponse),
        text: jest.fn().mockResolvedValue(''),
      });

      const result = await client.validateSignature(mockXmlBuffer, mockSignatureBuffer, 'test.xml', 'test.sig');

      expect(result.valid).toBe(false);
      expect(result.details).toContain('Eroare tehnică: request incorect');
    });

    test('should throw validation error for missing file name with Buffer', async () => {
      await expect(client.validateSignature(mockXmlBuffer, mockSignatureBuffer)).rejects.toThrow(AnafValidationError);

      await expect(client.validateSignature(mockXmlBuffer, mockSignatureBuffer, 'test.xml')).rejects.toThrow(
        AnafValidationError
      );
    });

    test('should throw validation error for invalid file types', async () => {
      await expect(client.validateSignature('invalid' as any, mockSignatureBuffer)).rejects.toThrow(
        AnafValidationError
      );

      await expect(client.validateSignature(mockXmlBuffer, 'invalid' as any)).rejects.toThrow(AnafValidationError);
    });
  });
});
