import { AnafDetailsClient } from '../AnafDetailsClient';
import type { MessageDetails } from '../types';

/**
 * Enrich messages that have a `cif_emitent` field with the emitter's company name.
 *
 * Collects all unique emitter CUIs, looks them up via
 * `AnafDetailsClient.batchGetCompanyData` in sequential batches of 100, and
 * sets `emitentName` on each message where a match is found.
 *
 * Graceful degradation: if the batch lookup fails, the original response
 * is returned unchanged (no `emitentName` fields).
 */
export async function enrichMessagesWithCompanyData<T extends { mesaje?: MessageDetails[] }>(
  response: T,
  detailsClient: AnafDetailsClient
): Promise<T> {
  if (!response.mesaje || response.mesaje.length === 0) {
    return response;
  }

  const uniqueCuis = [
    ...new Set(response.mesaje.map((m) => m.cif_emitent).filter((cui): cui is string => Boolean(cui))),
  ];

  if (uniqueCuis.length === 0) {
    return response;
  }

  try {
    const nameMap = new Map<string, string>();
    // ANAF accepts at most 100 CUIs per request; one request at a time, never in parallel
    for (let i = 0; i < uniqueCuis.length; i += 100) {
      const result = await detailsClient.batchGetCompanyData(uniqueCuis.slice(i, i + 100));
      // A batch where ANAF found none of the CUIs is an answer, not a failure
      if (!result.success && !result.notFound) {
        return response;
      }
      for (const company of result.data ?? []) {
        nameMap.set(company.vatCode, company.name);
      }
    }

    return {
      ...response,
      mesaje: response.mesaje.map((msg) => {
        if (msg.cif_emitent && nameMap.has(msg.cif_emitent)) {
          return { ...msg, emitentName: nameMap.get(msg.cif_emitent) };
        }
        return msg;
      }),
    };
  } catch {
    return response;
  }
}
