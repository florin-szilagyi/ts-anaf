import { deflateRawSync, crc32 } from 'node:zlib';

/** One file to place in a test archive. */
export interface ZipInput {
  name: string;
  content: string | Buffer;
  /** 0 = stored, 8 = deflate. Defaults to deflate. */
  method?: 0 | 8;
  /** General purpose bit flag, e.g. 0x0001 to mark the entry encrypted. */
  flags?: number;
}

/** Options for the archive as a whole. */
export interface ZipOptions {
  /** Trailing archive comment, recorded in the EOCD comment length. */
  comment?: string;
}

/**
 * Minimal ZIP writer for tests — produces archives shaped like the ones ANAF
 * returns, so the reader can be exercised without checking binary fixtures
 * into git.
 */
export function buildZip(files: ZipInput[], options: ZipOptions = {}): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const method = file.method ?? 8;
    const flags = file.flags ?? 0;
    const nameBytes = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const compressed = method === 0 ? raw : deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localChunks.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }

  const localBuf = Buffer.concat(localChunks);
  const centralBuf = Buffer.concat(centralChunks);

  const comment = Buffer.from(options.comment ?? '', 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir disk
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(comment.length, 20);

  return Buffer.concat([localBuf, centralBuf, eocd, comment]);
}
