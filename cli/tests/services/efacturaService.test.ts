import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EfacturaService,
  type EfacturaClientFactory,
  type EfacturaToolsClientFactory,
  type TokenManagerFactory,
} from '../../src/services/efacturaService';
import { CompanyService, CredentialService, ConfigStore, TokenStore } from '../../src/state';
import { getXdgPaths } from '../../src/state/paths';
import { CliError } from '../../src/output/errors';
import type { LookupService } from '../../src/services/lookupService';
import type {
  AnafCompanyData,
  UploadResponse,
  StatusResponse,
  ListMessagesResponse,
  PaginatedListMessagesResponse,
  ValidationResult,
} from '@florinszilagyi/anaf-ts-sdk';

class FakeTokenManager {
  public refreshToken: string;
  public rotate = false;
  constructor(refreshToken: string) {
    this.refreshToken = refreshToken;
  }
  async getValidAccessToken(): Promise<string> {
    if (this.rotate) this.refreshToken = 'rt-rotated';
    return 'at-fake';
  }
  getRefreshToken(): string {
    return this.refreshToken;
  }
}

class FakeEfacturaClient {
  uploadDocument = jest.fn(
    async (): Promise<UploadResponse> => ({
      indexIncarcare: 'upload-1',
      dateResponse: '2026-04-11T18:00:00Z',
      executionStatus: '0',
    })
  );
  uploadB2CDocument = jest.fn(
    async (): Promise<UploadResponse> => ({
      indexIncarcare: 'upload-b2c-1',
      dateResponse: '2026-04-11T18:00:00Z',
      executionStatus: '0',
    })
  );
  getUploadStatus = jest.fn(
    async (): Promise<StatusResponse> => ({
      stare: 'ok',
      idDescarcare: 'download-1',
    })
  );
  downloadDocument = jest.fn(async (): Promise<string> => Buffer.from('fake-zip').toString('base64'));
  getMessages = jest.fn(async (): Promise<ListMessagesResponse> => ({ mesaje: [] }) as unknown as ListMessagesResponse);
  getMessagesPaginated = jest.fn(
    async (): Promise<PaginatedListMessagesResponse> => ({ mesaje: [] }) as unknown as PaginatedListMessagesResponse
  );
}

class FakeToolsClient {
  validateXml = jest.fn(async (): Promise<ValidationResult> => ({ valid: true, details: 'ok' }));
  validateSignature = jest.fn(async (): Promise<ValidationResult> => ({ valid: true, details: 'ok' }));
  convertXmlToPdf = jest.fn(async (): Promise<Buffer> => Buffer.from('%PDF-1.4'));
  convertXmlToPdfNoValidation = jest.fn(async (): Promise<Buffer> => Buffer.from('%PDF-1.4-noval'));
}

interface Harness {
  dir: string;
  companyService: CompanyService;
  credentialService: CredentialService;
  configStore: ConfigStore;
  tokenStore: TokenStore;
  service: EfacturaService;
  fakeClient: FakeEfacturaClient;
  fakeTools: FakeToolsClient;
  getLastTokenManager: () => FakeTokenManager | undefined;
}

function harness(overrides?: {
  tokenRotate?: boolean;
  tokenManagerFactory?: TokenManagerFactory;
  clientFactory?: EfacturaClientFactory;
  toolsFactory?: EfacturaToolsClientFactory;
}): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-efactura-'));
  const paths = getXdgPaths({
    configHome: path.join(dir, 'config'),
    dataHome: path.join(dir, 'data'),
    cacheHome: path.join(dir, 'cache'),
  });
  const companyService = new CompanyService({ paths });
  const credentialService = new CredentialService({ paths });
  const configStore = new ConfigStore({ paths });
  const tokenStore = new TokenStore({ paths });

  const fakeClient = new FakeEfacturaClient();
  const fakeTools = new FakeToolsClient();

  let lastTokenManager: FakeTokenManager | undefined;
  const defaultTokenManagerFactory: TokenManagerFactory = ({ refreshToken }) => {
    const tm = new FakeTokenManager(refreshToken);
    if (overrides?.tokenRotate) {
      tm.rotate = true;
      void tm.getValidAccessToken();
    }
    lastTokenManager = tm;
    return tm;
  };
  const tokenManagerFactory = overrides?.tokenManagerFactory ?? defaultTokenManagerFactory;

  const clientFactory: EfacturaClientFactory = overrides?.clientFactory ?? (() => fakeClient as unknown as never);
  const toolsFactory: EfacturaToolsClientFactory = overrides?.toolsFactory ?? (() => fakeTools as unknown as never);

  const service = new EfacturaService({
    companyService,
    credentialService,
    configStore,
    tokenStore,
    tokenManagerFactory,
    clientFactory,
    toolsFactory,
  });

  return {
    dir,
    companyService,
    credentialService,
    configStore,
    tokenStore,
    service,
    fakeClient,
    fakeTools,
    getLastTokenManager: () => lastTokenManager,
  };
}

