import { enrichMessagesWithCompanyData } from '../../src/utils/messageEnricher';
import { AnafDetailsClient } from '../../src/AnafDetailsClient';
import type { MessageDetails } from '../../src/types';

jest.mock('../../src/AnafDetailsClient');

function makeMessage(overrides: Partial<MessageDetails> = {}): MessageDetails {
  return {
    id: '100',
    tip: 'FACTURA PRIMITA',
    data_creare: '202604081512',
    detalii: 'test',
    ...overrides,
  };
}

describe('enrichMessagesWithCompanyData', () => {
  let client: jest.Mocked<AnafDetailsClient>;

  beforeEach(() => {
    client = new AnafDetailsClient() as jest.Mocked<AnafDetailsClient>;
  });

  it('sets emitentName for messages with cif_emitent', async () => {
    client.batchGetCompanyData.mockResolvedValue({
      success: true,
      data: [{ vatCode: '38600525', name: 'ACME SRL', registrationNumber: '', address: '', postalCode: '', contactPhone: '', scpTva: true }],
    });

    const response = {
      mesaje: [
        makeMessage({ cif_emitent: '38600525' }),
        makeMessage({ cif_emitent: '38600525' }),
      ],
    };

    const result = await enrichMessagesWithCompanyData(response, client);

    expect(result.mesaje![0].emitentName).toBe('ACME SRL');
    expect(result.mesaje![1].emitentName).toBe('ACME SRL');
    // single batch call despite two messages with same CUI
    expect(client.batchGetCompanyData).toHaveBeenCalledTimes(1);
    expect(client.batchGetCompanyData).toHaveBeenCalledWith(['38600525']);
  });

  it('skips messages without cif_emitent', async () => {
    client.batchGetCompanyData.mockResolvedValue({
      success: true,
      data: [{ vatCode: '111', name: 'FOO SRL', registrationNumber: '', address: '', postalCode: '', contactPhone: '', scpTva: false }],
    });

    const response = {
      mesaje: [
        makeMessage({ cif_emitent: '111' }),
        makeMessage({}), // no cif_emitent
      ],
    };

    const result = await enrichMessagesWithCompanyData(response, client);
    expect(result.mesaje![0].emitentName).toBe('FOO SRL');
    expect(result.mesaje![1].emitentName).toBeUndefined();
  });

  it('returns original response when mesaje is empty', async () => {
    const response = { mesaje: [] as MessageDetails[] };
    const result = await enrichMessagesWithCompanyData(response, client);
    expect(result).toBe(response);
    expect(client.batchGetCompanyData).not.toHaveBeenCalled();
  });

  it('returns original response when mesaje is undefined', async () => {
    const response = { mesaje: undefined };
    const result = await enrichMessagesWithCompanyData(response, client);
    expect(result).toBe(response);
  });

  it('returns original response when no messages have cif_emitent', async () => {
    const response = { mesaje: [makeMessage({})] };
    const result = await enrichMessagesWithCompanyData(response, client);
    expect(result).toBe(response);
    expect(client.batchGetCompanyData).not.toHaveBeenCalled();
  });

  it('returns original response when batch lookup fails', async () => {
    client.batchGetCompanyData.mockRejectedValue(new Error('network error'));

    const response = { mesaje: [makeMessage({ cif_emitent: '999' })] };
    const result = await enrichMessagesWithCompanyData(response, client);
    expect(result).toBe(response);
  });

  it('returns original response when batch lookup returns success: false', async () => {
    client.batchGetCompanyData.mockResolvedValue({
      success: false,
      error: 'Not found',
    });

    const response = { mesaje: [makeMessage({ cif_emitent: '999' })] };
    const result = await enrichMessagesWithCompanyData(response, client);
    expect(result).toBe(response);
  });

  it('throws the 100-CUI error for more than 100 emitters instead of batching', async () => {
    const response = {
      mesaje: Array.from({ length: 101 }, (_, i) => makeMessage({ cif_emitent: String(1000 + i) })),
    };

    await expect(enrichMessagesWithCompanyData(response, client)).rejects.toThrow('Maximum 100 CUI codes per request.');
    expect(client.batchGetCompanyData).not.toHaveBeenCalled();
  });
});
