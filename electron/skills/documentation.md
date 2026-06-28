# Warroom — Technical Documentation

> This file mirrors the in-app Documentation page (Settings → Documentation).
> Keep both in sync whenever features are added or changed.

---

## Overview

Warroom is a cross-platform desktop application built for competitive debaters. Primarily designed for policy debate but also supports Public Forum (PF) and Lincoln-Douglas (LD). It centralises everything a debate team needs during prep and at tournament: case management, evidence cards, opponent scouting, round tracking, live tournament monitoring, team chat, and Warroom AI.

Runs as a native Electron app on macOS and Windows. All core data is stored locally (no account required for prep features); collaborative features (chat, sharing) use Supabase for real-time sync.

---

## Tech Stack

| Area | Technology |
|------|-----------|
| Runtime | Electron 42 |
| UI framework | React 18 + TypeScript |
| Bundler | Vite via electron-vite |
| Styling | Tailwind CSS + CSS variables |
| State | Zustand |
| Backend/Chat | Supabase (Postgres + realtime) |
| AI | Google Gemini API |
| Docx parsing | mammoth + docx-preview |
| Spreadsheets | xlsx (SheetJS) |
| PDF parsing | pdf-parse |
| Fuzzy search | Fuse.js |
| HTML parsing | cheerio |

### Process architecture

The app follows Electron's two-process model. `electron/main.ts` is the main process — it handles file I/O, secure storage, all network requests to external APIs (Tabroom, OpenCaselist, Debate Land, Gemini, Google Drive), and the Tabroom monitor background worker. `electron/preload.ts` exposes a `window.warroom` IPC bridge to the renderer. The renderer (`src/`) is a React SPA that never makes direct network calls.

---

## Data Model

All local data lives in a single `DB` object (defined in `src/types.ts`) persisted as `userData/warroom/db.json`.

| Entity | Key Fields |
|--------|-----------|
| Case | id · name · side (aff\|neg) · blocks[] · shared? |
| Block | id · caseId · title · type · cards[] · createdAt · updatedAt |
| Card | id · blockId · tag · cite · body · year · flagged · createdAt |
| Opponent | id · teamName · school · teamId · caselist · notes · disclosures · roundsAgainst[] · stats · tabroom_entry_id |
| Tournament | id · name · date · start · end · location · event_type · rounds[] · tabroom_id · tabroom_event_id · tabroomEntryCode |
| Round | id · tournamentId · number · side · opponentId · room · time · result · notes · judgeNotes · argsRead[] · argsWorked[] · argsFailed[] · judgeName · judgeParadigm · autoFilled · isBye |

Relationships use string ID references (e.g. `Block.cards` is an array of Card IDs). The DB root also stores `manualWins` and `manualLosses` for adjusting the W/L record beyond round-derived totals.

---

## Navigation & Modes

Navigation is view-stack-free: one active `View` at a time, stored in Zustand. The sidebar provides top-level navigation; views are rendered by a `Router` function in `App.tsx`. Three "persistent" webviews (FindCards, OpenEv, AgentSearchViews) are always mounted but hidden so they don't reload on navigation.

### Views
- `home` — Dashboard with stats, live/upcoming tournament card, recent cases
- `case` — Individual case editor with all blocks
- `block` — Single block with its evidence cards
- `library` — Full card library across all cases/blocks
- `speech-doc` — In-app .docx viewer
- `tournaments` — Tournament list
- `tournament` — Tournament detail with round list
- `round` — Mission Brief (pre-round prep screen)
- `opponents` — Opponent search & list
- `opponent` — Opponent profile with disclosures, stats, AI scout report
- `settings` — App settings (supports `scrollTo` param)
- `flow` — Spreadsheet flow viewer/editor
- `logos` — FindCards Logos webview (persistent)
- `open-ev` — Open Evidence webview (persistent)
- `gdrive` — Google Drive file browser
- `docs` — In-app documentation page

### App modes
Two modes toggled in the sidebar: **Prep** (default, for case building and scouting) and **Round** (tournament day, streamlined view focused on current round). The mode is persisted per session.

---

## Cases & Blocks

Cases are the top-level unit of prep — an aff or neg position. Each case contains **blocks** (e.g. "T-Topicality", "Heg DA", "2AC vs DA"). Blocks hold individual evidence **cards** (tag + cite + body text + year).

### Card extraction
Cards can be imported from a `.docx` file via AI extraction. The main process parses the file with mammoth, then sends the text to Warroom AI (using the `extractCards` IPC handler) which returns structured `{ tag, cite, body, year }` objects. The cards are created in the selected block.

### Block suggestions
On the Mission Brief (round view), Warroom can suggest which blocks to read against an opponent's positions using `suggestBlocks` — Warroom AI compares the opponent's disclosed arguments against your block list and returns a ranked selection.

---

## Card Library

The Library view aggregates all cards across every case and block. Cards can be searched, filtered by block/case, and flagged. Flagged cards are highlighted for quick reference. Cards can be exported or shared as attachments in team chat.

---

## Opponents

Opponent profiles store scouting data for teams you might face. Each opponent tracks:
- Team name, school, notes
- **OpenCaselist disclosures** — pulled via the OC API: rounds disclosed, aff position name, neg position names, raw round data, raw cite text
- **AI Scout report** — Warroom AI synthesises the OC data into a readable aff/neg summary with citations (stored as `disclosures.aiScout`)
- **Debate Land stats** — career OTR, peak rank, avg speaks, win%, bids, total record (via `window.warroom.dl` IPC)
- Rounds against this opponent (linked by round ID)

