import { describe, it, expect, jest } from '@jest/globals';
import { handleUploadInvoice } from '../../src/tools/upload.js';

describe('handleUploadInvoice', () => {
  it('calls uploadDocument for B2B and returns indexIncarcare', async () => {
    const mockClient = {
      uploadDocument: jest
        .fn<() => Promise<{ executionStatus: number; indexIncarcare: string }>>()
        .mockResolvedValue({ executionStatus: 0, indexIncarcare: '12345' }),
      uploadB2CDocument: jest.fn<() => Promise<{ executionStatus: number; indexIncarcare: string }>>(),
    };
    const result = await handleUploadInvoice({ xml: '<Invoice/>' }, { efactura: mockClient as any });
    expect(mockClient.uploadDocument).toHaveBeenCalled();
    expect(mockClient.uploadB2CDocument).not.toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('12345');
  });

  it('calls uploadB2CDocument when b2c=true', async () => {
    const mockClient = {
      uploadDocument: jest.fn<() => Promise<{ executionStatus: number; indexIncarcare: string }>>(),
      uploadB2CDocument: jest
        .fn<() => Promise<{ executionStatus: number; indexIncarcare: string }>>()
        .mockResolvedValue({ executionStatus: 0, indexIncarcare: 'b2c-9' }),
    };
    const result = await handleUploadInvoice({ xml: '<Invoice/>', b2c: true }, { efactura: mockClient as any });
    expect(mockClient.uploadB2CDocument).toHaveBeenCalled();
    expect(mockClient.uploadDocument).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('b2c-9');
  });

  it('wraps errors', async () => {
    const mockClient = {
      uploadDocument: jest.fn<() => Promise<never>>().mockRejectedValue(new Error('403 forbidden')),
      uploadB2CDocument: jest.fn<() => Promise<{ executionStatus: number; indexIncarcare: string }>>(),
    };
    const result = await handleUploadInvoice({ xml: '<Invoice/>' }, { efactura: mockClient as any });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/UPLOAD_FAILED|403/);
  });
});
