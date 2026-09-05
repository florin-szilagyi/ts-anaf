# ts-anaf

TypeScript SDK, CLI, and MCP server for Romania's [ANAF e-Factura](https://www.anaf.ro/anaf/internet/ANAF/despre_ANAF/informatii_publice/media/e_factura) system.

Upload invoices, check statuses, download responses, validate XML, generate UBL, and look up company data — from code, the command line, or directly from an AI agent.

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [**@florinszilagyi/anaf-ts-sdk**](./sdk/) | TypeScript SDK — OAuth, upload, status, download, UBL builder, company lookup | `pnpm add @florinszilagyi/anaf-ts-sdk` |
| [**@florinszilagyi/anaf-cli**](./cli/) | Command-line tool — wraps the SDK with context management and JSON output | `npm i -g @florinszilagyi/anaf-cli` |
| [**@florinszilagyi/anaf-mcp**](./mcp/) | MCP server — exposes all SDK operations as tools for AI agents (Claude, etc.) | `npx @florinszilagyi/anaf-mcp` |

---

## Agentic flows (Claude Code / Claude Desktop)

The MCP server lets an AI agent handle the full e-Factura workflow on your behalf — authenticate, build UBL invoices, validate, upload, poll status, and download — without writing any code.

### Install via Claude Code plugin marketplace

```bash
/plugin marketplace add florin-szilagyi/ts-anaf
/plugin install anaf-mcp@ts-anaf   # MCP server + skills
/plugin install anaf-cli@ts-anaf   # CLI skills (manifest mode, scripting)
```

You need an OAuth application registered in the ANAF portal — see the [official registration guide](https://static.anaf.ro/static/10/Anaf/Informatii_R/API/Oauth_procedura_inregistrare_aplicatii_portal_ANAF.pdf).

After install, set your ANAF OAuth credentials in the MCP server env (via `/mcp` settings):

```json
{
  "ANAF_CLIENT_ID": "your-client-id",
  "ANAF_CLIENT_SECRET": "your-client-secret",
  "ANAF_REDIRECT_URI": "https://localhost:9002/callback",
  "ANAF_ENV": "prod"
}
```

> **Test vs Production:** Set `ANAF_ENV` to `"test"` to use the ANAF sandbox — no real invoices are submitted. Switch to `"prod"` when ready for live use.

### Manual setup (Claude Desktop / Claude Code)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "anaf": {
      "command": "npx",
      "args": ["-y", "@florinszilagyi/anaf-mcp"],
      "env": {
        "ANAF_CLIENT_ID": "your-client-id",
        "ANAF_CLIENT_SECRET": "your-client-secret",
        "ANAF_REDIRECT_URI": "https://localhost:9002/callback",
        "ANAF_ENV": "prod"
      }
    }
  }
}
```

Or for Claude Code:

```bash
claude mcp add anaf -- npx -y @florinszilagyi/anaf-mcp
```

### Available tools

| Tool | Auth needed | Description |
|------|-------------|-------------|
| `anaf_auth_login` | — | Start OAuth flow — returns URL to open in browser |
| `anaf_auth_complete` | — | Finish OAuth — waits for callback, stores token |
| `anaf_switch_company` | — | Switch active company CUI (no re-auth needed) |
| `anaf_lookup_company` | — | Public ANAF company registry lookup by CUI |
| `anaf_build_ubl` | — | Generate CIUS-RO UBL 2.1 invoice XML |
| `anaf_validate_xml` | Yes | Validate UBL XML against ANAF rules |
| `anaf_upload_invoice` | Yes | Upload UBL XML to e-Factura (B2B or B2C) |
| `anaf_invoice_status` | Yes | Poll upload processing status |
| `anaf_download_invoice` | Yes | Download the processed ZIP archive |
| `anaf_download_invoice_pdf` | Yes | Download an invoice and save it rendered as a PDF |
| `anaf_list_messages` | Yes | List sent/received/error messages |

### Example agentic workflows

**First-time authentication:**
> "Authenticate me for ANAF company CUI 12345678"

The agent calls `anaf_auth_login` → returns the ANAF OAuth URL → you open it in your browser and sign with your digital certificate → agent calls `anaf_auth_complete` → done. Tokens are stored at `~/.local/share/anaf-cli/tokens/_default.json`.

**Create and submit an invoice:**
> "Create a B2B invoice for client Acme SRL (CUI 87654321) for 5 days of consulting at 800 RON/day, due in 30 days. Validate and upload it."

The agent calls `anaf_build_ubl` to generate the XML, `anaf_validate_xml` to check it, then `anaf_upload_invoice` and returns the upload index.

**Check upload status:**
> "What's the status of upload 5003456789?"

The agent calls `anaf_invoice_status` and reports back.

**See received invoices from suppliers:**
> "Show me all invoices I received this month"

The agent calls `anaf_list_messages` with `filter: "C"` and lists them.

**Switch between companies:**
> "Switch to company CUI 99887766"

The agent calls `anaf_switch_company` — no re-authentication needed.

---

## CLI quick start

```bash
# Install
npm i -g @florinszilagyi/anaf-cli

# Save your ANAF OAuth app credentials
anaf-cli cred add --name my-app \
  --client-id $ANAF_CLIENT_ID \
  --client-secret $ANAF_CLIENT_SECRET \
  --redirect-uri https://localhost:9002/callback

# Add a company
anaf-cli ctx add --name my-company --cui 12345678 --credential my-app
anaf-cli ctx use my-company

# Authenticate (opens browser automatically)
anaf-cli auth login

# Upload an invoice
anaf-cli efactura upload --xml invoice.xml
```

See [cli/README.md](./cli/) for the full command reference.

## SDK quick start

```typescript
import { AnafAuthenticator, EfacturaClient, TokenManager } from '@florinszilagyi/anaf-ts-sdk';

// Authenticate
const auth = new AnafAuthenticator({
  clientId: process.env.ANAF_CLIENT_ID!,
  clientSecret: process.env.ANAF_CLIENT_SECRET!,
  redirectUri: 'https://localhost:9002/callback',
});
const tokens = await auth.exchangeCodeForToken(code);
const tokenManager = new TokenManager(auth, tokens.refresh_token);

// Upload
const client = new EfacturaClient({ vatNumber: 'RO12345678', testMode: true }, tokenManager);
const result = await client.uploadDocument(xml, { standard: 'UBL' });
const status = await client.getUploadStatus(result.index_incarcare);
```

See [sdk/README.md](./sdk/) for the full API reference.

## Development

```bash
git clone https://github.com/florin-szilagyi/ts-anaf.git
cd ts-anaf
pnpm install

pnpm build          # build SDK + CLI
pnpm test           # test all packages
pnpm verify         # lint + build + test (full CI gate)

# MCP server
pnpm --filter @florinszilagyi/anaf-mcp run dev   # run via tsx (no build needed)
pnpm --filter @florinszilagyi/anaf-mcp run test  # unit tests
```

## License

MIT
