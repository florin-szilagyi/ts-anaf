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
| `~/.config/anaf-cli/credential.yaml` | OAuth client ID + redirect URI |
| `~/.config/anaf-cli/config.yaml` | Active company CUI and environment (test/prod) |
| `~/.local/share/anaf-cli/tokens/_default.json` | Refresh + access tokens |

The client secret is **not** read from disk — pass it via `ANAF_CLIENT_SECRET` env var.

## Tools

| Tool | Auth | Description |
|---|---|---|
| `anaf_lookup_company` | No | Public ANAF company registry lookup by CUI |
| `anaf_build_ubl` | No | Generate CIUS-RO UBL 2.1 invoice XML |
| `anaf_validate_xml` | Yes | Validate UBL XML against ANAF rules |
| `anaf_upload_invoice` | Yes | Upload UBL XML to e-Factura (B2B or B2C) |
| `anaf_invoice_status` | Yes | Poll upload processing status |
| `anaf_download_invoice` | Yes | Download the processed ZIP archive |
| `anaf_list_messages` | Yes | List sent/received/error messages |

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on other OSes:

```json
{
  "mcpServers": {
    "anaf": {
      "command": "npx",
      "args": ["-y", "@florinszilagyi/anaf-mcp"],
      "env": {
        "ANAF_CLIENT_SECRET": "your-oauth-client-secret"
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