### Opponent search
Opponents can be looked up by team name via OpenCaselist full-text search and/or Debate Land search. The app de-duplicates across local DB and search results.

---

## Tournaments & Rounds

### Tournaments
Tournaments store name, dates (start/end), location, event type, and an optional Tabroom tournament ID + event ID for monitor integration. An entry code (e.g. `Emery BL`) is also stored and used by the live monitor.

### Rounds
Each round within a tournament records: round number, side (aff/neg), opponent, room, time, result (win/loss/pending), judge name + paradigm text, and notes. Three argument tracking lists are available: `argsRead`, `argsWorked`, `argsFailed`. Rounds created by the Tabroom monitor are flagged `autoFilled: true`.

### Mission Brief
The round view (`MissionBrief`) is the pre-round prep screen. It shows: opponent info and disclosures, judge paradigm, AI-suggested blocks, and a notes editor. Accessed by clicking a round in the tournament view.

---

## Tabroom Live Monitor

The Tabroom monitor polls Tabroom's public API in the background for new pairings at an active tournament. When a new round is posted it:
- Fires an OS-level notification
- Scrapes the judge's paradigm from Tabroom
- Pulls opponent disclosures from OpenCaselist
- Fetches opponent stats from Debate Land
- Auto-creates the round entry in your tournament (marked `autoFilled`)
- Navigates directly to the new round's Mission Brief

To start: open a tournament → click **Start Monitor** → enter your entry code (the team code used on Tabroom, e.g. `Emery BL`). No Tabroom login required — uses the public pairing API. Requires OpenCaselist credentials (set in Settings) for disclosure fetching.

The monitor runs in the main process (`electron/main.ts`) as a persistent background loop. Events are sent to the renderer via IPC using `window.warroom.tabroom.monitor.onNewRound` etc.

---

## Background Notifications (Daemon)

Warroom's five watchers — followed-judge paradigm updates, opponent disclosure updates, the live Tabroom round monitor, the Tabroom inbox (ballot results), and the NSDA topic scraper — keep notifying **even when the app is closed**. This is handled by a headless background daemon.

**Architecture.** The daemon is the *same* Electron binary relaunched with a `--daemon` flag — the only approach that can decrypt the existing `safeStorage`-encrypted Tabroom / OpenCaselist credentials (a separate binary would hit a different keychain/DPAPI scope). It reuses every fetch helper in `main.ts` (`tbFetchJudgeData`, `ocFetch`, `tbFetchData`/`tbExtractPairings`, `tbInboxFetch`, `scrapeNSDATopics`). Pure helpers live in `electron/daemonShared.ts`.

**Hybrid runtime (cross-platform).** A single OS scheduler entry — macOS: a `launchd` LaunchAgent (`com.warroom.daemon`, `RunAtLoad` + `StartInterval=600`); Windows: a Task Scheduler task (`WarroomDaemon`, `LogonTrigger` + `Repetition` `PT10M`, `MultipleInstancesPolicy=IgnoreNew`, `ExecutionTimeLimit=PT0S`). Each daemon process: on macOS sets `app.setActivationPolicy('prohibited')` (headless, no Dock icon — on Windows a no-window Electron process simply shows no taskbar entry), does **not** take the single-instance lock, runs the periodic judge/opponent/topic checks once (cadence-gated), then — if a tournament monitor is active — enters a resident 60s loop for live round + inbox polling, else exits. Both schedulers won't spawn a second copy while one is resident, so the interval is suppressed during a tournament.

**No double-firing.** The GUI process writes `runtime/heartbeat.json` `{pid, ts}` every 20s (cleared on quit). The daemon treats the app as alive when the timestamp is ≤60s old *and* the pid is live, and **defers all work** while the app is alive — it only takes over when the app is closed/crashed. Periodic cadence is tracked in `runtime/daemon-runs.json` (judges/opponents = 4h, topics = 30m, both processes update it). Live-monitor config + shared seen-round/seen-inbox dedup sets live in `runtime/monitors.json` (written by `tabroom:monitor:start`/`inbox:start`, cleared on stop, expires 18h after `startedAt`).

**Install.** Auto-installed on first launch (packaged builds only) via `ensureDaemonInstalled()`, which dispatches by platform: macOS writes/reloads the plist with `launchctl load -w`; Windows writes a UTF-16LE Task Scheduler XML and registers it with `schtasks /create /xml`, and the NSIS uninstaller (`resources/installer.nsh`) removes the task with `schtasks /delete`. Both show a one-time heads-up and record state in `runtime/daemon-meta.json`. No-op in dev. Windows toast notifications require `app.setAppUserModelId('com.warroom.app')` (set at startup). Status is exposed over IPC at `daemon:status` (`window.warroom.daemon.status()`).

**Deep links.** Clicking a daemon notification spawns the app binary with a `warroom://` argv (routed by the single-instance handler / cold-start argv scan, `shell.openExternal` fallback in dev): `warroom://open/judge/<id>`, `warroom://open/opponent/<id>`, `warroom://open/tournament/<id>?round=<n>`, `warroom://topics/<pf|ld>`. Handled in `handleDeepLink` via the existing renderer events (`scouting:openJudge/openOpponent`, `navigate-to-topics`, `tabroom:monitor:notifClick`).

---

## Flows

