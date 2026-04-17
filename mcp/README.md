# @florinszilagyi/anaf-mcp

MCP server exposing the ANAF e-Factura SDK as tools for LLM agents (Claude Desktop, Claude Code, etc.).

## Prerequisites

This server **reuses the `anaf-cli` state on disk** for authentication. Before using the MCP, complete a one-time CLI setup:

```bash
# 1. Install the CLI
npm install -g @florinszilagyi/anaf-cli

# 2. Register your OAuth credential (once, ever)
anaf-cli cred set --client-id <id> --redirect-uri https://localhost:3000/callback

# 3. Log in for a specific company (obtains refresh token)
anaf-cli auth login <CUI>
```

The MCP server reads:

| File | Purpose |
|---|---|
| `~/.config/anaf-cli/credential.yaml` | OAuth client ID + redirect URI (optional if env vars set) |
| `~/.config/anaf-cli/config.yaml` | Active company CUI (written by `anaf_auth_login`/`anaf_switch_company`) |
| `~/.local/share/anaf-cli/tokens/_default.json` | Refresh + access tokens |

All OAuth values (`ANAF_CLIENT_ID`, `ANAF_CLIENT_SECRET`, `ANAF_REDIRECT_URI`) and the environment (`ANAF_ENV=prod|test`, default `prod`) are set as env vars in `mcpServers`. No `anaf-cli` installation required. The token file is shared with `anaf-cli` if you use both.

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
