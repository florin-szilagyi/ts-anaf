import { HttpClient } from '../src/utils/httpClient';

global.fetch = jest.fn();

function mockFetchOnce(opts: { contentType: string | null; body: string | ArrayBuffer | object }): void {
  const headers = {
    get: (name: string) => (name.toLowerCase() === 'content-type' ? opts.contentType : null),
  };
  const response: any = {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers,
    text: jest.fn().mockResolvedValue(typeof opts.body === 'string' ? opts.body : ''),
    json: jest.fn().mockResolvedValue(typeof opts.body === 'object' && !(opts.body instanceof ArrayBuffer) ? opts.body : {}),
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(opts.body instanceof ArrayBuffer ? opts.body : new ArrayBuffer(0)),
  };
  (fetch as jest.Mock).mockResolvedValueOnce(response);
}

describe('HttpClient.parseResponse — fail-closed binary default', () => {
  let client: HttpClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new HttpClient({ baseURL: 'https://example.test' });
  });

  describe('binary content types are returned as ArrayBuffer', () => {
    const binaryContentTypes = [
      'application/zip',
      'application/x-zip-compressed',
      'application/pdf',
      'application/octet-stream',
      'image/png',
      'image/jpeg',
      'application/foo-future-binary-format',
      null, // missing content-type → fail closed
      '',
    ];

    test.each(binaryContentTypes)('content-type %p → ArrayBuffer', async (ct) => {
      const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x80, 0xc3, 0x28]);
      mockFetchOnce({ contentType: ct, body: bytes.buffer });

      const res = await client.get<ArrayBuffer>('/x');

      expect(res.data).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(res.data as ArrayBuffer)).toEqual(bytes);
    });
  });

  describe('text-shaped content types are returned as string', () => {
    const textCases: Array<[string, string]> = [
      ['text/plain', 'hello world'],
      ['text/plain; charset=UTF-8', 'hello world'],
      ['text/html', '<html></html>'],
      ['text/xml', '<root/>'],
      ['application/xml', '<root/>'],
      ['application/xml; charset=utf-8', '<root/>'],
      ['application/atom+xml', '<feed/>'],
      ['application/x-www-form-urlencoded', 'a=1&b=2'],
    ];

    test.each(textCases)('content-type %p → string', async (ct, body) => {
      mockFetchOnce({ contentType: ct, body });

      const res = await client.get<string>('/x');

      expect(typeof res.data).toBe('string');
      expect(res.data).toBe(body);
    });
  });

  describe('JSON content type is parsed', () => {
    test('application/json → parsed object', async () => {
      mockFetchOnce({ contentType: 'application/json', body: { ok: true, n: 42 } });

      const res = await client.get<{ ok: boolean; n: number }>('/x');

      expect(res.data).toEqual({ ok: true, n: 42 });
    });

    test('application/json; charset=utf-8 → parsed object', async () => {
      mockFetchOnce({ contentType: 'application/json; charset=utf-8', body: { a: 1 } });

      const res = await client.get<{ a: number }>('/x');

      expect(res.data).toEqual({ a: 1 });
    });
  });

  describe('content-type matching is case-insensitive', () => {
    test('Application/JSON → parsed object', async () => {
      mockFetchOnce({ contentType: 'Application/JSON', body: { ok: true } });
      const res = await client.get<{ ok: boolean }>('/x');
      expect(res.data).toEqual({ ok: true });
    });

    test('TEXT/XML → string', async () => {
      mockFetchOnce({ contentType: 'TEXT/XML', body: '<x/>' });
      const res = await client.get<string>('/x');
      expect(res.data).toBe('<x/>');
    });
  });
});
