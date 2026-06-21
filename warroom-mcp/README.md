# Warroom MCP Server

Connects Claude (desktop app or Claude Code) directly to your Warroom data, giving it the same context and tools that the in-app Warroom AI has.

## What this does

The in-app Warroom AI automatically knows your debate event, the current NSDA topic, your saved cards, tournament records, and opponent notes. This MCP server exposes all of that to Claude outside the app — so you can ask Claude questions about your case, look up judges, cut cards, and search your library from any Claude interface.

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
| `search_library` | Search your saved cards by tag, citation, or body text |
| `get_cases` | List all your cases |
| `get_blocks` | List blocks in a case |
| `get_cards` | Get all cards in a block |
| `get_opponents` | List saved opponent scouting notes |
| `get_tournaments` | Your saved tournament records with round results |
| `save_card` | Save a card to your Warroom library (writes to Agent Inbox) |
| `fetch_article` | Fetch readable text from a URL (for cutting cards from links) |
| `search_tabroom_tournament` | Search Tabroom.com for tournaments by name |
| `search_judge` | Look up a judge's paradigm on Tabroom |
| `list_flows` | List all saved flows |
| `read_flow` | Read the contents of a specific flow |
| `edit_flow_cell` | Edit a cell in a flow |
| `cross_ex_questions` | Generate cross-examination questions for a speech doc |

**Not available here** (require the in-app Electron webview): `search_logos`, `search_openevidence` — use the in-app Warroom AI panel for evidence searches.

## Example prompts

Once connected, try asking Claude:

- *"What's my debate event and current topic?"* — calls `get_warroom_context`
- *"Look up judge Jane Smith's paradigm"* — calls `search_judge`
- *"Search my library for cards on deterrence"* — calls `search_library`
- *"Cut a card from [URL]"* — calls `fetch_article` then formats the card
- *"Save this card to my library: [tag / cite / body]"* — calls `save_card`
- *"What tournaments do I have saved?"* — calls `get_tournaments`

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

The server reads the same `db.json`, `topics.json`, and `app_settings` files that the Warroom Electron app writes to. Changes you make in the app (saving cards, adding rounds, updating opponent notes) are immediately visible to Claude — there's no sync step. Cards saved via `save_card` appear in the **Agent Inbox** block inside Warroom the next time you open the app.
