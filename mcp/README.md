# @florinszilagyi/anaf-mcp

MCP server exposing the ANAF e-Factura SDK as tools for LLM agents (Claude Desktop, Claude Code, etc.).

## Prerequisites

Set your ANAF OAuth app credentials as env vars in `mcpServers` — no `anaf-cli` installation required. Authentication is handled by the `anaf_auth_login` / `anaf_auth_complete` tools directly.

The MCP server stores state at the same XDG paths as `anaf-cli`, so credentials are shared if you use both:

| File | Purpose |
|---|---|
| `~/.config/anaf-cli/config.yaml` | Active company CUI (written by `anaf_auth_login`/`anaf_switch_company`) |
| `~/.local/share/anaf-cli/tokens/_default.json` | Refresh + access tokens |

## Tools

| Tool | Auth | Description |
|---|---|---|
| `anaf_auth_login` | Setup | Start OAuth flow — returns URL to open in browser |
| `anaf_auth_complete` | Setup | Finish OAuth — waits for callback, stores token |
| `anaf_switch_company` | No | Switch active company CUI (no re-auth needed) |
| `anaf_lookup_company` | No | Public ANAF company registry lookup by CUI |
| `anaf_build_ubl` | No | Generate CIUS-RO UBL 2.1 invoice XML |
| `anaf_validate_xml` | Yes | Validate UBL XML against ANAF rules |
| `anaf_upload_invoice` | Yes | Upload UBL XML to e-Factura (B2B or B2C) |
| `anaf_invoice_status` | Yes | Poll upload processing status |
| `anaf_download_invoice` | Yes | Download the processed ZIP archive |
| `anaf_download_invoice_pdf` | Yes | Download an invoice and save it rendered as a PDF |
| `anaf_list_messages` | Yes | List sent/received/error messages |

## Authentication

Authentication is a two-step flow the agent performs on your behalf:

1. Agent calls `anaf_auth_login({ cui: "12345678" })` → returns the ANAF OAuth URL
2. You open the URL in your browser and authenticate with your digital certificate
3. Agent calls `anaf_auth_complete()` → exchanges the code, stores the token

After that, all tools work automatically. To switch companies without re-authenticating, call `anaf_switch_company`.

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on other OSes:

```json
{
  "mcpServers": {
    "anaf": {
      "command": "npx",
      "args": ["-y", "@florinszilagyi/anaf-mcp"],
      "env": {
        "ANAF_CLIENT_ID": "your-oauth-client-id",
        "ANAF_CLIENT_SECRET": "your-oauth-client-secret",
        "ANAF_REDIRECT_URI": "https://localhost:9002/callback",
        "ANAF_ENV": "prod"
      }
    }
  }
}
```

## Claude Code

```bash
claude mcp add anaf -- npx -y @florinszilagyi/anaf-mcp
```

Set the secret in your shell env or via a `.env` file sourced before launch.

## Local Development

```bash
pnpm install
pnpm --filter @florinszilagyi/anaf-mcp run dev     # runs via tsx
pnpm --filter @florinszilagyi/anaf-mcp run test    # unit tests
pnpm --filter @florinszilagyi/anaf-mcp run build   # produces dist/
```
