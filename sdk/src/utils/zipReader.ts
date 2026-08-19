import { inflateRawSync } from 'node:zlib';
import { AnafValidationError } from '../errors';

/** A single decompressed file entry from a ZIP archive. */
export interface ZipEntry {
  /** Entry path as stored in the archive. */
  name: string;
  /** Decompressed bytes. */
  data: Buffer;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/**
 * Ceiling on a single decompressed entry. e-Factura invoices are a few KB;
 * this only exists so a malformed or hostile archive cannot make us allocate
 * unbounded memory before the size check runs.
 */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/** General purpose bit 0: the entry is encrypted. */
const FLAG_ENCRYPTED = 0x0001;

/** Value a 32-bit ZIP field carries when the real value lives in a ZIP64 record. */
const ZIP64_MARKER_32 = 0xffffffff;
/** Value a 16-bit ZIP field carries when the real value lives in a ZIP64 record. */
const ZIP64_MARKER_16 = 0xffff;

/**
 * Locate the End of Central Directory record by scanning backwards from the
 * end of the buffer (the record is last, but may be followed by a comment).
 *
 * The signature alone is not enough: those four bytes can occur inside an
 * archive comment. A match only counts when its declared comment length
 * accounts for exactly the remaining bytes.
 */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + EOCD_MIN_SIZE + commentLength === buffer.length) {
      return offset;
    }
  }
  return -1;
}

/**
 * Read all file entries from an in-memory ZIP archive.
 *
 * Supports the two compression methods ANAF uses (stored and deflate). No
 * external dependency — the central directory is parsed directly and deflate
 * streams are inflated with `node:zlib`.
 *
 * @param buffer - Raw ZIP archive bytes
 * @returns Every file entry in the archive, directories excluded
 * @throws {AnafValidationError} If the archive is malformed or uses an
 *   unsupported compression method
 */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  if (!buffer || buffer.length < EOCD_MIN_SIZE) {
    throw new AnafValidationError('Invalid ZIP archive: too small');
  }

  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) {
    throw new AnafValidationError('Invalid ZIP archive: end of central directory not found');
  }

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralDirSize = buffer.readUInt32LE(eocd + 12);
  const centralDirOffset = buffer.readUInt32LE(eocd + 16);
  if (centralDirOffset === ZIP64_MARKER_32 || centralDirSize === ZIP64_MARKER_32 || entryCount === ZIP64_MARKER_16) {
    throw new AnafValidationError('Unsupported ZIP archive: ZIP64 format');
  }

  // Entries must live inside the directory the EOCD declares, not merely
  // inside the buffer — otherwise a record could run on into the EOCD itself.
  const centralDirEnd = centralDirOffset + centralDirSize;
  if (centralDirOffset > eocd || centralDirEnd > eocd) {
    throw new AnafValidationError('Invalid ZIP archive: corrupt central directory');
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) {
      throw new AnafValidationError('Invalid ZIP archive: corrupt central directory');
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    // subarray() clamps instead of throwing, so an oversized length field would
    // otherwise yield a silently truncated name rather than a parse failure.
    const headerEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (headerEnd > centralDirEnd) {
      throw new AnafValidationError('Invalid ZIP archive: corrupt central directory');
    }

    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset = headerEnd;

    // Directory entries carry no payload.
    if (name.endsWith('/')) {
      continue;
    }

    if ((flags & FLAG_ENCRYPTED) !== 0) {
      throw new AnafValidationError(`Unsupported ZIP archive: "${name}" is encrypted`);
    }

    if (compressedSize === ZIP64_MARKER_32 || uncompressedSize === ZIP64_MARKER_32) {
      throw new AnafValidationError('Unsupported ZIP archive: ZIP64 format');
    }

    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== LOCAL_HEADER_SIGNATURE) {
      throw new AnafValidationError(`Invalid ZIP archive: corrupt local header for "${name}"`);
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buffer.length) {
      throw new AnafValidationError(`Invalid ZIP archive: truncated data for "${name}"`);
    }

    const raw = buffer.subarray(dataStart, dataEnd);
    let data: Buffer;

    if (compressionMethod === METHOD_STORED) {
      data = Buffer.from(raw);
    } else if (compressionMethod === METHOD_DEFLATE) {
      if (uncompressedSize > MAX_ENTRY_BYTES) {
        throw new AnafValidationError(`ZIP entry "${name}" exceeds the ${MAX_ENTRY_BYTES}-byte limit`);
      }
      try {
        // The declared size can lie, so cap the inflate itself as well.
        data = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new AnafValidationError(
          isOutputTooLarge(cause)
            ? `ZIP entry "${name}" exceeds the ${MAX_ENTRY_BYTES}-byte limit`
            : `Invalid ZIP archive: failed to inflate "${name}" (${message})`
        );
      }
    } else {
      throw new AnafValidationError(
        `Unsupported ZIP compression method ${compressionMethod} for "${name}" (expected stored or deflate)`
      );
    }

    if (uncompressedSize !== 0 && data.length !== uncompressedSize) {
      throw new AnafValidationError(`Invalid ZIP archive: size mismatch for "${name}"`);
    }

    entries.push({ name, data });
  }

  if (offset !== centralDirEnd) {
    throw new AnafValidationError('Invalid ZIP archive: corrupt central directory');
  }

  return entries;
}