Flows are `.xlsx` spreadsheets opened in-app using SheetJS. They appear in the sidebar under a "Flows" section. Opening a `.xlsx` file from Finder/Explorer registers it in the flows index and opens the flow view automatically. Flows can be shared via team chat with view or edit permissions.

Each flow has an ID, name, and debate event type. The flows index is persisted separately from the main DB in `flows_index.json`.

### Importing a flow

An **import button** sits next to the `+` in the sidebar's Flow section. Clicking it opens a file picker for an existing flow spreadsheet (`.xlsx`); the app parses it and creates a new flow named after the file. Each **worksheet (tab)** in the workbook becomes its own flow sheet in the app.

Import is **very robust** — it works no matter how the spreadsheet is laid out. It first tries to auto-detect the structure algorithmically, recognizing speech-column headers (for policy: `1AC`, `1NC`, `2AC`, `2NC/1NR`, `1AR`, `2NR`, `2AR`, plus PF column layouts). Real policy debate has 8 speeches, but the app merges **2NC + 1NR** (the neg block) into a single column, so a standard 8-column source sheet maps cleanly onto the app's layout. If it can't confidently figure out a sheet's structure, it falls back to **Warroom AI** to interpret the spreadsheet and map the columns correctly. Both policy and PF flows are supported.

The imported flow appears in the sidebar and can be renamed and edited like any other flow.

### Editing flows

The flow editor works like a paper flow with spreadsheet conveniences. Cells support **rich text** — `⌘B` for bold, `⌘I` for italic, `⌘U` for underline, and `⌘⇧X` for strikethrough (the standard keyboard shortcuts). Cells **auto-grow** to fit their text.

**Keyboard navigation:** arrow keys move between cells when the caret is at a cell's edge (Up / Down / Left / Right); `Tab` and `Enter` move to the next column / row; `Alt+↑` / `Alt+↓` shift a cell's content between rows.

**Draw arrows:** the curved-arrow toolbar button enters draw mode — click a source cell, then a target cell, to draw a connector arrow linking an argument to its answer across columns (like the line on a paper flow). Click the `×` on an arrow's midpoint to delete it; press `Esc` to cancel. Arrows are saved per sheet.

