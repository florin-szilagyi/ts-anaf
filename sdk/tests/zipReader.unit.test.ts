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

  it('reads an archive carrying a trailing comment', () => {
    const zip = buildZip([{ name: '1.xml', content: INVOICE_XML }], { comment: 'produced by ANAF' });

    expect(readZipEntries(zip)[0].data.toString('utf8')).toBe(INVOICE_XML);
  });

  it('ignores an EOCD signature that occurs inside the archive comment', () => {
    // Those four bytes are legal comment content; only the record whose
    // comment length accounts for the remaining bytes is the real EOCD.
    const zip = buildZip([{ name: '1.xml', content: INVOICE_XML }], { comment: 'note: PK\u0005\u0006 appears here' });

    expect(readZipEntries(zip)[0].data.toString('utf8')).toBe(INVOICE_XML);
  });

  it('rejects an encrypted entry rather than returning ciphertext', () => {
    const zip = buildZip([{ name: '1.xml', content: INVOICE_XML, flags: 0x0001 }]);

    expect(() => readZipEntries(zip)).toThrow(/encrypted/);
  });

  it('rejects a ZIP64 archive with a clear message', () => {
    const zip = buildZip([{ name: '1.xml', content: INVOICE_XML }]);
    const eocd = zip.length - 22;
    zip.writeUInt32LE(0xffffffff, eocd + 16); // central directory offset escape

    expect(() => readZipEntries(zip)).toThrow(/ZIP64/);
  });

  it('rejects a ZIP64 archive flagged by its entry count', () => {
    const zip = buildZip([{ name: '1.xml', content: INVOICE_XML }]);
    const eocd = zip.length - 22;
    zip.writeUInt16LE(0xffff, eocd + 10);

    expect(() => readZipEntries(zip)).toThrow(/ZIP64/);
  });

  it('rejects a central directory whose name length overruns the buffer', () => {
    const zip = buildZip([{ name: '4013735587.xml', content: INVOICE_XML }]);
    const eocd = zip.length - 22;
    const centralDirOffset = zip.readUInt32LE(eocd + 16);
    zip.writeUInt16LE(60000, centralDirOffset + 28); // name length

    expect(() => readZipEntries(zip)).toThrow(/corrupt central directory/);
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

  it('picks the invoice by root element, not by position', () => {
    // A third XML sorted ahead of the invoice must not win on order alone.
    const zip = buildZip([
      { name: '0-errors.xml', content: '<?xml version="1.0"?><Errors><Error>nope</Error></Errors>' },
      { name: '1-invoice.xml', content: INVOICE_XML },
      { name: 'semnatura_1.xml', content: SIGNATURE_XML },
    ]);

    expect(extractInvoiceXml(zip)).toBe(INVOICE_XML);
  });

  it('picks a credit note by root element', () => {
    const creditNote = '<?xml version="1.0"?><CreditNote><ID>CN-1</ID></CreditNote>';
    const zip = buildZip([
      { name: 'attachment.xml', content: '<?xml version="1.0"?><Anexa/>' },
      { name: '2.xml', content: creditNote },
    ]);

    expect(extractInvoiceXml(zip)).toBe(creditNote);
  });

  it('matches a namespace-prefixed root element', () => {
    const prefixed = '<?xml version="1.0"?><!-- ANAF --><ubl:Invoice xmlns:ubl="urn:oasis"><ID>1</ID></ubl:Invoice>';
    const zip = buildZip([
      { name: '0-other.xml', content: '<?xml version="1.0"?><Other/>' },
      { name: '1.xml', content: prefixed },
    ]);

    expect(extractInvoiceXml(zip)).toBe(prefixed);
  });

  it('falls back to the first non-signature XML when no root element matches', () => {
    const other = '<?xml version="1.0"?><Other>payload</Other>';
    const zip = buildZip([
      { name: 'semnatura_1.xml', content: SIGNATURE_XML },
      { name: '1.xml', content: other },
    ]);

    expect(extractInvoiceXml(zip)).toBe(other);
  });

  it('throws when the archive holds no XML', () => {
    const zip = buildZip([{ name: 'readme.txt', content: 'nothing here' }]);

    expect(() => extractInvoiceXml(zip)).toThrow(/No XML document found/);
  });
});
