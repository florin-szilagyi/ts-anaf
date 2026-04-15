import type { Party } from '@florinszilagyi/anaf-ts-sdk';
import type { PartyOverride } from './types';

export function mergePartyOverride(base: Party, override?: PartyOverride): Party {
  if (!override) {
    return clone(base);
  }
  const merged = clone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (key === 'address' && value && typeof value === 'object') {
      const addressOverride = value as Record<string, unknown>;
      const addressMerged: Record<string, unknown> = { ...merged.address };
      for (const [ak, av] of Object.entries(addressOverride)) {
        if (av !== undefined) {
          addressMerged[ak] = av;
        }
      }
      merged.address = addressMerged as unknown as Party['address'];
      continue;
    }
    (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

function clone(p: Party): Party {
  return {
    ...p,
    address: { ...p.address },
  };
}
