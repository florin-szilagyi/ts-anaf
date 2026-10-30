import { AnafDetailsClient } from '../AnafDetailsClient';
import type { MessageDetails } from '../types';

/**
 * Enrich messages that have a `cif_emitent` field with the emitter's company name.
 *
 * Collects all unique emitter CUIs, performs a single batch lookup via
 * `AnafDetailsClient.batchGetCompanyData`, and sets `emitentName` on each
 * message where a match is found.
 *
 * Graceful degradation: if the batch lookup fails, the original response
 * is returned unchanged (no `emitentName` fields). More than 100 unique
 * emitters throws instead, so the caller can batch its own requests.
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

  if (uniqueCuis.length > 100) {
    throw new Error('Maximum 100 CUI codes per request.');
  }

  try {
    const result = await detailsClient.batchGetCompanyData(uniqueCuis);
    // ANAF found none of the CUIs: an answer, not a failure
    if (!result.success && !result.notFound) {
      return response;
    }

    const nameMap = new Map<string, string>();
    for (const company of result.data ?? []) {
      nameMap.set(company.vatCode, company.name);
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