const sampleCred = () => ({
  clientId: 'cid',
  redirectUri: 'https://localhost:9002/cb',
});

/** Set up the harness with a credential, active company, and token */
function setupState(h: Harness, opts?: { cui?: string; env?: 'test' | 'prod' }): void {
  const cui = opts?.cui ?? '12345678';
  h.credentialService.set(sampleCred());
  h.companyService.add({ cui, name: 'Acme SRL' });
  h.configStore.setActiveCui(cui);
  if (opts?.env) h.configStore.setEnv(opts.env);
  h.tokenStore.write('_default', { refreshToken: 'rt-original' });
}

describe('EfacturaService.upload', () => {
  it('uploads via EfacturaClient and returns the SDK response', async () => {
    const h = harness();
    setupState(h);

    const result = await h.service.upload({
      xml: '<xml/>',
      clientSecret: 'secret-1',
    });

    expect(result.indexIncarcare).toBe('upload-1');
    expect(h.fakeClient.uploadDocument).toHaveBeenCalledTimes(1);
    expect(h.fakeClient.uploadDocument).toHaveBeenCalledWith('<xml/>', undefined);
  });

  it('calls uploadB2CDocument when isB2C is true', async () => {
    const h = harness();
    setupState(h);

    const result = await h.service.upload({
      xml: '<xml/>',
      clientSecret: 'secret-1',
      isB2C: true,
    });

    expect(result.indexIncarcare).toBe('upload-b2c-1');
    expect(h.fakeClient.uploadB2CDocument).toHaveBeenCalledTimes(1);
    expect(h.fakeClient.uploadDocument).not.toHaveBeenCalled();
  });

  it('persists rotated refresh token after a successful call', async () => {
    const h = harness({ tokenRotate: true });
    setupState(h);

    await h.service.upload({ xml: '<xml/>', clientSecret: 'secret-1' });
    expect(h.tokenStore.read('_default')?.refreshToken).toBe('rt-rotated');
  });

  it('persists rotated refresh token even when the operation fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-efactura-'));
    const paths = getXdgPaths({
      configHome: path.join(dir, 'config'),
      dataHome: path.join(dir, 'data'),
      cacheHome: path.join(dir, 'cache'),
    });
    const companyService = new CompanyService({ paths });
    const credentialService = new CredentialService({ paths });
    const configStore = new ConfigStore({ paths });
    const tokenStore = new TokenStore({ paths });

    credentialService.set(sampleCred());
    companyService.add({ cui: '12345678', name: 'Acme SRL' });
    configStore.setActiveCui('12345678');
    tokenStore.write('_default', { refreshToken: 'rt-original' });

    const fakeClient = new FakeEfacturaClient();
    fakeClient.uploadDocument.mockImplementationOnce(async () => {
      throw new Error('upload boom');
    });

    const service = new EfacturaService({
      companyService,
      credentialService,
      configStore,
      tokenStore,
      tokenManagerFactory: ({ refreshToken }) => {
        const tm = new FakeTokenManager(refreshToken);
        tm.rotate = true;
        void tm.getValidAccessToken();
        return tm;
      },
      clientFactory: () => fakeClient as unknown as never,
      toolsFactory: () => new FakeToolsClient() as unknown as never,
    });

    await expect(service.upload({ xml: '<xml/>', clientSecret: 'secret-1' })).rejects.toBeInstanceOf(CliError);
    expect(tokenStore.read('_default')?.refreshToken).toBe('rt-rotated');
  });

  it('uses cached access token directly when it is fresh (no tokenManagerFactory call)', async () => {
    let factoryCalled = false;
    const h = harness({
      tokenManagerFactory: (args) => {
        factoryCalled = true;
        return { async getValidAccessToken() { return 'at-from-factory'; }, getRefreshToken() { return args.refreshToken; } };
      },
    });
    setupState(h);
    // Write a token record with a valid access token well within the 1-day threshold
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days from now
    h.tokenStore.write('_default', {
      refreshToken: 'rt-stable',
      accessToken: 'at-cached',
      expiresAt: farFuture,
      obtainedAt: new Date().toISOString(),
    });

    await h.service.upload({ xml: '<xml/>', clientSecret: 's' });
    expect(factoryCalled).toBe(false);
  });

  it('falls through to tokenManagerFactory when access token is expiring within 1 day', async () => {
    let factoryCalled = false;
    const h = harness({
      tokenManagerFactory: (args) => {
        factoryCalled = true;
        return { async getValidAccessToken() { return 'at-fresh'; }, getRefreshToken() { return args.refreshToken; } };
      },
    });
    setupState(h);
    // Write a token that expires in 12 hours (within the 1-day window)
    const almostExpired = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    h.tokenStore.write('_default', {
      refreshToken: 'rt-stable',
      accessToken: 'at-expiring',
      expiresAt: almostExpired,
      obtainedAt: new Date().toISOString(),
    });

    await h.service.upload({ xml: '<xml/>', clientSecret: 's' });
    expect(factoryCalled).toBe(true);
  });

  it('does not write when the refresh token did not rotate', async () => {
    const h = harness();
    setupState(h);
    // Overwrite with a known stable token
    h.tokenStore.write('_default', { refreshToken: 'rt-stable' });

    await h.service.upload({ xml: '<xml/>', clientSecret: 's' });
    expect(h.tokenStore.read('_default')?.refreshToken).toBe('rt-stable');
  });

  it('throws CliError(auth, NO_REFRESH_TOKEN) when no token is persisted', async () => {
    const h = harness();
    h.credentialService.set(sampleCred());
    h.companyService.add({ cui: '12345678', name: 'Acme SRL' });
    h.configStore.setActiveCui('12345678');
    // Do NOT write a token
    let err: unknown;
    try {
      await h.service.upload({ xml: '<xml/>', clientSecret: 's' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).category).toBe('auth');
    expect((err as CliError).code).toBe('NO_REFRESH_TOKEN');
  });

  it('wraps SDK upload failure as UPLOAD_FAILED', async () => {
    const h = harness();
    setupState(h);
    h.fakeClient.uploadDocument.mockRejectedValueOnce(new Error('network boom'));
    let err: unknown;
    try {
      await h.service.upload({ xml: '<xml/>', clientSecret: 's' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).category).toBe('anaf_api');
    expect((err as CliError).code).toBe('UPLOAD_FAILED');
  });

  it('forwards UploadOptions to the SDK', async () => {
    const h = harness();
    setupState(h);
    await h.service.upload({
      xml: '<xml/>',
      clientSecret: 's',
      options: { extern: true },
    });
    expect(h.fakeClient.uploadDocument).toHaveBeenCalledWith('<xml/>', { extern: true });
  });

  it('passes numeric CUI as vatNumber (strips RO prefix)', async () => {
    const h = harness({
      clientFactory: (args) => {
        expect(args.vatNumber).toBe('12345678');
        return new FakeEfacturaClient() as unknown as never;
      },
    });
    setupState(h, { cui: '12345678' });
    await h.service.upload({ xml: '<xml/>', clientSecret: 's' });
  });

  it('strips RO prefix from CUI before passing as vatNumber', async () => {
    const h = harness({
      clientFactory: (args) => {
        expect(args.vatNumber).toBe('12345678');
        return new FakeEfacturaClient() as unknown as never;
      },
    });
    h.credentialService.set(sampleCred());
    h.companyService.add({ cui: 'RO12345678', name: 'Acme SRL' });
    h.configStore.setActiveCui('RO12345678');
    h.tokenStore.write('_default', { refreshToken: 'rt' });
    await h.service.upload({ xml: '<xml/>', clientSecret: 's' });
  });

  it('derives testMode=true from env=test', async () => {
    const h = harness({
      clientFactory: (args) => {
        expect(args.testMode).toBe(true);
        return new FakeEfacturaClient() as unknown as never;
      },
    });
    setupState(h, { env: 'test' });
    await h.service.upload({ xml: '<xml/>', clientSecret: 's' });
  });

  it('derives testMode=false from env=prod', async () => {
    const h = harness({
      clientFactory: (args) => {
        expect(args.testMode).toBe(false);
        return new FakeEfacturaClient() as unknown as never;
      },
    });
    setupState(h, { env: 'prod' });
    await h.service.upload({ xml: '<xml/>', clientSecret: 's' });
  });
});

