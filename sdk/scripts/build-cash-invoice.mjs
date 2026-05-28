#!/usr/bin/env node
/**
 * Generates a CIUS-RO UBL XML invoice using the new paymentMeansCode + prepaidAmount
 * fields and writes it to stdout (or --out <path>).
 *
 * Used to smoke-test the new optional fields against the live ANAF validator
 * via the anaf-cli CLI (`anaf-cli efactura validate --xml <path>`).
 */
import { UblBuilder } from '../dist/UblBuilder.js';
import { writeFileSync } from 'node:fs';
import { argv } from 'node:process';

const outFlagIdx = argv.indexOf('--out');
const outPath = outFlagIdx > -1 ? argv[outFlagIdx + 1] : undefined;
if (outFlagIdx > -1 && (!outPath || outPath.startsWith('-'))) {
  console.error('Missing value for --out. Usage: --out <path>');
  process.exit(1);
}

const builder = new UblBuilder();

// Use the supplier's own CUI as customer (self-invoice) so the customer is guaranteed
// to exist in ANAF without depending on a real third-party CUI. The supplier is
// PP AUTO SRL (CUI 30498862, per the consumer's CLAUDE.md), the entity Florin owns.
const xml = builder.generateInvoiceXml({
  invoiceNumber: `SDK-TEST-${Date.now()}`,
  issueDate: new Date().toISOString().slice(0, 10),
  currency: 'RON',
  supplier: {
    registrationName: 'PP AUTO SRL',
    companyId: '30498862',
    vatNumber: 'RO30498862',
    address: {
      street: 'Calea Floresti 81',
      city: 'CLUJ-NAPOCA',
      postalZone: '400516',
      county: 'RO-CJ',
    },
  },
  customer: {
    registrationName: 'PP AUTO SRL',
    companyId: '30498862',
    vatNumber: 'RO30498862',
    address: {
      street: 'Calea Floresti 81',
      city: 'CLUJ-NAPOCA',
      postalZone: '400516',
      county: 'RO-CJ',
    },
  },
  lines: [
    {
      description: 'Spalare exterior — plata in numerar la kiosk',
      quantity: 1,
      unitPrice: 25,
      taxPercent: 19,
    },
  ],
  // New fields under test:
  paymentMeansCode: '10', // 10 = In cash (UN/ECE 4461)
  prepaidAmount: 25 * 1.19, // Fully paid at kiosk: TaxInclusive = 29.75
  isSupplierVatPayer: true,
});

if (outPath) {
  writeFileSync(outPath, xml, 'utf8');
  console.error(`Wrote ${outPath}`);
} else {
  process.stdout.write(xml);
}
