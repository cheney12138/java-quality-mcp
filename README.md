# @mcp/java-quality-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that enforces Java code quality inside Claude Code. It runs Checkstyle + PMD on AI-generated code, detects design smell, and lets teams accumulate custom style samples that guide future generation.

## Features

**Layer 1 — Style & rule validation**
- Checkstyle: naming conventions, method length, parameter count, nesting depth, cyclomatic complexity
- PMD quickstart: empty catch blocks, generic exception handling, string comparison order, and more
- Claude calls `validate_code` after generating code, fixes violations before showing output

**Layer 2 — Design hints**
- Structural analysis runs alongside linting and returns a `design_hints` field
- Detects: long if-else chains → Strategy/CoR, `instanceof` chains → Strategy/Visitor, sequential guard clauses → CoR
- Hints describe structural facts; Claude decides whether and how to refactor

**Layer 3 — Team style samples**
- `/code-flavor-good` and `/code-flavor-bad` slash commands
- Paste a code snippet → Claude extracts intent and tags → stored in local SQLite
- Samples are returned with every `get_style_context` call, shaping future generation

## Requirements

- Node.js 18+
- Java 11+

## Setup

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "code-quality": {
      "command": "npx",
      "args": ["@mcp/java-quality-mcp"]
    }
  }
}
```

If `java` is not on your `PATH`, specify the JDK location:

```json
{
  "mcpServers": {
    "code-quality": {
      "command": "npx",
      "args": ["@mcp/java-quality-mcp"],
      "env": {
        "JAVA_HOME": "/path/to/jdk11"
      }
    }
  }
}
```

Java is resolved in this order: `JAVA11_HOME` → `JAVA_HOME` → `java` in PATH.

## Tools

| Tool | When to call |
|---|---|
| `get_style_context` | Before generating Java code — returns active rules + style samples |
| `validate_code` | After generating Java code — returns `violations` + `design_hints` |
| `flavor_add` | Record a good or bad code sample |
| `flavor_list` | List recorded samples |
| `flavor_delete` | Remove a sample by id |

## Slash commands

`/code-flavor-good` and `/code-flavor-bad` are available in Claude Code once the MCP is connected. Paste a code snippet and Claude will analyze it, generate a note and tags, and save it automatically.

## Data storage

Style samples are stored in `~/.@mcp/java-quality-mcp/flavor.db` (SQLite). Data persists across sessions and is local to each user.

## License

MIT
