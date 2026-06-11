# Warroom — Claude guidelines

## Work discipline — wait for explicit "start" before implementing

When the user describes a feature, idea, or task, **do not start implementing it unless they explicitly say to start** (e.g. "go ahead", "implement it", "do it", "start"). Discussion, planning, and questions are fine — but no code changes, file edits, or tool calls that modify the project until the user gives a clear go-ahead.

**Treat hypothetical and question-phrased messages as discussion only.** If the message starts with "if", "what if", "could we", "should we", "would it be possible", or ends with a question mark, treat it as curiosity or brainstorming — not a work order. Respond with thoughts/analysis, not implementation. If in doubt, ask before touching anything.

## Naming — always say "Warroom AI", never "Gemini" in user-facing text

In **any user-facing text** — UI strings, skill files, documentation sections the user reads,
error messages, tooltips, onboarding copy, or chat responses — refer to the AI as **"Warroom AI"**.
Never say "Gemini" in user-facing contexts.

**Allowed** (internal/technical only): code identifiers (`GeminiPanel`, `geminiAgentTurn`,
`geminiOpen`), model names in settings keys (`gemini-2.5-flash`), API key labels that match
the actual Settings UI ("Gemini API key", "Gemini model" — because the settings screen says that),
and entries in the technical `documentation.md` skill that describe the implementation stack.

**Not allowed**: "Gemini-powered", "Gemini generates", "ask Gemini", "Gemini will", "powered by
Gemini" in anything the user reads or hears.

## Documentation sync — ALWAYS keep in sync

The in-app documentation page (`src/components/Documentation.tsx`) and the documentation skill
(`electron/skills/documentation.md`) must stay in sync. They cover the same content — one as
React JSX for in-app reading, one as Markdown for Warroom AI to load on demand.

**Any time Documentation.tsx is updated, also update `electron/skills/documentation.md`** to
match — same sections, same information, same level of detail. The skill is the source of truth
for Warroom AI; the React component is the source of truth for what the user reads in-app.
If they diverge, the AI will give outdated technical answers.

Sections in both files (keep both in sync):
Overview · Tech stack · Data model · Navigation & modes · Cases & blocks · Card library ·
Opponents · Tournaments & rounds · Tabroom live monitor · Flows · Speech doc viewer ·
FindCards (Logos) · Open Evidence · Warroom Agent (AI) · Team chat · Google Drive ·
Settings · Storage & security · Architecture · NSDA Topics · AI help guide / Skills

## User manual skill — ALWAYS keep in sync

The full user-facing manual for the app lives at:

```
electron/skills/user_manual.md
```

**Every time a major new feature is added to Warroom — in any chat session — update this file.**
A "major feature" means anything that changes how the user interacts with the app: new views,
new AI tools, new settings, new flows, new keyboard shortcuts, new attachment types, etc.

Keep the manual accurate and complete. If a section is stale (e.g. a feature was removed or
renamed), update or remove it. The Warroom AI reads this file on demand via `get_skill("user_manual")`
and will give users wrong instructions if it is out of date.

The Documentation.tsx in-app docs page also has an "AI help guide" section — update it too if
the nature of what the AI can do changes significantly (see the `doc-ai-guide` section id).

## Suggested prompts in GeminiPanel — ALWAYS keep in sync

The empty-state of the AI panel (`GeminiPanel.tsx`, search for `{ icon:` inside the empty-state
block) shows clickable example prompts. **Every time a major new capability is added to Warroom AI,
add a corresponding entry to that array — even across chat sessions.**

Current entries (keep this table in sync with the array in code):

| Capability | Icon | Suggested prompt |
|---|---|---|
| Evidence search | 🔍 | Find cards on [argument] |
| Card cutting | ✂️ | Cut cards from [URL] |
| Opponent scouting | 🕵️ | Scout [team name] |
| Judge lookup | 👨‍⚖️ | Look up judge [name] |
| Tournament save | 🏆 | Save tournament [name] to my app |
| Case summary | 📋 | Summarize my @case |
| Block suggestions | ⚔️ | What blocks should I read against [position]? |
| Skill builder | 📖 | Save [topic] as a skill |
| App how-to | ❓ | How do I [feature]? |

### Format
```ts
{ icon: '🔍', label: 'Find cards on [argument]' },
```
- `icon` — single emoji that represents the action
- `label` — short imperative phrase; use `[placeholder]` for fill-in parts
- Clicking pre-fills the composer with the label text (brackets stripped), so keep it natural
- Max ~9 entries — keep the list focused, not exhaustive
