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
 * Locate the End of Central Directory record by scanning backwards from the
 * end of the buffer (the record is last, but may be followed by a comment).
 */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
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
  const centralDirOffset = buffer.readUInt32LE(eocd + 16);
  if (centralDirOffset === 0xffffffff) {
    throw new AnafValidationError('Unsupported ZIP archive: ZIP64 format');
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) {
      throw new AnafValidationError('Invalid ZIP archive: corrupt central directory');
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    offset += 46 + nameLength + extraLength + commentLength;

    // Directory entries carry no payload.
    if (name.endsWith('/')) {
      continue;
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
      try {
        data = inflateRawSync(raw);
      } catch (cause) {
        throw new AnafValidationError(
          `Invalid ZIP archive: failed to inflate "${name}" (${cause instanceof Error ? cause.message : String(cause)})`
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

  return entries;
}

/**
 * Extract the invoice XML from an e-Factura download archive.
 *
 * ANAF returns a ZIP containing the invoice XML plus a detached signature
 * (`semnatura_*.xml`). This picks the invoice document and returns it as a
 * UTF-8 string with any byte order mark stripped.
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

  const invoice = xmlEntries.find((e) => !basename(e.name).toLowerCase().startsWith('semnatura')) ?? xmlEntries[0];

  return invoice.data.toString('utf8').replace(/^\uFEFF/, '');
}

function basename(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash === -1 ? name : name.slice(slash + 1);
}
