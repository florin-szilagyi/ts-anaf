import { describe, expect, it } from 'vitest';
import { canTransition } from '@/lib/invoiceStatus';
import type { InvoiceStatus } from '@/db/schema';

describe('invoice status machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('queued', 'building')).toBe(true);
    expect(canTransition('building', 'uploaded')).toBe(true);
    expect(canTransition('uploaded', 'processing')).toBe(true);
    expect(canTransition('processing', 'validated')).toBe(true);
  });

  it('allows fast validation (uploaded → validated without processing)', () => {
    expect(canTransition('uploaded', 'validated')).toBe(true);
    expect(canTransition('uploaded', 'rejected')).toBe(true);
  });

  it('lets any non-terminal state fail', () => {
    for (const s of ['queued', 'building', 'uploaded', 'processing'] as InvoiceStatus[]) {
      expect(canTransition(s, 'failed')).toBe(true);
    }
  });

  it('terminal states never move', () => {
    for (const terminal of ['validated', 'rejected', 'failed', 'received'] as InvoiceStatus[]) {
      for (const to of ['queued', 'building', 'uploaded', 'processing', 'validated', 'failed'] as InvoiceStatus[]) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });

  it('cannot skip backwards', () => {
    expect(canTransition('processing', 'queued')).toBe(false);
    expect(canTransition('uploaded', 'building')).toBe(false);
  });
});
