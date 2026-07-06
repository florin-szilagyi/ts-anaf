/**
 * Romanian (CIUS-RO) party-mapping helpers.
 *
 * Utilities to turn public ANAF company-lookup data (`AnafCompanyData`) into a
 * UBL `Party` that satisfies CIUS-RO addressing rules:
 *  - county extraction from ANAF-formatted address strings (ISO 3166-2:RO)
 *  - BR-RO-100: Bucharest parties must use CityName SECTOR1..SECTOR6
 *  - VAT-payer detection (`scpTva`) → `vatNumber = RO<cui>`
 */

import type { AnafCompanyData, Party } from '../types';

const ADDRESS_PLACEHOLDER = '-';

/**
 * Maps ANAF county names (as they appear in address strings) to ISO 3166-2:RO codes.
 * Keys are uppercase ASCII (diacritics stripped via NFD normalization).
 */
export const COUNTY_NAME_TO_ISO: Readonly<Record<string, string>> = {
  ALBA: 'RO-AB',
  ARGES: 'RO-AG',
  ARAD: 'RO-AR',
  BACAU: 'RO-BC',
  BIHOR: 'RO-BH',
  'BISTRITA-NASAUD': 'RO-BN',
  BRAILA: 'RO-BR',
  BOTOSANI: 'RO-BT',
  BRASOV: 'RO-BV',
  BUZAU: 'RO-BZ',
  CLUJ: 'RO-CJ',
  CALARASI: 'RO-CL',
  'CARAS-SEVERIN': 'RO-CS',
  CONSTANTA: 'RO-CT',
  COVASNA: 'RO-CV',
  DAMBOVITA: 'RO-DB',
  DOLJ: 'RO-DJ',
  GORJ: 'RO-GJ',
  GALATI: 'RO-GL',
  GIURGIU: 'RO-GR',
  HUNEDOARA: 'RO-HD',
  HARGHITA: 'RO-HR',
  ILFOV: 'RO-IF',
  IALOMITA: 'RO-IL',
  IASI: 'RO-IS',
  MEHEDINTI: 'RO-MH',
  MARAMURES: 'RO-MM',
  MURES: 'RO-MS',
  NEAMT: 'RO-NT',
  OLT: 'RO-OT',
  PRAHOVA: 'RO-PH',
  SIBIU: 'RO-SB',
  SALAJ: 'RO-SJ',
  'SATU MARE': 'RO-SM',
  SUCEAVA: 'RO-SV',
  TULCEA: 'RO-TL',
  TIMIS: 'RO-TM',
  TELEORMAN: 'RO-TR',
  VALCEA: 'RO-VL',
  VRANCEA: 'RO-VN',
  VASLUI: 'RO-VS',
};

/**
 * Normalize a Romanian string for county matching: uppercase + strip diacritics.
 * Handles both cedilla (Ş/Ţ) and comma-below (Ș/Ț) variants via NFD decomposition.
 */
function normalizeRo(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * Extract the ISO 3166-2:RO county code from an ANAF-formatted address string.
 *
 * ANAF address format examples:
 *   "JUD. CLUJ, MUN. CLUJ-NAPOCA, STR. MIHAI EMINESCU, NR. 1"
 *   "MUN. BUCURESTI, SECTOR 1, STR. VICTORIEI, NR. 10"
 *   "MUNICIPIUL BUCUREŞTI, SECTOR 1, STR SEMICERCULUI, NR.12"
 *   "SECTOR 3, STR. UNIRII, NR. 5"  (Bucharest sector)
 */
export function countyFromAddress(address: string | undefined): string | undefined {
  if (!address?.trim()) return undefined;
  const norm = normalizeRo(address);

  // "JUD. <COUNTY>[,...]" — county-based addresses
  const judMatch = norm.match(/^JUD\.\s+([^,]+)/);
  if (judMatch) {
    const countyName = judMatch[1].trim();
    return COUNTY_NAME_TO_ISO[countyName] ?? undefined;
  }

  // Bucharest: "MUN. BUCURESTI...", "MUNICIPIUL BUCURESTI..." or bare "SECTOR X...".
  // ANAF returns the full word "MUNICIPIUL" in some lookups; we accept both forms.
  if (/^MUN\.\s+BUCURESTI/.test(norm) || /^MUNICIPIUL\s+BUCURESTI/.test(norm) || /^SECTOR\s+\d/.test(norm)) {
    return 'RO-B';
  }

  return undefined;
}

/**
 * Parse the Bucharest sector (1-6) from an ANAF-formatted address. Returns the
 * CIUS-RO city value ("SECTOR1".."SECTOR6") expected by BR-RO-100 when the buyer
 * county is RO-B, or undefined when the address is not a Bucharest sector.
 */
export function bucharestSectorFromAddress(address: string | undefined): string | undefined {
  if (!address?.trim()) return undefined;
  if (countyFromAddress(address) !== 'RO-B') return undefined;
  const sectorMatch = normalizeRo(address).match(/SECTOR\s+(\d)/);
  if (!sectorMatch) return undefined;
  const sector = sectorMatch[1];
  if (sector < '1' || sector > '6') return undefined;
  return `SECTOR${sector}`;
}

/**
 * Map public ANAF lookup data to a UBL Party. Missing address parts are filled
 * with a placeholder ("-") so the generated XML stays schema-valid; callers can
 * refine via `mergePartyOverride`.
 */
export function companyToParty(company: AnafCompanyData, fallbackCui: string): Party {
  const cui = company.vatCode ?? fallbackCui.replace(/^RO/i, '');
  const vatNumber = company.scpTva ? `RO${cui}` : undefined;
  const street = company.address?.trim() ? company.address : ADDRESS_PLACEHOLDER;
  const postalZone = company.postalCode?.trim() ? company.postalCode : ADDRESS_PLACEHOLDER;
  const county = countyFromAddress(company.address);
  // BR-RO-100: when CountrySubentity is RO-B (Bucharest), CityName must be SECTOR1..SECTOR6.
  // Auto-derive the sector from the ANAF address when possible.
  const city =
    county === 'RO-B' ? (bucharestSectorFromAddress(company.address) ?? ADDRESS_PLACEHOLDER) : ADDRESS_PLACEHOLDER;
  return {
    registrationName: company.name,
    companyId: cui,
    vatNumber,
    address: {
      street,
      city,
      postalZone,
      county,
      countryCode: 'RO',
    },
    telephone: company.contactPhone || undefined,
  };
}

/** Partial Party used to override values derived from ANAF lookup data. */
export interface PartyOverride {
  registrationName?: string;
  companyId?: string;
  vatNumber?: string;
  email?: string;
  telephone?: string;
  partyIdentificationId?: string;
  address?: {
    street?: string;
    city?: string;
    postalZone?: string;
    county?: string;
    countryCode?: string;
  };
}

/** Deep-merge a PartyOverride onto a base Party (address merged field-by-field). */
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