**Find (`⌘F`):** a find bar searches across all sheets in the flow. Enter / Shift+Enter jump between matches; Esc closes. (Mirrors the speech-doc viewer's find.)

**Undo / redo:** `⌘Z` undoes and `⌘⇧Z` (or `⌘Y`) redoes, also available as toolbar buttons. Undo covers text edits, column changes, colors, and arrows.

**Column colors:** each column header has an always-visible `▾` menu with a color palette to recolor that column; "Reset to default" restores the side color. The default Aff/Pro and Neg/Con column colors can be set for all flows in **Settings → Flow colors**.

### Live collaboration (realtime co-flowing)

The **Live** toolbar button (two-people icon) turns a flow into a shared realtime session — two or more teammates type into the same flow at once and see each other's edits appear **character-by-character**, like Google Docs. A green "Live" pill shows who else is present, and each teammate's active cell is ringed and tagged in their color.

The flow's editable state is mapped onto a **Yjs CRDT** document (`src/lib/flowDoc.ts`). Each cell is a `Y.Text` holding its HTML, so concurrent edits merge deterministically — even two people in the same cell never lose text (the cell *this* user is focused in is left alone until blur, to protect the caret). Layout/structure (columns, colors, variant, sheet names) lives in a `meta` map plus the `sheets` array as last-write-wins.

**Transport.** Yjs update + awareness bytes ride a Supabase *Realtime broadcast* channel keyed by the flow's unguessable id (no per-keystroke DB writes). Durability is a debounced base64 snapshot of the doc in a new `flows` table (team-scoped RLS), so a teammate who opens the flow later — or reconnects — loads the current merged state. The Supabase client lives in the main process; the renderer talks to it via the `flowSync:*` IPC bridge (`src/lib/flowSync.ts` ↔ `electron/main.ts`). Late-join convergence is handled by re-broadcasting full state when a new peer's presence appears. Sharing a live flow sends a *pointer* (same id + team, `live: true`) so recipients join the same doc rather than cloning it; each device keeps a local `flow_data_*` mirror so the flow still works offline. Requires a configured Supabase backend and the `flows` table from `supabase/schema.sql`.

---

## Speech Doc Viewer

The `SpeechDocViewer` renders `.docx` files in-app using `docx-preview`. It is always mounted (hidden when inactive) so it preserves state across navigation. Recent docs are tracked in `localStorage` under `warroom-speech-doc-recents`.

Opening a `.docx` from Finder triggers the `onFileOpen` IPC event and navigates to the speech-doc view. Speech docs can also be attached to chat messages and shared with teammates.

The toolbar also includes **Focus mode** (hides body text, showing only card structure and highlighted/underlined runs), **Outline** (heading navigation, see below), **Find** (in-doc search), **Reading time / auto-scroll**, **Send to Flow** (push a card/heading into a flow sheet, see below), **Cross-Ex Practice**, and **Card Credibility** (see below). The open document's name is always rendered in the toolbar between the tool cluster and the AI-tool pills (`fileName`, `.docx` stripped).

**Office-font substitution.** macOS ships no Calibri, so `docx-preview`'s inline `font-family: Calibri` would fall back to the browser default serif (Times New Roman-like) — wrong for nearly all debate docs. A one-time global `@font-face` block (id `wr-docx-fonts`) redefines the Office families (`Calibri`, `Calibri Light`, `Cambria`, `Cambria Math`) with `local()`-only source chains that resolve to real Office fonts when installed, else metric-compatible open fonts (Carlito/Caladea), else a clean system sans-serif (`Helvetica Neue`/`Arial`) for the sans families. This makes Calibri docs render sans-serif everywhere.

### OpenCaseList-imported cases

Cases imported from an opponent's disclosure (**+ Save to Cases** in the opponent file viewer) are stored in `db.cases` with an `ocSource` object (`teamName`, `label`, `url`, `importedAt`, `byteLen`). The `Router` detects `view.kind === 'case'` with an `ocSource` present (`ocCaseActive`) and routes it to the always-mounted `SpeechDocViewer` instead of the block-based `CaseView`, so it gets the full toolset. The viewer derives the active OC case from `view` + `db` (no second instance), loads the docx via `loadOcCase`, and renders it through the shared `applyRender` path. The docx bytes are cached in `localStorage` under `warroom-oc-docx-<url>` (capped ~2.5 MB/doc), pre-warmed at import time, so reopening is instant and offline — no OpenCaseList re-fetch. The toolbar shows an "Imported from [team]" label and a **Check for changes** button (`checkOcChanges`) that re-fetches, compares byte length against the stored `byteLen`, and reloads + re-caches if it changed. Per-doc state (cross-ex, credibility, dismissed warnings, share) is keyed on a synthetic `oc:<url>` path so it works without a real local file.

### Find (in-document search)

A magnifier toolbar button (or ⌘F / Ctrl+F) opens a find bar. Matches are painted using the **CSS Custom Highlight API** (`CSS.highlights` + `Highlight` + `Range`) rather than by wrapping nodes in `<mark>`, so the document DOM is never mutated — focus mode, the outline `data-outline-id`s, and dark-mode fixes all stay intact. `buildFindMatches` walks text nodes (skipping `data-focus-hidden` ones), builds a `Range` per case-insensitive match (capped at 5000), and registers two highlights: `wr-find` for all matches and `wr-find-active` for the current one, styled via injected `::highlight()` CSS. Enter / Shift+Enter (or the chevrons) move between matches and scroll the active `Range` to center; the bar shows "current / total". Searching is debounced 120ms. Highlights are cleared on close and when a new doc loads.

### Reading time & auto-scroll

An hourglass toolbar button opens a popover estimating how long the document takes to read **aloud** at the user's words-per-minute. The word count is "spoken words" only — `collectSpoken` walks paragraphs and counts a run when its paragraph is a heading (pocket/hat/block/tag), when the run is highlighted, or when it is the leading bold author+date of a cite (the paragraph right after a tag). It deliberately does NOT count plain underlined or generally-bold body text — counting those inflated the estimate ~3× versus Verbatim, which measures highlighted words. This is computed at load; if there is a non-collapsed selection inside the viewer (tracked via a debounced `selectionchange` listener while the popover is open), it counts spoken words within that selection instead. Highlight detection prefers the saved `data-orig-bg` so it still works after dark-mode dimming. The WPM is persisted in `localStorage` under `warroom-reading-wpm` and exposed via `loadWpm`/`saveWpm`; preset chips set ~175 (lay/traditional) and ~300 (flow/spreading) with on-screen guidance. **Auto-scroll** drives `scrollWrapRef.scrollTop` with a `requestAnimationFrame` loop at a rate of `(wpm/60000) * (scrollHeight / docWords)` px per ms, so scroll pace matches reading pace; a floating control pill lets the user pause/resume, change speed live (the loop reads `wpmRef`), or stop. Manual scrolling during playback is detected and the accumulator resyncs to the user's position. Auto-scroll stops on doc reload and viewer unmount.

### Outline (heading navigation)

The **Outline** toolbar button opens a left-hand panel listing every heading in the document — pockets, hats, blocks, and card tags — indented by level, so the user can jump anywhere in one click instead of scrolling. `docx-preview` renders every paragraph as a `<p>` and tags it with a class derived from the paragraph's style id (`docx-render_<styleid-lowercased>`); Verbatim and Word built-in heading styles use style ids `Heading1`–`Heading9`, so heading paragraphs carry classes like `docx-render_heading4`. `buildOutline` scans for `<p>` elements whose class matches `/heading(\d)/i`, stamps each with a stable `data-outline-id`, and records its level + text. Clicking an entry `scrollIntoView`s the matching paragraph and flashes it. A scroll listener on the viewer (throttled with `requestAnimationFrame`) tracks which heading is currently at the top of the viewport and highlights it in the panel. Prev/next chevron buttons live **in the outline header** (not the toolbar) and step through the headings relative to the active one. If a doc uses no heading styles, the panel shows a "No headings found" notice.

**Session-scoped auto-show.** A module-level `outlineAutoShownThisSession` flag makes the outline auto-open only on the **first** document opened per app launch; subsequent docs leave it in whatever state the user last set. The flag resets on app restart (it is not persisted).

**Heading-level collapse.** Like Verbatim's NavPaneCycle, a layers button in the outline header cycles `visibleDepths` from 1 up to the number of distinct heading depths present, then back to 1. Items deeper than `visibleDepths` are filtered out, so the user can collapse a long file to just pockets/hats and expand back. Distinct levels are compressed to consecutive depths (`depthOf`) so an H1→H4 jump doesn't over-indent.

**Highlight-outlier warnings.** `computeHighlightWarnings` measures each card's `highlighted_words / total_body_words` ratio, computes mean + standard deviation across all cards (needs ≥4 cards with bodies ≥20 words), and flags cards >1.5σ above the mean as `'over'` and >1.5σ below as `'under'`. These are cross-referenced into the outline items (a card tag carries both `data-outline-id` and `data-cred-id`) so flagged tags show an amber `WarnBadge` with a popover explaining the issue and a permanent dismiss. Dismissals are stored per-doc in `localStorage` under `warroom-hl-warn-<path>`.

### Send to Flow

A grid-with-arrow toolbar button opens a top-right popover that bridges the speech doc to a Verbatim-style flow (`.xlsx`) sheet, mirroring Verbatim's Send-to-Flow. The user picks a **mode** — `text` (the current selection, or the active heading if nothing is selected) or `shorthand` (the active card's tag plus its cite author+date, extracted by `citeShorthandAfter` from the leading-bold run after the tag) — then a target **flow**, **sheet**, and **column**. The content preview updates live via a `selectionchange` listener. On send, the popover reads `flow_data_<id>` from storage, finds the next empty row in the chosen column (`NUM_ROWS` cap), writes the cell, and saves; column resolution mirrors the FlowView/MCP logic via `flowColumnsOf` (custom columns, else `POLICY_COLS`/`PF_*_COLS`). It then dispatches a `warroom-flow-updated` CustomEvent so an open flow live-reloads. The Send-to-Flow and Reading-time popovers are mutually exclusive (both anchor top-right).

