# warroom-mcp

Local MCP server that exposes Warroom's data and tools to Claude (desktop app or Claude Code).

## Setup

```bash
cd warroom-mcp
npm install
```

## Connect to Claude desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "warroom": {
      "command": "node",
      "args": ["/path/to/warroom/warroom-mcp/server.js"],
      "env": {
        "WARROOM_DATA_DIR": "/Users/<you>/Library/Application Support/warroom/warroom",
        "WARROOM_SKILLS_DIR": "/path/to/warroom/electron/skills"
      }
    }
  }
}
```

Restart Claude after editing the config.

## Tools

| Tool | What it does |
|---|---|
| `get_warroom_context` | Debate event + current topic + tournament records (same as system prompt) |
| `get_skill` | Load a skill file: `cx_debate`, `pf_debate`, `ld_debate`, `card_cutting`, `user_manual`, `documentation` |
| `search_library` | Fuzzy search all saved cards by tag, cite, or body |
| `get_cases` | List all cases |
| `get_blocks` | List blocks (optionally filtered by case) |
| `get_cards` | Get cards inside a block |
| `get_opponents` | List saved opponent scouting notes |
| `get_tournaments` | Saved tournament records with round-by-round results |
| `save_card` | Write a card to the Agent Inbox in the Warroom library |
| `fetch_article` | Fetch readable text from a URL (for cutting cards) |
| `search_tabroom_tournament` | Search Tabroom by tournament name |
| `search_judge` | Look up a judge paradigm on Tabroom |

## Not available (require Electron webview)

- `search_logos` — use the in-app Warroom AI for evidence searches
- `search_openevidence` — same

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `WARROOM_DATA_DIR` | `~/Library/Application Support/warroom/warroom` | Where Warroom stores db.json, topics.json, etc. |
| `WARROOM_SKILLS_DIR` | `~/Downloads/warroom/electron/skills` | Where skill .md files live |
