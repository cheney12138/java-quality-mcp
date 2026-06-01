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
- Java 8+

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
        "JAVA_HOME": "/path/to/jdk"
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
| `get_quality_report` | Generate a statistics report of accumulated validation data |

## Slash commands

`/code-flavor-good` and `/code-flavor-bad` — paste a code snippet and Claude will analyze it, generate a note and tags, and save it automatically.

`/quality-report` — generates a quality statistics report including:
- Total validations and violations caught
- Overall first-pass rate
- Top 5 most frequently violated rules
- Pass rate trend: recent 7 days vs previous 7 days
- Total design hints triggered

## Data storage

All data is stored in `~/.code-quality-mcp/flavor.db` (SQLite), persisting across sessions:

| Table | Contents |
|---|---|
| `flavors` | Style samples recorded via `/code-flavor-good` and `/code-flavor-bad` |
| `validations` | Auto-recorded results of every `validate_code` call (for quality reporting) |

## License

MIT
