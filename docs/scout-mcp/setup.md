---
title: MCP Client Setup
sidebar_position: 1
unlisted: false
description:
  Connect your coding agent to Scout using the Model Context Protocol (MCP).
  Supported clients include Claude Code, Claude Desktop, and Gemini CLI.
keywords:
  [
    scout mcp,
    model context protocol,
    ai observability,
    claude code,
    gemini cli,
  ]
---

# MCP Client Setup

Scout exposes an
[MCP (Model Context Protocol)](https://modelcontextprotocol.io) endpoint that
lets coding agents query your observability data, including traces, logs,
metrics, service topology, and alerts, using natural language.

## Prerequisites

- Your Scout MCP endpoint URL (`<SCOUT_URL>/mcp/v1`), see
  [Finding your Scout URL](#finding-your-scout-url) below
- A Scout account in the corresponding tenant realm
- Node.js installed (for Claude Desktop only)

## Claude Code CLI

Add the Scout MCP server:

```bash
claude mcp add scout --transport http <SCOUT_URL>/mcp/v1
```

This opens an authentication window in your browser. After logging in, the
connection is established automatically.

Authenticate inside Claude Code:

```text
/mcp 
```

> Choose Scout and Select Authenticate

Verify the connection:

```bash
claude mcp list
```

To remove:

```bash
claude mcp remove scout
```

## Claude Desktop App

Edit the config file at:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the `mcpServers` section:

```json
{
  "mcpServers": {
    "scout": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "<SCOUT_URL>/mcp/v1",
        "--static-oauth-client-metadata",
        "{\"scope\":\"\",\"client_uri\":\"http://localhost\"}"
      ]
    }
  }
}
```

Restart the Claude Desktop app. On first connection, a browser window opens for
authentication.

## Gemini CLI

Edit `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "scout": {
      "httpUrl": "<SCOUT_URL>/mcp/v1",
      "oauth": {
        "scopes": []
      }
    }
  }
}
```

Run `gemini` and the OAuth flow starts automatically on first use.

## Verify the Connection

Once connected, ask your coding agent a simple question:

> What services are running in my environment?

The assistant should use Scout's MCP tools to query your observability data and
return a list of services.

If you run into issues, reach out to base14 support via Slack.

## Finding Your Scout URL

Replace `<SCOUT_URL>` in the examples above with your organization's Scout API
base URL. It follows this pattern:

```text
https://<your-org>.api.<region>-scout.base14.io
```

For example, if your organization is **acme** and your region is **as1**, your
Scout URL would be:

```text
https://acme.api.as1-scout.base14.io
```

And the full MCP endpoint:

```text
https://acme.api.as1-scout.base14.io/mcp/v1
```

Check with your team or base14 support if you are unsure about your organization
name or region.
