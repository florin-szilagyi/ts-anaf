---
name: anaf-invoice
description: Create, validate, and submit Romanian e-invoices (CIUS-RO UBL 2.1) to ANAF e-Factura using the ANAF MCP tools. Use when the user wants to create an invoice, issue a factura, submit to e-Factura, or says "invoice", "factura", "UBL". Requires ANAF MCP to be set up (see anaf-setup).
---

# Creating and Submitting ANAF e-Invoices

## Full workflow

```
Build UBL XML → Validate → Upload → Poll status → Download ZIP
```

## Step 1 — Build the UBL invoice

Call `anaf_build_ubl` with invoice details. Key fields:

```json
{
  "invoiceNumber": "2024-001",
  "issueDate": "2024-01-15",
  "dueDate": "2024-02-15",
  "seller": {
    "cui": "12345678",
    "name": "Firma Mea SRL",
    "address": "Str. Exemplu 1, Cluj-Napoca",
    "county": "CJ",
    "country": "RO",
    "iban": "RO49AAAA1B31007593840000",
    "bank": "Banca Transilvania"
  },
  "buyer": {
    "cui": "87654321",
    "name": "Client SRL",
    "address": "Bd. Unirii 10, București",
    "county": "B",
    "country": "RO"
  },
  "lines": [
    {
      "description": "Servicii consultanță IT",
      "quantity": 1,
      "unitPrice": 1000,
      "vatRate": 19
    }
  ],
  "currency": "RON"
}
```

Returns UBL 2.1 XML as a string.

## Step 2 — Validate

Call `anaf_validate_xml` with the XML string. ANAF validates against CIUS-RO rules. Fix any reported errors before uploeding.

## Step 3 — Upload

Call `anaf_upload_invoice` with the validated XML. Returns an `uploadIndex` (e.g. `"5003456789"`).

## Step 4 — Poll status

Call `anaf_invoice_status` with the upload index. Retry every 30-60 seconds until status is `ok` or `nok`.

## Step 5 — Download (optional)

Call `anaf_download_invoice` with the upload index to get the signed ZIP archive from ANAF.

For a human-readable copy, call `anaf_download_invoice_pdf` instead — it unwraps the archive
and writes the invoice rendered as a PDF (pass `standard: "FCN"` for credit notes).

## Common invoice patterns

**B2B (business to business):** Default. Buyer CUI required.

**B2C (business to consumer):** Buyer has no CUI — omit `cui` in buyer, set `isB2C: true` in upload.

**VAT rates:** 19% standard, 9% reduced (food, medicines), 5% super-reduced, 0% exempt.

**Currency:** `RON` default. For EUR invoices set `"currency": "EUR"` and include exchange rate.

## Tips

- Always validate before uploading — ANAF rejects invalid XML without a clear error at upload time
- Save the `uploadIndex` — you need it to check status and download
- ANAF processing usually completes in under 5 minutes
- Test with `ANAF_ENV=test` first before going live with `prod`