### Cross-Ex Practice

A "Cross-Ex Practice" button in the viewer toolbar opens a right-hand panel that uses Warroom AI to generate targeted cross-examination questions for the open document, each paired with a model answer. The document is run through the same `speechdoc:extract` used by token-saving, giving the AI the **highlighted/underlined text** (what the opponent actually reads) separately from the **full small text**. The `ai:crossExQuestions` handler loads the skill for the user's current event (`cx_debate` for Policy, `ld_debate` for LD, `pf_debate` for PF) so questions use the right vocabulary and strategy.

Question rules enforced by the prompt: questions target highlighted text only (the one exception being un-highlighted small text that directly and completely contradicts highlighted text in the same card); questions are 1-3 sentences and answers 2-4 sentences; no markdown emphasis (key phrases use 'single quotes', rendered bold by `CxText`).

**Aff/Neg sections.** The handler asks the model to decide whether the doc is Aff, Neg, or both — using speech labels (1AC/2AC/1AR/2AR = aff; 1NC/2NC/1NR/2NR = neg) and argument type — and returns `{ groups: [{ side, questions }] }`. Question counts are weighted by how much highlighted content each side has (e.g. 8 aff cards vs 1 neg card → several aff questions, 0-1 neg). The panel renders an Aff / Neg header per group when both sides are present.

### Card Credibility

A shield-icon "Credibility" toolbar button opens a right-hand panel that grades the evidentiary credibility of every card in the open doc. It is **mutually exclusive with the Cross-Ex panel** — opening one closes the other. The renderer extracts cards directly from the rendered DOM via `buildCards`: a "card" is a paragraph at the deepest heading level present (Heading4 in Verbatim docs) used as the tag, plus the following non-heading paragraphs as the cite (capped at ~80 words / 600 chars). Cards are sent **numbered** to the model.

`buildCards` skips any heading with no citation text under it (section headers, blank tags, analytics) using a `wordCount(cite) === 0` check, so only real cards (tag + cite) are scored.