/** True when zlib refused to inflate because the output hit `maxOutputLength`. */
function isOutputTooLarge(cause: unknown): boolean {
  return (cause as { code?: string } | undefined)?.code === 'ERR_BUFFER_TOO_LARGE';
}

/** Root elements of the documents e-Factura archives carry. */
const INVOICE_ROOT_ELEMENTS = ['Invoice', 'CreditNote'];

/**
 * Extract the invoice XML from an e-Factura download archive.
 *
 * ANAF returns a ZIP containing the invoice XML plus a detached signature
 * (`semnatura_*.xml`), and can add further documents alongside them. Selection
 * is therefore by content — the entry whose root element is `Invoice` or
 * `CreditNote` wins — falling back to the first non-signature XML when no
 * entry declares a recognised root. The result is decoded as UTF-8 with any
 * byte order mark stripped.
 *
 * @param zipBuffer - The archive returned by `EfacturaClient.downloadDocument`
 * @returns The invoice XML document
 * @throws {AnafValidationError} If the archive holds no invoice XML
 */
export function extractInvoiceXml(zipBuffer: Buffer): string {
  const entries = readZipEntries(zipBuffer);
  const xmlEntries = entries.filter((e) => e.name.toLowerCase().endsWith('.xml'));

  if (xmlEntries.length === 0) {
    throw new AnafValidationError(
      `No XML document found in the downloaded archive (entries: ${entries.map((e) => e.name).join(', ') || 'none'})`
    );
  }

  const candidates = xmlEntries.map((entry) => ({ entry, text: decodeXml(entry.data) }));
  const byRootElement = candidates.find((c) => INVOICE_ROOT_ELEMENTS.includes(rootElementName(c.text)));
  if (byRootElement) {
    return byRootElement.text;
  }

  const nonSignature = candidates.find((c) => !basename(c.entry.name).toLowerCase().startsWith('semnatura'));
  return (nonSignature ?? candidates[0]).text;
}

function decodeXml(data: Buffer): string {
  return data.toString('utf8').replace(/^\uFEFF/, '');
}

/**
 * Read the local name of a document's root element, ignoring any namespace
 * prefix, XML declaration, comments and processing instructions.
 */
function rootElementName(xml: string): string {
  const match = /<(?!\?|!)([^\s/>]+)/.exec(stripXmlComments(xml));
  if (!match) return '';
  const [, tag] = match;
  const colon = tag.lastIndexOf(':');
  return colon === -1 ? tag : tag.slice(colon + 1);
}

function stripXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function basename(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash === -1 ? name : name.slice(slash + 1);
}
