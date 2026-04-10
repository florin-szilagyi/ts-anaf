import { AnafEfacturaClient } from '../src/AnafClient';
import { AnafAuthenticator } from '../src/AnafAuthenticator';
import { AnafApiError, AnafValidationError } from '../src/errors';

// Mock fetch globally
(global as any).fetch = jest.fn();

// Mock the authenticator to return a fixed access token
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

// Helper to create a minimal Headers-like object
const createMockHeaders = (entries: [string, string][]): Headers => {
  const map = new Map(entries.map(([k, v]) => [k.toLowerCase(), v]));
  return {
    get: (name: string) => map.get(name.toLowerCase()) || null,
    has: (name: string) => map.has(name.toLowerCase()),
    forEach: (cb: (value: string, key: string) => void) => map.forEach(cb),
  } as any;
};

describe('ANAF PDF Transformation Operations', () => {
  let client: AnafEfacturaClient;
  const xml = `<?xml version="1.0"?><Invoice>test</Invoice>`;

  beforeEach(() => {
    jest.clearAllMocks();
    const auth = new AnafAuthenticator({ clientId: 'id', clientSecret: 'secret', redirectUri: 'uri' });
    client = new AnafEfacturaClient({ vatNumber: 'RO123', testMode: true, refreshToken: 'rt' }, auth);
  });

  describe('convertXmlToPdf (with validation)', () => {
    it('should convert XML to PDF successfully with FACT1', async () => {
      const buf = Buffer.from('%PDF-1.4');
      const arrBuf1 = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/pdf']]),
        arrayBuffer: () => Promise.resolve(arrBuf1),
      });

      const result = await client.convertXmlToPdf(xml, 'FACT1');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.slice(0, 4).toString()).toBe('%PDF');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/transformare/FACT1'),
        expect.objectContaining({ method: 'POST', body: xml })
      );
    });

    it('should convert XML to PDF successfully with FCN', async () => {
      const buf = Buffer.from('%PDF-FCN');
      const arrBuf2 = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/pdf']]),
        arrayBuffer: () => Promise.resolve(arrBuf2),
      });

      const result = await client.convertXmlToPdf(xml, 'FCN');
      expect(result).toBeInstanceOf(Buffer);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/transformare/FCN'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should throw AnafApiError on JSON error response', async () => {
      const err = { stare: 'nok', Messages: [{ message: 'err' }], trace_id: 'tid' };
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/json']]),
        json: () => Promise.resolve(err),
      });

      await expect(client.convertXmlToPdf(xml, 'FACT1')).rejects.toThrow(AnafApiError);
    });

    it('should throw validation error for empty XML', async () => {
      await expect(client.convertXmlToPdf('', 'FACT1')).rejects.toThrow(AnafValidationError);
    });

    it('should throw validation error for invalid standard', async () => {
      await expect(client.convertXmlToPdf(xml, 'INVALID' as any)).rejects.toThrow(AnafValidationError);
    });
  });

  describe('convertXmlToPdfNoValidation (without validation)', () => {
    it('should convert XML to PDF without validation successfully', async () => {
      const buf = Buffer.from('%PDF-NOVLD');
      const arrBuf3 = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/pdf']]),
        arrayBuffer: () => Promise.resolve(arrBuf3),
      });

      const result = await client.convertXmlToPdfNoValidation(xml, 'FACT1');
      expect(result).toBeInstanceOf(Buffer);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/transformare/FACT1/DA'),
        expect.objectContaining({ method: 'POST', body: xml })
      );
    });

    it('should throw AnafApiError on JSON error response', async () => {
      const err = { stare: 'nok', Messages: [{ message: 'errnv' }], trace_id: 'tid2' };
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/json']]),
        json: () => Promise.resolve(err),
      });

      await expect(client.convertXmlToPdfNoValidation(xml, 'FACT1')).rejects.toThrow(AnafApiError);
    });

    it('should use FACT1 by default', async () => {
      const buf = Buffer.from('%PDF-DEF');
      const arrBuf4 = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: createMockHeaders([['content-type', 'application/pdf']]),
        arrayBuffer: () => Promise.resolve(arrBuf4),
      });

      await client.convertXmlToPdfNoValidation(xml);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/transformare/FACT1/DA'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should throw validation error for empty XML', async () => {
      await expect(client.convertXmlToPdfNoValidation('')).rejects.toThrow(AnafValidationError);
    });

    it('should throw validation error for invalid standard', async () => {
      await expect(client.convertXmlToPdfNoValidation(xml, 'INVALID' as any)).rejects.toThrow(AnafValidationError);
    });
  });

  describe('Error Handling', () => {
    it('should propagate network errors', async () => {
      (fetch as jest.Mock).mockRejectedValue(new Error('Network'));
      await expect(client.convertXmlToPdf(xml, 'FACT1')).rejects.toThrow();
    });
  });
});
