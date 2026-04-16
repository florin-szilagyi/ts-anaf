import { describe, it, expect, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleDownloadInvoice } from '../../src/tools/download.js';

describe('handleDownloadInvoice', () => {
  it('writes ZIP bytes to the given output_path and returns metadata', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-mcp-dl-'));
    const outPath = path.join(tmpDir, 'invoice.zip');
    try {
      const fakeZip = Buffer.from('PK\u0003\u0004fake zip bytes');
      const mockClient = {
        downloadDocument: jest.fn<() => Promise<string>>().mockResolvedValue(fakeZip.toString('base64')),
      };
      const result = await handleDownloadInvoice(
        { download_id: 'dl-42', output_path: outPath },
        { efactura: mockClient as any }
      );
      expect(mockClient.downloadDocument).toHaveBeenCalledWith('dl-42');
      expect(result.isError).toBeFalsy();
      expect(fs.existsSync(outPath)).toBe(true);
      const written = fs.readFileSync(outPath);
      expect(written.equals(fakeZip)).toBe(true);
      expect(result.content[0].text).toContain(outPath);
      expect(result.content[0].text).toContain(String(fakeZip.length));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('wraps SDK errors', async () => {
    const mockClient = {
      downloadDocument: jest.fn<() => Promise<never>>().mockRejectedValue(new Error('404')),
    };
    const result = await handleDownloadInvoice(
      { download_id: 'bogus', output_path: '/tmp/should-not-exist.zip' },
      { efactura: mockClient as any }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/DOWNLOAD_FAILED|404/);
  });
});
