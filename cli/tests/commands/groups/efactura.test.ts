import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { buildProgram } from '../../../src/commands/buildProgram';
import { makeOutputContext } from '../../../src/output';
import { CliError } from '../../../src/output/errors';
import {
  efacturaUpload,
  efacturaUploadB2C,
  efacturaStatus,
  efacturaDownload,
  efacturaMessages,
} from '../../../src/commands/groups/efactura';
import type { UploadArgs, StatusArgs, DownloadArgs, MessagesArgs } from '../../../src/services';

class Cap extends Writable {
  buf = '';
  bytes = Buffer.alloc(0);
  _write(c: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.buf += c.toString('utf8');
    this.bytes = Buffer.concat([this.bytes, c]);
    cb();
  }
}

class StubEfacturaService {
  uploadCalls: UploadArgs[] = [];
  statusCalls: StatusArgs[] = [];
  downloadCalls: DownloadArgs[] = [];
  messagesCalls: MessagesArgs[] = [];
  async upload(args: UploadArgs) {
    this.uploadCalls.push(args);
    return { indexIncarcare: 'u-1', dateResponse: '2026', executionStatus: '0' };
  }
  async getStatus(args: StatusArgs) {
    this.statusCalls.push(args);
    return { stare: 'ok', idDescarcare: 'd-1' };
  }
  async download(args: DownloadArgs) {
    this.downloadCalls.push(args);
    return Buffer.from('ZIPDATA');
  }
  async getMessages(args: MessagesArgs) {
    this.messagesCalls.push(args);
    return { mesaje: [{ id: 'm-1' }] } as never;
  }
}

const NO_SECRET = Symbol('no-secret');

function harness(envSecret: string | typeof NO_SECRET = 'fake-secret') {
  const stdout = new Cap();
  const stderr = new Cap();
  const text = makeOutputContext({ format: 'text', streams: { stdout, stderr } });
  const json = makeOutputContext({ format: 'json', streams: { stdout, stderr } });
  const efacturaService = new StubEfacturaService();
  const services = { efacturaService } as never;
  const prevEnv = process.env.ANAF_CLIENT_SECRET;
  if (envSecret === NO_SECRET) {
    delete process.env.ANAF_CLIENT_SECRET;
  } else {
    process.env.ANAF_CLIENT_SECRET = envSecret;
  }
  return {
    stdout,
    stderr,
    text,
    json,
    efacturaService,
    services,
    restore: () => {
      if (prevEnv === undefined) delete process.env.ANAF_CLIENT_SECRET;
      else process.env.ANAF_CLIENT_SECRET = prevEnv;
    },
  };
}

describe('efactura group', () => {
  it('registers all eight document operations', () => {
    const program = buildProgram({
      output: makeOutputContext({ format: 'text' }),
      services: {} as never,
    });
    const ef = program.commands.find((c) => c.name() === 'efactura')!;
    expect(ef.commands.map((c) => c.name()).sort()).toEqual([
      'download',
      'messages',
      'pdf',
      'status',
      'upload',
      'upload-b2c',
      'validate',
      'validate-signature',
    ]);
  });
});

