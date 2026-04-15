import { mergePartyOverride } from '../../src/actions/overrideMerge';
import type { Party } from '@florinszilagyi/anaf-ts-sdk';

const basePartyFn = (): Party => ({
  registrationName: 'Acme SRL',
  companyId: '12345678',
  vatNumber: 'RO12345678',
  address: {
    street: 'Strada A nr 1',
    city: 'Bucuresti',
    postalZone: '012345',
    county: 'B',
    countryCode: 'RO',
  },
  email: 'a@example.com',
});

describe('mergePartyOverride', () => {
  it('returns the base unchanged when no override is given', () => {
    const base = basePartyFn();
    expect(mergePartyOverride(base)).toEqual(base);
  });

  it('overrides scalar fields', () => {
    const merged = mergePartyOverride(basePartyFn(), { registrationName: 'Acme Corrected SRL' });
    expect(merged.registrationName).toBe('Acme Corrected SRL');
    expect(merged.companyId).toBe('12345678');
  });

  it('deep-merges address fields', () => {
    const merged = mergePartyOverride(basePartyFn(), {
      address: { city: 'Cluj-Napoca', postalZone: '400000' },
    });
    expect(merged.address.city).toBe('Cluj-Napoca');
    expect(merged.address.postalZone).toBe('400000');
    expect(merged.address.street).toBe('Strada A nr 1');
    expect(merged.address.countryCode).toBe('RO');
  });

  it('does not mutate the base party', () => {
    const base = basePartyFn();
    const merged = mergePartyOverride(base, { registrationName: 'X' });
    expect(base.registrationName).toBe('Acme SRL');
    expect(merged.registrationName).toBe('X');
  });

  it('ignores undefined override fields (does not unset)', () => {
    const merged = mergePartyOverride(basePartyFn(), {
      registrationName: undefined,
      address: { city: undefined },
    });
    expect(merged.registrationName).toBe('Acme SRL');
    expect(merged.address.city).toBe('Bucuresti');
  });
});
