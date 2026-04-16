import { describe, it, expect, jest } from '@jest/globals';
import { handleInvoiceStatus } from '../../src/tools/status.js';

describe('handleInvoiceStatus', () => {
  it('returns status with idDescarcare when processing complete', async () => {
    const mockClient = {
      getUploadStatus: jest
        .fn<() => Promise<{ stare: string; idDescarcare: string }>>()
        .mockResolvedValue({ stare: 'ok', idDescarcare: 'dl-42' }),
    };
    const result = await handleInvoiceStatus({ upload_id: '12345' }, { efactura: mockClient as any });
    expect(mockClient.getUploadStatus).toHaveBeenCalledWith('12345');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('dl-42');
    expect(result.content[0].text).toContain('"stare": "ok"');
  });

  it('returns in-progress status', async () => {
    const mockClient = {
      getUploadStatus: jest.fn<() => Promise<{ stare: string }>>().mockResolvedValue({ stare: 'in prelucrare' }),
    };
    const result = await handleInvoiceStatus({ upload_id: '12345' }, { efactura: mockClient as any });
    expect(result.content[0].text).toContain('in prelucrare');
  });

  it('wraps errors', async () => {
    const mockClient = {
      getUploadStatus: jest.fn<() => Promise<never>>().mockRejectedValue(new Error('not found')),
    };
    const result = await handleInvoiceStatus({ upload_id: 'bogus' }, { efactura: mockClient as any });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/STATUS_FAILED|not found/);
  });
});