The `ai:scoreCards` handler in `electron/main.ts` takes `{ cards: { tag: string; cite: string }[] }` and returns `{ ok, scores?: { score, verdict, author, recency, source, claim, reason, press }[], error? }`. In **one AI call** the model scores all cards at once and returns a JSON array in the **same order**; results map back to cards by index. Each card gets an overall **score 0–10**, a one-word **verdict** (Strong 8–10 / Solid 6–7 / Shaky 4–5 / Weak 0–3), four sub-scores (**Author qualifications**, **Recency**, **Source quality**, **Claim fit** — whether the cite actually supports the tag's claim), a short **reason**, and a **"press"** line — the single best cross-examination attack on that card's credibility. The prompt gives the model an explicit rubric per factor: author scored by **domain match** (with org reputation as a proxy when no individual credentials are stated — RAND/CBO/CRS high, ideologically-aligned think tanks mid, media low), recency by **topic-specific decay rate** (geopolitics decays fast, theory slow), and source by a publication-quality hierarchy.

The call uses `callAI(prompt, 'balanced')`. The **balanced tier** is the user's selected model from Settings, but never the cheapest "lite" model — e.g. Gemini 2.5 Flash Lite is bumped up to Gemini 2.5 Flash (analogously for OpenAI/Anthropic). The prompt instructs the model to judge author and source **only** from what the cite text states and to **never fabricate** credentials, dates, or outlets.

Results are cached per document in `localStorage` under the key `warroom-cred-<path>`, keyed by a content hash (`hashCards`, which hashes the tag text only — cite text can vary slightly between renders) so the cache is invalidated when the doc's cards change; this makes reopening instant and free. `loadCred`/`saveCred` read and write the cache, and a **Re-score** button forces a fresh pass. The panel lists each card with a colored score chip and a chevron affordance; clicking a card expands its four sub-score bars, reason, and press line. Over/under-highlighted cards (from `computeHighlightWarnings`, see Outline) also surface a dismissible highlight warning with the exact percentage in the expanded view. A **Go to card in document** button scrolls the doc to that card and flashes it.

Each question renders as a pill with:
- A **Show answer** disclosure that reveals the model answer (and the strategic follow-up) — hidden by default.
- A **3 more like this** button that calls `ai:crossExQuestions` again with the question as a `basedOn` seed (scoped to that side), inserting three fresh questions inline below.

**Short-doc warning.** After extraction the panel checks word counts and warns if there's very little highlighted text (under ~120 words) or the doc is short overall (under ~400 words), explaining you'll get few/shallow questions.

**Harder questions (trap drill).** A second footer button opens an interactive trap drill. `ai:crossExTraps` (balanced tier) generates 3 traps — each a setup question that baits a wrong answer, with a gotcha follow-up, ideal answer, and lesson. The user types an answer; `ai:crossExGradeTrap` (lite / flash-lite tier, to keep per-answer grading cheap) returns a verdict (`avoided` / `fell` / `partial`) plus tailored feedback — confirming how they avoided the trap, or springing the gotcha and giving the fix.

The panel's **Generate / Regenerate** action and the **Harder** button live in the footer. Generation uses the `balanced` model tier. Grouped questions (including any "3 more like this" inserts) are persisted per-document in `localStorage` under `warroom-cx-questions-<path>`, so they survive closing/reopening the panel, reloading the doc, and app restarts — they are only cleared when the user regenerates. Traps are ephemeral (regenerated each time the drill opens).

---

## Impact Calc

Impact Calc is a full-screen hub for everything impact-weighing. Open it from the **Impact Calc** card on the home screen. It has two areas: **Practice** (the Outweigh game) and **Tools** (the doc-comparison analyzer, plus Impact Library and Head-to-head Matchups, which are coming soon).

### The Outweigh game
A practice drill where you spar with Warroom AI over impact calculus. Pick a difficulty:
- **Novice** — concrete, intuitive impacts (recession, an outbreak, a regional conflict); no theory.
- **JV** — classic policy impacts (nuclear war, bioweapons, hegemony); engage scope, probability chains, timeframe, reversibility.
- **Varsity** — extinction/existential matchups and framework wars; you must win the metric before the calc resolves.

The round runs in three beats:
1. **Your impact** — Warroom AI presents its impact (claim, warrant, and ratings on the four dimensions). You write your own impact and a short calc explaining why yours outweighs.
2. **AI rebuttal** — Warroom AI delivers a tight 1–2 minute rebuttal speech, defending its impact and attacking yours on a specific dimension. You get a final shot (the last word) with a 60-second pressure timer that never auto-submits.
3. **Decision** — a judge calls the round: who won, a 1–10 score on your calc work, a written verdict, dimension-by-dimension feedback, and concrete tips.

The game is powered by `ai:outweighScenario`, `ai:outweighRebuttal`, and `ai:outweighJudge` in the main process.

### Compare two docs (Tools)
The original analyzer compares two of your own cases, speech docs, or a flow:
1. Pick **Your doc** and **Their doc** (a case, an imported speech doc, or a flow — only one flow per comparison).
2. Click **Analyze Impact Calc**. Warroom AI extracts every impact claim from both, finds the direct clashes, and weighs them across all four dimensions.

Reading the results:
- **Clashes** — each row matches one of your impacts against the opponent impact it directly competes with.
- **Dimension winners** — for each clash, a winner is called on magnitude, probability, timeframe, and reversibility.
- **Overall verdict** — a summary declaring which side wins the exchange and why, suitable for a final rebuttal.

Saved comparisons are listed for one-click reopening. The comparison tool is powered by `ai:compareImpactsText`. Everything in Impact Calc runs on the best model tier (your selected model, never Flash Lite).

---

## FindCards (Logos)

`FindCards` is a persistent Electron `<webview>` pointing at Logos evidence search. The view is always mounted off-screen; navigating to `logos` makes it visible. Warroom AI can also trigger Logos searches programmatically via the agent search registry without disturbing the user-visible view (using a second hidden webview in `AgentSearchViews`).

---

## Open Evidence

Similar to FindCards — a persistent webview pointing at Open Evidence (openev.net). Warroom AI can search Open Evidence via a dedicated hidden webview without affecting what the user sees. Files from Open Evidence can be downloaded and saved locally via the `opencaselist.fetchFileToTemp` IPC bridge.

---

## Warroom Agent (AI)

Warroom AI is an agentic AI assistant that lives in a resizable right-side panel (`GeminiPanel`). It supports multi-turn conversation and tool calls.

### Model selection
- **Gemini 2.5 Flash Lite** — cheapest, fastest; auto-enables token saving
- **Gemini 2.5 Flash** — default; best balance of cost and quality
- **Gemini 3.5 Flash** — highest quality; best for complex analysis

Agentic tasks (tool calls, sub-agent searches) always use Gemini 2.5 Flash regardless of the model selection above.

### @mentions / attachments
Type `@` in the chat input to attach context from your local data:
- `@case` — attach a full case
- `@block` — attach a block's cards
- `@flow` — attach a flow spreadsheet
- `@opponent` — attach opponent profile / disclosures
- `@member` — mention a team member
- `@image` — paste an image from clipboard
- `@speechdoc` — attach a speech doc

### Token saving
When attaching a speech doc, "token saving" mode sends only underlined text, citations, and headings (not small body text) to reduce token usage. Auto-enabled for Flash Lite. Can be toggled globally in Settings or per-conversation.

### Agent tool calls
Warroom AI can call the following tools during a conversation:
- `get_skill(skill_name)` — loads a skill .md file (cx_debate, pf_debate, ld_debate, card_cutting, user_manual, documentation, or user-added custom skills)
- `search_logos` — searches the Logos debate evidence database via a hidden webview in `AgentSearchViews`
- `search_openevidence` — searches the Open Evidence Project via a second hidden webview in `AgentSearchViews`
- `save_card_to_library` — saves a card with full verbatim body text to the `__agent_inbox__` block inside the `__agent__` case ("Agent Saves")
- `fetch_article` — fetches and extracts text content from a URL (for cutting cards from web sources)
- `search_warroom` — searches the user's saved Warroom data: cases (with extracted content keywords), opponents (disclosure titles, aff/neg names), judges (paradigm), tournaments, speech docs, and current topics. Use when the user asks to find something in their prep files. Returns ranked results grouped by type.
- `search_tabroom_tournament` — searches Tabroom for tournaments by name
- `get_tournament_details` — fetches full info for a Tabroom tournament by numeric ID
- `save_tournament_to_app` — saves a Tabroom tournament to the user's tournament list
- `search_judge` — looks up a judge on Tabroom by name and returns their paradigm
- `write_skill` — creates/updates a custom skill .md file in the user's skills folder
- `navigate_app` — opens any view for the user (top-level views, or a case/block/opponent/tournament/flow resolved by name)
- `list_flows` / `read_flow` — list flow sheets and read a flow's columns + filled cells
- `edit_flow_cell` — writes a single cell in a flow sheet (by flow name, column header, 1-based row). Writes to `flow_data_<id>` storage and dispatches a `warroom-flow-updated` event so an open FlowView reloads live.

The agent runs 3–5 searches per evidence request in parallel. Saved cards always use the complete verbatim card body — never a summary. The save handler validates the body is non-empty before writing to the DB.

### Chat sessions
Each conversation has an auto-generated title (generated after the first exchange). Sessions are stored locally. The active session ID is tracked in Zustand as `geminiActiveId`.

---

## Team Chat

Team chat uses Supabase for real-time messaging. It appears in a resizable panel on the right side (separate from the Warroom AI panel). Features:
- Team creation with invite codes; members can join/leave; owner can kick members
- Channel messages and direct messages (DMs) between team members
- Message editing and deletion
- Attachments: cases, blocks, flows, opponents, images, speech docs — shared with edit or view permissions. Clicking received attachments expands a content preview; "+" button imports to your library.
- Round references in messages (link to a specific round)
- Unread count badge on the chat icon in the sidebar
- User lookup by email via `lookupUserByEmail`

### Auth
Chat uses Supabase auth (email + password). Credentials are stored encrypted on device via `safeStorage`. Sign-in state is cached in `localStorage`.

### Chat width
The chat panel is resizable (260–600 px, default 320 px). Width is persisted in `localStorage` as `warroom-chat-width`.

---

## Google Drive Integration

Google Drive lets you browse your Drive files in-app and open Word docs or spreadsheets directly. Setup requires creating a Desktop OAuth app credential in Google Cloud Console.

### Setup flow
1. Enter OAuth Client ID and Client Secret in Settings → Google Drive
2. Click "Connect Drive" — the app opens a browser OAuth flow
3. After authorization, tokens are stored encrypted via `safeStorage`

### Capabilities
- List and paginate Drive files
- Search files by name
- Fetch a file's content (base64) for in-app rendering
- Upload a local spreadsheet as a Google Sheet
- Open `.docx` files in the Speech Doc Viewer
- Open `.xlsx` files in the Flow viewer

---

## Settings

| Setting | Description |
|---------|-------------|
| Debate event | HS Policy · HS LD · HS PF · College Policy (NDT/CEDA) · College LD (NFA-LD) |
| Gemini API key | Stored encrypted. Powers card extraction, block suggestions, and Warroom AI. |
| Gemini model | Flash Lite / Flash (default) / 3.5 Flash |
| Token saving default | Auto-strips small body text from speech doc attachments to the Agent. |
| OpenCaselist login | Same as Tabroom.com credentials. Required for opponent scouting and Open Ev. |
| Google Drive | OAuth Client ID + Secret. Requires Desktop app type in Google Cloud. |
| Chat | Shows current user; sign-out button. |
| Sharing default | Can edit (default) or Can view — applied when sharing via chat. |
| Flow colors | Default Aff/Pro and Neg/Con column colors applied to all flows. |
| Setup wizard | Re-runs the onboarding flow. |

---

## Storage & Security

### Local data
- `userData/warroom/db.json` — main database (cases, blocks, cards, opponents, tournaments, rounds)
- `userData/warroom/flows_index.json` — list of open flows with metadata
- `userData/warroom/app_settings.json` — debate event, Gemini model, token saving
- `userData/warroom/secure_*.json` — encrypted secrets (Gemini key, OC credentials, GDrive tokens, chat credentials)
- `userData/warroom/skills/` — user-added skill files (.md)

### Secure storage
Sensitive values (API keys, passwords, OAuth tokens) are encrypted with Electron's `safeStorage` (OS keychain-backed AES encryption). In dev mode, base64 fallback is used since the safeStorage key changes on each rebuild.

### Encrypted chat
All team-chat and DM content is end-to-end encrypted before it leaves the client. Message text and every shared attachment (cases, blocks, flows, opponents, tournaments, speech docs) are encrypted client-side with AES-256-GCM; Supabase only ever stores ciphertext. Each team has one symmetric key, derived from the team's invite code via PBKDF2 (200k iterations, SHA-256, salted with the team id) — implemented in `src/lib/chatCrypto.ts`. Because every member already knows the invite code, everyone derives the identical key with no key-distribution handshake, and the key is never transmitted or persisted on a server. Encryption/decryption happen in `Chat.tsx` (load, realtime, send, edit for both rooms and DMs) and `SharePanel.tsx` (share-to-room / share-to-DM). Ciphertext is tagged with a `wre1:` prefix so legacy plaintext rows decrypt transparently (anything without the prefix is passed through). Metadata — sender name, timestamps, attachment `name`/`type` — stays plaintext for display; only `content` and attachment `data` are encrypted. Warroom AI does not read team-chat history, so no plaintext chat is sent to the AI provider.

### Path safety
IPC handlers that read arbitrary file paths maintain a `trustedPaths` set — only paths originating from a file dialog or internally-generated temp files are accepted. This prevents a compromised renderer from reading arbitrary disk paths.

### File writes
JSON writes use a write-then-rename pattern (`db.json.tmp` → `db.json`) to prevent data loss on crash.

---

## Architecture

### IPC bridge (`window.warroom`)
The preload script exposes a typed `window.warroom` namespace with these sub-namespaces:

| Namespace | Purpose |
|-----------|---------|
| `storage` | read/write JSON files in userData |
| `secure` | get/set encrypted values |
| `dialog` | open file dialog, save buffer to disk |
| `ai` | extractCards, suggestBlocks, teamSummary, parseRoundEmail |
| `clipboard` | readImage (for pasting screenshots into Agent) |
| `opencaselist` | login, search, rounds, cites, file fetch/save |
| `shell` | openPath, openBuffer (open files in external app) |
| `fs` | readFileBytes, writeTempFile (for trusted file operations) |
| `dl` | searchTeam, getTeamStats (Debate Land) |
| `tabroom` | getTournament, getEntries, getPairings, fetchTournament, searchTournaments, fetchParadigmByName, searchJudges, monitor.* |
| `chat` | all Supabase chat + AI operations, geminiAgentTurn |
| `agent` | fetchArticle |
| `skills` | list, read |
| `gdrive` | status, connect, disconnect, listFiles, searchFiles, fetchFile, uploadAsSheets |
| `platform` | `'darwin'` or `'win32'` |
| `onFileOpen` | subscribe to file-open events from the OS |

### Zustand store (`src/store/appStore.ts`)
Single global store (`useApp`) holds: DB state, current view, mode, theme, event type, flows index, chat state (user, team, members, unread count), Gemini panel state (geminiOpen, geminiActiveId), onboarding state, and the agent search function registry.

### Persistent webviews
Three Electron `<webview>` elements are always mounted to avoid reloads: `FindCards` (Logos), `OpenEvView` (openev.net), and two agent search webviews in `AgentSearchViews`. They use CSS `display: none` (not React unmounting) to hide/show.

### Tabroom monitor flow
Main process polls Tabroom every ~30s. On a new pairing, it fires parallel requests for judge paradigm (Tabroom scrape), OC disclosures (OC API), and DL stats. Results are bundled into a `TabroomRoundBrief` and sent to the renderer via IPC. `App.tsx` handles the event: deduplicates, upserts the opponent, creates the round, and navigates.

---

## NSDA Topics

Warroom monitors **speechanddebate.org/topics/** for the latest Policy, Public Forum, and Lincoln-Douglas resolutions.

### Topic monitor
- On every app launch, Warroom checks whether a new topic has dropped and updates stored data.
- PF and LD topics drop on known dates (Aug 1, Oct 1, Dec 1, etc.) at 9:00am CT. The app polls aggressively only on release days — up to every 2 minutes in the 30-minute window after release time.
- When a new topic is detected, a **desktop notification** fires immediately. Clicking it opens the Topics screen.
- A vivid **in-app banner** appears at the top of the window (amber for PF, red for LD) with a pulsing indicator and the full resolution text. It persists until dismissed.

### Topic brief
- When a new topic drops, an AI-generated brief is automatically requested. It covers: resolution breakdown, Aff/Neg arguments, frameworks, core clash, research priorities, and pitfalls.
- The brief can be regenerated at any time from the Topics screen.
- Requires a Gemini API key in Settings → API Keys.

### Policy topic context
The current Policy topic is injected into every Warroom AI conversation as system context, so the agent always knows what resolution is being debated without you needing to state it.

---

## AI Help Guide & Skills

Warroom AI can answer any "how do I…" or "where is…" question about the app. It loads knowledge from skill files on demand using `get_skill(skill_name)`.

### Built-in skills
| Skill | Content |
|-------|---------|
| `cx_debate` | Policy/CX format, speech order, DAs/CPs/Ks/T, judging paradigms |
| `pf_debate` | PF format, speech order, crossfire, weighing, lay judging |
| `ld_debate` | LD format, value/criterion framework, speech order, national vs traditional circuit |
| `card_cutting` | Verbatim card format: exact cite rules, tag format, body underlines, full example |
| `user_manual` | Complete Warroom app user guide |
| `documentation` | This file |

### Custom skills
Users can add their own skills by dropping `.md` files into `userData/warroom/skills/`. User skills override built-in defaults with the same name. See `electron/skills/HOW_TO_WRITE_SKILLS.txt` for the full tutorial.
