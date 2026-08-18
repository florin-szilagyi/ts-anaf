import { buildZip } from './zipFixtures';
import { readZipEntries, extractInvoiceXml } from '../src/utils/zipReader';
import { AnafValidationError } from '../src/errors';

const INVOICE_XML = '<?xml version="1.0" encoding="UTF-8"?><Invoice><ID>FCT-1</ID></Invoice>';
const SIGNATURE_XML = '<?xml version="1.0"?><Signature>sig</Signature>';

describe('readZipEntries', () => {
  it('reads deflate-compressed entries', () => {
    const zip = buildZip([{ name: '4013735587.xml', content: INVOICE_XML }]);
    const entries = readZipEntries(zip);

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('4013735587.xml');
    expect(entries[0].data.toString('utf8')).toBe(INVOICE_XML);
  });

  it('reads stored (uncompressed) entries', () => {
    const zip = buildZip([{ name: 'plain.xml', content: INVOICE_XML, method: 0 }]);
    const entries = readZipEntries(zip);

    expect(entries[0].data.toString('utf8')).toBe(INVOICE_XML);
  });

  it('reads multiple entries', () => {
    const zip = buildZip([
      { name: '4013735587.xml', content: INVOICE_XML },
      { name: 'semnatura_4013735587.xml', content: SIGNATURE_XML },
    ]);
    const entries = readZipEntries(zip);

    expect(entries.map((e) => e.name)).toEqual(['4013735587.xml', 'semnatura_4013735587.xml']);
  });

  it('rejects a buffer that is not a ZIP archive', () => {
    expect(() => readZipEntries(Buffer.from('not a zip at all'))).toThrow(AnafValidationError);
  });

  it('rejects an empty buffer', () => {
    expect(() => readZipEntries(Buffer.alloc(0))).toThrow(AnafValidationError);
  });

  it('rejects a truncated archive', () => {
    const zip = buildZip([{ name: 'a.xml', content: INVOICE_XML }]);
    const truncated = Buffer.concat([Buffer.alloc(0), zip.subarray(10)]);
    expect(() => readZipEntries(truncated)).toThrow(AnafValidationError);
  });
});

describe('extractInvoiceXml', () => {
  it('picks the invoice XML over the detached signature', () => {
    const zip = buildZip([
      { name: 'semnatura_4013735587.xml', content: SIGNATURE_XML },
      { name: '4013735587.xml', content: INVOICE_XML },
    ]);

    expect(extractInvoiceXml(zip)).toBe(INVOICE_XML);
  });

  it('strips a UTF-8 byte order mark', () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(INVOICE_XML, 'utf8')]);
    const zip = buildZip([{ name: '1.xml', content: withBom }]);

    expect(extractInvoiceXml(zip)).toBe(INVOICE_XML);
  });

  it('ignores non-XML entries', () => {
    const zip = buildZip([
      { name: 'readme.txt', content: 'ignore me' },
      { name: '1.xml', content: INVOICE_XML },
    ]);

    expect(extractInvoiceXml(zip)).toBe(INVOICE_XML);
  });

  it('falls back to the signature when it is the only XML present', () => {
    const zip = buildZip([{ name: 'semnatura_1.xml', content: SIGNATURE_XML }]);

    expect(extractInvoiceXml(zip)).toBe(SIGNATURE_XML);
  });

  it('throws when the archive holds no XML', () => {
    const zip = buildZip([{ name: 'readme.txt', content: 'nothing here' }]);

    expect(() => extractInvoiceXml(zip)).toThrow(/No XML document found/);
  });
});
