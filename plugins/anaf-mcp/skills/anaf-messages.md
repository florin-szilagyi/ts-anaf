---
name: anaf-messages
description: List and check ANAF e-Factura messages — sent invoices, received invoices from suppliers, errors. Use when the user asks to "list invoices", "check received invoices", "see ANAF messages", "what invoices did I receive", or wants to audit e-Factura activity.
---

# Checking ANAF e-Factura Messages

## List messages

Call `anaf_list_messages` with:

```json
{
  "days": 30,
  "filter": "T"
}
```

**Filter values:**
- `"T"` — all messages (sent + received + errors)
- `"P"` — sent invoices (as supplier)
- `"C"` — received invoices (as buyer)
- `"E"` — error messages only

**Days:** 1–60. Defaults to 30 if omitted.

## Understanding message types

| Type | Meaning |
|---|---|
| `FACTURA TRIMISA` | Invoice you sent, accepted by ANAF |
| `FACTURA PRIMITA` | Invoice received from a supplier |
| `EROARE FACTURA` | Your upload was rejected |

## Downloading a received invoice

If you see a message with an `id`, call `anaf_download_invoice` with that ID to get the signed ZIP,
or `anaf_download_invoice_pdf` to save the same invoice rendered as a PDF.

## Checking a specific upload

Use `anaf_invoice_status` with the `uploadIndex` from your original upload.

## Active company

All messages are for the currently active company CUI. Use `anaf_switch_company` to check messages for a different company.
