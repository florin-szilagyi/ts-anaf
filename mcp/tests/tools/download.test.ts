import { describe, it, expect, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleDownloadInvoice, handleDownloadInvoicePdf } from '../../src/tools/download.js';

describe('handleDownloadInvoice', () => {
  it('writes ZIP bytes to the given output_path and returns metadata', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-mcp-dl-'));
    const outPath = path.join(tmpDir, 'invoice.zip');
    try {
      const fakeZip = Buffer.from('PK\u0003\u0004fake zip bytes');
      const mockClient = {
        downloadDocument: jest.fn<() => Promise<Buffer>>().mockResolvedValue(fakeZip),
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

  it('reports a local write failure as WRITE_FAILED', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-mcp-dl-'));
    try {
      const mockClient = {
        downloadDocument: jest.fn<() => Promise<Buffer>>().mockResolvedValue(Buffer.from('zip')),
      };
      const result = await handleDownloadInvoice(
        { download_id: 'dl-1', output_path: tmpDir },
        { efactura: mockClient as any }
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('WRITE_FAILED');
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

describe('handleDownloadInvoicePdf', () => {
  it('renders the downloaded invoice XML to a PDF at output_path', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-mcp-pdf-'));
    const outPath = path.join(tmpDir, 'nested', 'invoice.pdf');
    try {
      const pdf = Buffer.from('%PDF-1.4 fake');
      const mockClient = {
        downloadDocumentXml: jest.fn<() => Promise<string>>().mockResolvedValue('<Invoice/>'),
      };
      const mockTools = {
        convertXmlToPdf: jest.fn<() => Promise<Buffer>>().mockResolvedValue(pdf),
        convertXmlToPdfNoValidation: jest.fn<() => Promise<Buffer>>().mockResolvedValue(Buffer.from('nope')),
      };

      const result = await handleDownloadInvoicePdf(
        { download_id: 'dl-42', output_path: outPath },
        { efactura: mockClient as any, tools: mockTools as any }
      );

      expect(mockClient.downloadDocumentXml).toHaveBeenCalledWith('dl-42');
      expect(mockTools.convertXmlToPdf).toHaveBeenCalledWith('<Invoice/>', 'FACT1');
      expect(mockTools.convertXmlToPdfNoValidation).not.toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
      expect(fs.readFileSync(outPath).equals(pdf)).toBe(true);
      expect(result.content[0].text).toContain(outPath);
      expect(result.content[0].text).toContain('FACT1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('honours standard and no_validation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-mcp-pdf-'));
    const outPath = path.join(tmpDir, 'credit-note.pdf');
    try {
      const mockClient = {
        downloadDocumentXml: jest.fn<() => Promise<string>>().mockResolvedValue('<CreditNote/>'),
      };
      const mockTools = {
        convertXmlToPdf: jest.fn<() => Promise<Buffer>>().mockResolvedValue(Buffer.from('nope')),
        convertXmlToPdfNoValidation: jest.fn<() => Promise<Buffer>>().mockResolvedValue(Buffer.from('%PDF-1.4 cn')),
      };

      const result = await handleDownloadInvoicePdf(
        { download_id: 'dl-7', output_path: outPath, standard: 'FCN', no_validation: true },
        { efactura: mockClient as any, tools: mockTools as any }
      );

      expect(mockTools.convertXmlToPdfNoValidation).toHaveBeenCalledWith('<CreditNote/>', 'FCN');
      expect(mockTools.convertXmlToPdf).not.toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
      expect(fs.readFileSync(outPath).toString('utf8')).toBe('%PDF-1.4 cn');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('wraps download errors', async () => {
    const mockClient = {
      downloadDocumentXml: jest.fn<() => Promise<never>>().mockRejectedValue(new Error('no such invoice')),
    };
    const mockTools = {
      convertXmlToPdf: jest.fn<() => Promise<Buffer>>(),
      convertXmlToPdfNoValidation: jest.fn<() => Promise<Buffer>>(),
    };

    const result = await handleDownloadInvoicePdf(
      { download_id: 'bogus', output_path: '/tmp/should-not-exist.pdf' },
      { efactura: mockClient as any, tools: mockTools as any }
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/DOWNLOAD_PDF_FAILED|no such invoice/);
    expect(mockTools.convertXmlToPdf).not.toHaveBeenCalled();
  });

  it('reports a local write failure as WRITE_FAILED, not as an ANAF failure', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-mcp-pdf-'));
    try {
      const mockClient = {
        downloadDocumentXml: jest.fn<() => Promise<string>>().mockResolvedValue('<Invoice/>'),
      };
      const mockTools = {
        convertXmlToPdf: jest.fn<() => Promise<Buffer>>().mockResolvedValue(Buffer.from('%PDF-1.4')),
        convertXmlToPdfNoValidation: jest.fn<() => Promise<Buffer>>(),
      };

      // A directory is not a writable target for the PDF.
      const result = await handleDownloadInvoicePdf(
        { download_id: 'dl-42', output_path: tmpDir },
        { efactura: mockClient as any, tools: mockTools as any }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('WRITE_FAILED');
      expect(result.content[0].text).not.toContain('DOWNLOAD_PDF_FAILED');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports invalid input as INVALID_INPUT when called directly', async () => {
    const result = await handleDownloadInvoicePdf({ download_id: '', output_path: '' } as any, {
      efactura: { downloadDocumentXml: jest.fn<() => Promise<string>>() } as any,
      tools: {
        convertXmlToPdf: jest.fn<() => Promise<Buffer>>(),
        convertXmlToPdfNoValidation: jest.fn<() => Promise<Buffer>>(),
      } as any,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('INVALID_INPUT');
  });

  it('wraps conversion errors', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-mcp-pdf-'));
    const outPath = path.join(tmpDir, 'invoice.pdf');
    try {
      const mockClient = {
        downloadDocumentXml: jest.fn<() => Promise<string>>().mockResolvedValue('<Invoice/>'),
      };
      const mockTools = {
        convertXmlToPdf: jest.fn<() => Promise<never>>().mockRejectedValue(new Error('transform refused')),
        convertXmlToPdfNoValidation: jest.fn<() => Promise<Buffer>>(),
      };

      const result = await handleDownloadInvoicePdf(
        { download_id: 'dl-42', output_path: outPath },
        { efactura: mockClient as any, tools: mockTools as any }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/DOWNLOAD_PDF_FAILED|transform refused/);
      expect(fs.existsSync(outPath)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
