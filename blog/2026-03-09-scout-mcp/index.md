---
slug: scout-mcp
date: 2026-03-09
title: "Scout MCP: Query Your Observability Data Through AI Assistants"
description: "Scout now exposes an MCP endpoint. Connect Claude Code, Claude Desktop, or Gemini CLI and query traces, logs, metrics, service topology, and alerts in plain English."
authors: [ranjan-sakalley]
tags: [scout, mcp, ai, observability, agents]
unlisted: true
---

Scout now supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).
You can connect your coding agent to Scout and query traces, logs, metrics,
service topology, and alerts using natural language.

<!--truncate-->

## What This Means

[MCP](https://modelcontextprotocol.io/introduction) is a standard that lets
coding agents call external tools. Scout's MCP
endpoint exposes 10 read-only tools that cover the core observability
operations: listing services, mapping dependencies, querying traces and logs,
discovering schemas, checking metrics, and pulling alerts.

The tools are designed to be composable. An coding agent can chain multiple
tools in a single investigation, discovering available span attributes before
querying traces, or correlating error logs with the traces that produced them.

## How It Works

You connect your coding agent to Scout's MCP endpoint once. After that, you
ask questions in plain English and your coding agent determines which tools to call.

A few examples of what you can ask:

- *Show me the slowest traces for payment-service in the last hour*
- *Find error logs containing "timeout" in order-service today*
- *What services does checkout-service depend on?*
- *Were there any critical alerts in the last 2 hours?*

The assistant handles tool selection, parameter formatting, and result
interpretation. You get back a summary instead of raw JSON.

## Supported Clients

Setup takes a few minutes for each client:

- **Claude Code CLI** adds the MCP server with a single command and
  authenticates via browser
- **Claude Desktop** requires a config file edit and app restart
- **Gemini CLI** requires a config file edit, with OAuth handled automatically

Full setup instructions are in the
[MCP Client Setup](/scout-mcp/setup) documentation.

## Multi-Step Investigations

The interesting part is how your coding agent combines tools. When you ask "the
checkout page is slow, can you investigate?", your coding agent does not just run
one query. It lists services to find the relevant one, queries traces filtered
by high duration, fetches full span details for the slowest trace, and
identifies the bottleneck.

Similarly, after a deployment, you can ask "we deployed order-service 30
minutes ago, are there any new errors?" and your coding agent will check traces,
logs, and alerts for that time window, then summarize the findings.

## Discovery Before Search

One pattern worth highlighting: Scout MCP includes discovery tools for both
spans and logs. These return available attribute keys, span names, severity
levels, and status codes for a given service. The coding agent can use these
to build precise queries without you needing to know the exact attribute names.

You can ask "what span names and attributes are available for payment-service?"
before asking "show me traces where provider is stripe."

## Read-Only by Design

All 10 tools are read-only and idempotent. The coding agent cannot create,
modify, or delete anything in your environment. This keeps the integration safe
for everyday use without requiring additional permission scoping.

## Getting Started

The [MCP Client Setup](/scout-mcp/setup) guide covers
connecting Claude Code, Claude Desktop, and Gemini CLI. The
[Usage Guide](/scout-mcp/usage-guide) covers what you can
ask, example investigations, and a full tool reference.
