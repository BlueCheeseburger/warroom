# Warroom MCP Server

Connects Claude (desktop app or Claude Code) directly to your Warroom data, giving it the same context and tools that the in-app Warroom AI has.

## What this does

The in-app Warroom AI automatically knows your debate event, the current NSDA topic, your saved cases, tournament records, and opponent notes. This MCP server exposes that same data to Claude outside the app, read-only — so you can ask Claude questions about your case, search your saved data, and run practice drills from any Claude interface.

This server is intentionally read-only: it has no tools that write to your Warroom data or hit a live external site (Tabroom judge/tournament lookups). It's meant for reference and troubleshooting, not for driving the app.

## Requirements

- [Warroom](https://github.com/BlueCheeseburger/warroom) installed and launched at least once (creates the data files)
- Node.js 18 or later
- Claude desktop app (for the `claude_desktop_config.json` setup below)

## Setup

**1. Install dependencies**

```bash
cd warroom-mcp
npm install
```

**2. Add to Claude desktop config**

Open `~/Library/Application Support/Claude/claude_desktop_config.json` (create it if it doesn't exist) and add the `mcpServers` block:

```json
{
  "mcpServers": {
    "warroom": {
      "command": "node",
      "args": ["/absolute/path/to/warroom/warroom-mcp/server.js"]
    }
  }
}
```

Replace `/absolute/path/to/warroom` with the actual path where you cloned the repo. On macOS you can get this by running `pwd` inside the `warroom-mcp` folder and dropping the `/warroom-mcp` suffix.

**3. Restart Claude desktop**

After saving the config, quit and reopen Claude. The Warroom tools will appear in the tools list (hammer icon).

## Tools

| Tool | Description |
|---|---|
| `get_warroom_context` | Your debate event + current NSDA topic + tournament/round history. Call this first in any debate conversation. |
| `get_skill` | Load a knowledge file: `cx_debate`, `pf_debate`, `ld_debate`, `card_cutting`, `user_manual`, `documentation` |
| `search_warroom` | Search across cases, opponents, judges, tournaments, and current topics in one query |
| `cross_ex_questions` | Generate cross-examination questions (with model answers) for a speech doc, like the in-app Cross-Ex Practice panel |
| `cross_ex_trap_drill` | Generate a cross-ex trap drill for a speech doc, like the in-app "Harder questions" feature |
| `score_card_credibility` | Score the credibility of a speech doc's cards, like the in-app Card Credibility panel |
| `outweigh_practice_round` | Run one round of the in-app "Outweigh" impact-calculus practice game |
| `fetch_article` | Fetch readable text from a URL (for reading a source or cutting a card from it) |
| `list_flows` | List all saved flows |
| `read_flow` | Read the contents of a specific flow |

**Not available here** (require the in-app Electron webview): `search_logos`, `search_openevidence` — use the in-app Warroom AI panel for evidence searches. Also not available: anything that writes to your data (saving cards, editing flow cells, importing a flow) or hits a live external site (Tabroom judge/tournament search) — those stay in-app only.

## Example prompts

Once connected, try asking Claude:

- *"What's my debate event and current topic?"* — calls `get_warroom_context`
- *"Search my saved data for anything on deterrence"* — calls `search_warroom`
- *"What tournaments do I have saved?"* — calls `search_warroom`
- *"Read my flow from the last round"* — calls `list_flows` then `read_flow`
- *"Quiz me on cross-ex for this speech doc: [pasted text]"* — calls `cross_ex_questions`
- *"Run an Outweigh practice round, varsity policy"* — calls `outweigh_practice_round`

## Custom data path

By default the server reads from the standard Warroom data location for your OS:

| OS | Default path |
|---|---|
| macOS | `~/Library/Application Support/warroom/warroom` |
| Windows | `%APPDATA%\warroom\warroom` |
| Linux | `~/.config/warroom/warroom` |

If your data is somewhere else, pass `WARROOM_DATA_DIR` in the config:

```json
{
  "mcpServers": {
    "warroom": {
      "command": "node",
      "args": ["/path/to/warroom/warroom-mcp/server.js"],
      "env": {
        "WARROOM_DATA_DIR": "/custom/path/to/warroom/data"
      }
    }
  }
}
```

## How it works

The server reads the same `db.json`, `topics.json`, and `app_settings` files that the Warroom Electron app writes to. Changes you make in the app (adding rounds, updating opponent notes, saving a case) are immediately visible to Claude — there's no sync step. The server never writes back to those files.