describe('efacturaUpload', () => {
  it('reads XML from --xml and calls the service with secret from env', async () => {
    const h = harness();
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-efup-'));
      const xmlPath = path.join(tmp, 'inv.xml');
      fs.writeFileSync(xmlPath, '<?xml?><Invoice/>');
      await efacturaUpload({ output: h.text, services: h.services }, { xml: xmlPath });
      expect(h.efacturaService.uploadCalls).toHaveLength(1);
      expect(h.efacturaService.uploadCalls[0].xml).toBe('<?xml?><Invoice/>');
      expect(h.efacturaService.uploadCalls[0].clientSecret).toBe('fake-secret');
      expect(h.efacturaService.uploadCalls[0].isB2C).toBe(false);
      expect(h.stdout.buf).toContain('u-1');
      fs.rmSync(tmp, { recursive: true });
    } finally {
      h.restore();
    }
  });

  it('uploadB2C sets isB2C=true', async () => {
    const h = harness();
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-efup-'));
      const xmlPath = path.join(tmp, 'inv.xml');
      fs.writeFileSync(xmlPath, '<x/>');
      await efacturaUploadB2C({ output: h.text, services: h.services }, { xml: xmlPath });
      expect(h.efacturaService.uploadCalls[0].isB2C).toBe(true);
      fs.rmSync(tmp, { recursive: true });
    } finally {
      h.restore();
    }
  });

  it('throws BAD_USAGE when neither --xml nor --stdin is set', async () => {
    const h = harness();
    try {
      await expect(efacturaUpload({ output: h.text, services: h.services }, {})).rejects.toBeInstanceOf(CliError);
    } finally {
      h.restore();
    }
  });

  it('throws BAD_USAGE when both --xml and --stdin are set', async () => {
    const h = harness();
    try {
      await expect(
        efacturaUpload({ output: h.text, services: h.services }, { xml: '/tmp/x', stdin: true })
      ).rejects.toBeInstanceOf(CliError);
    } finally {
      h.restore();
    }
  });

  it('throws CLIENT_SECRET_MISSING when env and stdin-flag are absent', async () => {
    const h = harness(NO_SECRET);
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-efup-'));
      const xmlPath = path.join(tmp, 'inv.xml');
      fs.writeFileSync(xmlPath, '<x/>');
      let err: unknown;
      try {
        await efacturaUpload({ output: h.text, services: h.services }, { xml: xmlPath });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).code).toBe('CLIENT_SECRET_MISSING');
      fs.rmSync(tmp, { recursive: true });
    } finally {
      h.restore();
    }
  });

  it('passes upload options through', async () => {
    const h = harness();
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-efup-'));
      const xmlPath = path.join(tmp, 'inv.xml');
      fs.writeFileSync(xmlPath, '<x/>');
      await efacturaUpload(
        { output: h.text, services: h.services },
        { xml: xmlPath, standard: 'UBL', extern: true, autofactura: true, executare: true }
      );
      expect(h.efacturaService.uploadCalls[0].options).toEqual({
        standard: 'UBL',
        extern: true,
        autofactura: true,
        executare: true,
      });
      fs.rmSync(tmp, { recursive: true });
    } finally {
      h.restore();
    }
  });
});

describe('efacturaStatus', () => {
  it('calls the service with the uploadId', async () => {
    const h = harness();
    try {
      await efacturaStatus({ output: h.text, services: h.services }, { uploadId: 'u-1' });
      expect(h.efacturaService.statusCalls[0].uploadId).toBe('u-1');
      expect(h.stdout.buf).toContain('ok');
    } finally {
      h.restore();
    }
  });

  it('throws BAD_USAGE when --upload-id is missing', async () => {
    const h = harness();
    try {
      await expect(efacturaStatus({ output: h.text, services: h.services }, {})).rejects.toBeInstanceOf(CliError);
    } finally {
      h.restore();
    }
  });
});

describe('efacturaDownload', () => {
  it('writes bytes to --out and emits confirmation to stderr', async () => {
    const h = harness();
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-efdl-'));
      const outPath = path.join(tmp, 'result.zip');
      await efacturaDownload({ output: h.text, services: h.services }, { downloadId: 'd-1', out: outPath });
      expect(fs.readFileSync(outPath, 'utf8')).toBe('ZIPDATA');
      expect(h.stderr.buf).toContain(outPath);
      fs.rmSync(tmp, { recursive: true });
    } finally {
      h.restore();
    }
  });

  it('writes bytes to stdout when --out is absent', async () => {
    const h = harness();
    try {
      await efacturaDownload({ output: h.text, services: h.services }, { downloadId: 'd-1' });
      expect(h.stdout.bytes.toString('utf8')).toBe('ZIPDATA');
    } finally {
      h.restore();
    }
  });

  it('throws BAD_USAGE when --download-id is missing', async () => {
    const h = harness();
    try {
      await expect(efacturaDownload({ output: h.text, services: h.services }, {})).rejects.toBeInstanceOf(CliError);
    } finally {
      h.restore();
    }
  });
});

describe('efacturaMessages', () => {
  it('routes to simple listing when --days is set', async () => {
    const h = harness();
    try {
      await efacturaMessages({ output: h.text, services: h.services }, { days: '7', filter: 'E' });
      expect(h.efacturaService.messagesCalls[0]).toMatchObject({ days: 7, filter: 'E' });
    } finally {
      h.restore();
    }
  });

  it('routes to paginated when --start-time, --end-time, --page are set', async () => {
    const h = harness();
    try {
      await efacturaMessages(
        { output: h.text, services: h.services },
        { startTime: '1000', endTime: '2000', page: '1' }
      );
      expect(h.efacturaService.messagesCalls[0]).toMatchObject({
        startTime: 1000,
        endTime: 2000,
        page: 1,
      });
    } finally {
      h.restore();
    }
  });

  it('throws BAD_USAGE when --days is not numeric', async () => {
    const h = harness();
    try {
      await expect(efacturaMessages({ output: h.text, services: h.services }, { days: 'abc' })).rejects.toBeInstanceOf(
        CliError
      );
    } finally {
      h.restore();
    }
  });
});