describe('EfacturaService.getStatus', () => {
  it('returns the SDK status and calls the SDK with the uploadId', async () => {
    const h = harness();
    setupState(h);
    const result = await h.service.getStatus({ uploadId: 'upload-1', clientSecret: 's' });
    expect(result.stare).toBe('ok');
    expect(h.fakeClient.getUploadStatus).toHaveBeenCalledWith('upload-1');
  });

  it('wraps SDK status failure as STATUS_FAILED', async () => {
    const h = harness();
    setupState(h);
    h.fakeClient.getUploadStatus.mockRejectedValueOnce(new Error('boom'));
    let err: unknown;
    try {
      await h.service.getStatus({ uploadId: 'upload-1', clientSecret: 's' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('STATUS_FAILED');
    expect((err as CliError).category).toBe('anaf_api');
  });
});

describe('EfacturaService.download', () => {
  it('decodes the base64 payload to a Buffer', async () => {
    const h = harness();
    setupState(h);
    const buf = await h.service.download({ downloadId: 'download-1', clientSecret: 's' });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf8')).toBe('fake-zip');
  });

  it('wraps SDK download failure as DOWNLOAD_FAILED', async () => {
    const h = harness();
    setupState(h);
    h.fakeClient.downloadDocument.mockRejectedValueOnce(new Error('boom'));
    let err: unknown;
    try {
      await h.service.download({ downloadId: 'download-1', clientSecret: 's' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('DOWNLOAD_FAILED');
  });
});

describe('EfacturaService.getMessages', () => {
  it('routes to simple listing when days is set', async () => {
    const h = harness();
    setupState(h);
    await h.service.getMessages({ days: 7, clientSecret: 's' });
    expect(h.fakeClient.getMessages).toHaveBeenCalledWith({ zile: 7, filtru: undefined });
    expect(h.fakeClient.getMessagesPaginated).not.toHaveBeenCalled();
  });

  it('routes to paginated when start/end/page are set', async () => {
    const h = harness();
    setupState(h);
    await h.service.getMessages({
      startTime: 1000,
      endTime: 2000,
      page: 1,
      clientSecret: 's',
    });
    expect(h.fakeClient.getMessagesPaginated).toHaveBeenCalledWith({
      startTime: 1000,
      endTime: 2000,
      pagina: 1,
      filtru: undefined,
    });
    expect(h.fakeClient.getMessages).not.toHaveBeenCalled();
  });

  it('throws BAD_USAGE when neither pattern is satisfied', async () => {
    const h = harness();
    setupState(h);
    let err: unknown;
    try {
      await h.service.getMessages({ clientSecret: 's' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).category).toBe('user_input');
    expect((err as CliError).code).toBe('BAD_USAGE');
  });

  it('throws BAD_USAGE on partial pagination inputs', async () => {
    const h = harness();
    setupState(h);
    let err: unknown;
    try {
      await h.service.getMessages({ startTime: 1, endTime: 2, clientSecret: 's' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('BAD_USAGE');
  });

  it('wraps SDK messages failure as MESSAGES_FAILED', async () => {
    const h = harness();
    setupState(h);
    h.fakeClient.getMessages.mockRejectedValueOnce(new Error('boom'));
    let err: unknown;
    try {
      await h.service.getMessages({ days: 7, clientSecret: 's' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('MESSAGES_FAILED');
  });
});

describe('EfacturaService tools', () => {
  function toolsHarness(): Harness {
    const h = harness();
    setupState(h);
    return h;
  }

  it('validateXml delegates to the tools client with default FACT1', async () => {
    const h = toolsHarness();
    const r = await h.service.validateXml({ xml: '<x/>', clientSecret: 's' });
    expect(r.valid).toBe(true);
    expect(h.fakeTools.validateXml).toHaveBeenCalledWith('<x/>', 'FACT1');
  });

  it('validateXml forwards custom standard', async () => {
    const h = toolsHarness();
    await h.service.validateXml({ xml: '<x/>', standard: 'FCN', clientSecret: 's' });
    expect(h.fakeTools.validateXml).toHaveBeenCalledWith('<x/>', 'FCN');
  });

  it('validateSignature delegates with all params', async () => {
    const h = toolsHarness();
    const xmlBuf = Buffer.from('<x/>');
    const sigBuf = Buffer.from('<sig/>');
    await h.service.validateSignature({
      xml: xmlBuf,
      signature: sigBuf,
      xmlFilename: 'i.xml',
      signatureFilename: 's.xml',
      clientSecret: 's',
    });
    expect(h.fakeTools.validateSignature).toHaveBeenCalledWith(xmlBuf, sigBuf, 'i.xml', 's.xml');
  });

  it('convertToPdf routes to convertXmlToPdf by default', async () => {
    const h = toolsHarness();
    await h.service.convertToPdf({ xml: '<x/>', clientSecret: 's' });
    expect(h.fakeTools.convertXmlToPdf).toHaveBeenCalledWith('<x/>', 'FACT1');
    expect(h.fakeTools.convertXmlToPdfNoValidation).not.toHaveBeenCalled();
  });

  it('convertToPdf routes to convertXmlToPdfNoValidation when noValidation=true', async () => {
    const h = toolsHarness();
    await h.service.convertToPdf({ xml: '<x/>', noValidation: true, clientSecret: 's' });
    expect(h.fakeTools.convertXmlToPdfNoValidation).toHaveBeenCalledWith('<x/>', 'FACT1');
    expect(h.fakeTools.convertXmlToPdf).not.toHaveBeenCalled();
  });

  it('wraps tools validation failures as VALIDATION_FAILED', async () => {
    const h = toolsHarness();
    h.fakeTools.validateXml.mockRejectedValueOnce(new Error('boom'));
    let err: unknown;
    try {
      await h.service.validateXml({ xml: '<x/>', clientSecret: 's' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('VALIDATION_FAILED');
    expect((err as CliError).category).toBe('anaf_api');
  });

  it('wraps signature validation failure as SIGNATURE_VALIDATION_FAILED', async () => {
    const h = toolsHarness();
    h.fakeTools.validateSignature.mockRejectedValueOnce(new Error('boom'));
    let err: unknown;
    try {
      await h.service.validateSignature({
        xml: Buffer.from('<x/>'),
        signature: Buffer.from('<sig/>'),
        clientSecret: 's',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('SIGNATURE_VALIDATION_FAILED');
  });

  it('wraps PDF conversion failure as PDF_CONVERSION_FAILED', async () => {
    const h = toolsHarness();
    h.fakeTools.convertXmlToPdf.mockRejectedValueOnce(new Error('boom'));
    let err: unknown;
    try {
      await h.service.convertToPdf({ xml: '<x/>', clientSecret: 's' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('PDF_CONVERSION_FAILED');
  });
});

describe('EfacturaService message enrichment', () => {
  function enrichHarness() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-enrich-'));
    const paths = getXdgPaths({
      configHome: path.join(dir, 'config'),
      dataHome: path.join(dir, 'data'),
      cacheHome: path.join(dir, 'cache'),
    });
    const companyService = new CompanyService({ paths });
    const credentialService = new CredentialService({ paths });
    const configStore = new ConfigStore({ paths });
    const tokenStore = new TokenStore({ paths });

    const fakeClient = new FakeEfacturaClient();

    const fakeLookup = {
      batchGetCompanies: jest.fn(async (cuis: readonly string[]): Promise<AnafCompanyData[]> =>
        cuis.map((cui) => ({
          vatCode: cui,
          name: `Company-${cui}`,
          registrationNumber: '',
          address: '',
          postalCode: null,
          contactPhone: '',
          scpTva: false,
        }))
      ),
    } as unknown as LookupService;

    const service = new EfacturaService({
      companyService,
      credentialService,
      configStore,
      tokenStore,
      lookupService: fakeLookup,
      tokenManagerFactory: ({ refreshToken }) => new FakeTokenManager(refreshToken),
      clientFactory: () => fakeClient as unknown as never,
      toolsFactory: () => new FakeToolsClient() as unknown as never,
    });

    // Set up minimal state
    credentialService.set({ clientId: 'cid', redirectUri: 'https://localhost:9002/cb' });
    companyService.add({ cui: '111', name: 'Test' });
    configStore.setActiveCui('111');
    configStore.setEnv('test');
    tokenStore.write('_default', {
      accessToken: 'at',
      refreshToken: 'rt',
      obtainedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 999_999_999).toISOString(),
    });

    return { service, fakeClient, fakeLookup };
  }

  it('resolves both emitentName and beneficiarName', async () => {
    const { service, fakeClient, fakeLookup } = enrichHarness();
    fakeClient.getMessages.mockResolvedValueOnce({
      mesaje: [
        { id: '1', tip: 'FACTURA TRIMISA', data_creare: '202604131822', detalii: '',
          cif_emitent: '111', cif_beneficiar: '222' },
      ],
    } as unknown as ListMessagesResponse);

    const result = await service.getMessages({ days: 7, clientSecret: 's' });
    const msgs = (result as ListMessagesResponse).mesaje!;
    expect(msgs[0].emitentName).toBe('Company-111');
    expect(msgs[0].beneficiarName).toBe('Company-222');
    // Both CUIs resolved in a single batch call
    expect(fakeLookup.batchGetCompanies).toHaveBeenCalledWith(['111', '222']);
  });

  it('deduplicates CUIs across messages', async () => {
    const { service, fakeClient, fakeLookup } = enrichHarness();
    fakeClient.getMessages.mockResolvedValueOnce({
      mesaje: [
        { id: '1', tip: 'FACTURA TRIMISA', data_creare: '202604131822', detalii: '',
          cif_emitent: '111', cif_beneficiar: '222' },
        { id: '2', tip: 'FACTURA PRIMITA', data_creare: '202604131822', detalii: '',
          cif_emitent: '222', cif_beneficiar: '111' },
      ],
    } as unknown as ListMessagesResponse);

    await service.getMessages({ days: 7, clientSecret: 's' });
    const calledWith = (fakeLookup.batchGetCompanies as jest.Mock).mock.calls[0][0] as string[];
    expect(calledWith.sort()).toEqual(['111', '222']);
  });

  it('gracefully degrades when lookup fails', async () => {
    const { service, fakeClient, fakeLookup } = enrichHarness();
    (fakeLookup.batchGetCompanies as jest.Mock).mockRejectedValueOnce(new Error('network'));
    fakeClient.getMessages.mockResolvedValueOnce({
      mesaje: [
        { id: '1', tip: 'FACTURA TRIMISA', data_creare: '202604131822', detalii: '',
          cif_emitent: '111', cif_beneficiar: '222' },
      ],
    } as unknown as ListMessagesResponse);

    const result = await service.getMessages({ days: 7, clientSecret: 's' });
    const msgs = (result as ListMessagesResponse).mesaje!;
    // Returns un-enriched messages — no crash
    expect(msgs[0].emitentName).toBeUndefined();
    expect(msgs[0].beneficiarName).toBeUndefined();
  });
});
