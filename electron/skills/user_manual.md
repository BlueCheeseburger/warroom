# Warroom App — User Manual

## Overview
Warroom is a desktop debate prep app for Policy, LD, and PF. All core data (cases, cards, opponents, tournaments) is stored locally — no account needed for prep features. Team chat and sharing use a cloud backend. Includes Warroom AI, an agentic AI assistant.

## Navigation
Sidebar icons switch between views: Home, Cases/Library, Opponents, Tournaments, Flows, Speech doc, Chat, Find Cards (Logos), Open Evidence, Google Drive, Topics, Settings — everything is always reachable at once, there's no mode to switch. AI panel = star icon in title bar. Team chat = chat icon next to it.

---

## Undo
Deleting a case, block, card, tournament, round, opponent, flow, flow sheet, saved AI chat,
saved impact calc, impact library entry, or folder shows a small toast in the bottom-left
corner: "Deleted 'X'" with an **Undo** button, active for 3.5 seconds. Click Undo to restore it
exactly as it was. If you don't click it, the toast disappears and the delete stands — no
action needed either way. Chat/DM messages and flow column/arrow edits don't get this toast
(they're either synced live or too fine-grained to interrupt).

## Global Search
Press **⌘K** (Ctrl K on Windows), or click the **Search** bar below Home in the sidebar, to open a command-palette search across your whole app.

- **Searches everything**: cases (name + extracted content keywords), speech docs (file name + content keywords), flows (every cell), opponents (team, school, notes, disclosure titles — file names only, never file contents), judges (paradigm), tournaments, current topics, and your AI chat history.
- **Ranked, grouped results** with fuzzy matching — type a word or phrase and pick a result to jump straight to it.
- Opening a matched case or speech doc **auto-opens the in-document find** on your search term; a matched opponent disclosure **auto-scrolls and highlights** the term in its title.
- **Numbers above 10 are searchable** (e.g. a `$1,500,000` plan figure); the tiny words and 1–10 are filtered out as noise.
- The footer has one-click **external searches** for your query: Logos, Google Scholar, and Open Evidence.
- You can also just ask **Warroom AI** to "search my files/cases for X" — it runs the same search via its `search_warroom` tool (speech docs, flows, and chat history are app-only, so use ⌘K directly for those).

**Searching the docs:** on the Documentation and User Manual pages, press **⌘F** (Ctrl F) to find text on the page — Enter / Shift+Enter move between matches, Esc closes.

---

## Cases & Blocks
Cases are top-level positions (Aff or Neg). Each holds blocks (e.g. "T – Topicality", "2AC vs Heg DA"). Blocks hold evidence cards (tag + citation + body text + year).

- **Create a case**: + button in sidebar under Cases, or "New case" on the home screen
- **Add a block**: open a case → "+ Add block"
- **Add cards manually**: open a block → "+ Add card"
- **Import cards from a file**: open a block → "Import from file" → pick .pdf or .docx → AI extracts cards automatically
- Cards older than the staleness threshold (default 4 years, adjustable in Settings → General) are automatically flagged (highlighted in amber) as potentially outdated
- **Share via chat**: open case/block → share button to send as attachment

---

## Cases Grid
Click **Cases** in the sidebar and you get the whole library at once — every case you've built and every document you've imported, laid out as a grid of page previews. Each tile shows the actual first page, the way Google Docs shows you a document before you open it, so you can find the right doc by recognising it instead of reading file names. Click any tile to open it.

### Folders
Make a folder to group things however you think about them — by tournament, by argument, by side, whatever fits.

- **Make a folder**: use the new-folder button at the top of the grid, then give it a name
- **File a document**: drag its tile onto a folder — or drag it onto a folder in the sidebar
- **Open a folder**: click it, in the grid or in the sidebar
- **Nest folders**: drag one folder into another; they can go as deep as you like
- **Rename or delete**: hover a folder in the grid — Rename and Delete appear on the tile

Folders also appear in the sidebar under Cases, as a tree you can expand and collapse (there's a bigger click target on the arrow now, so it's easier to hit). Whatever you file in one place shows up in the other immediately — it's the same set of folders, just two ways of looking at it.

### Selecting, moving, and deleting multiple documents
Hold **⌘ (or Ctrl)** and click cases or docs — in the grid or the sidebar — to select several at once. A bar appears with **Move to** (file everything selected into one folder in one go) and **Delete**.

For one document at a time, **right-click** it (in the grid or the sidebar) for a menu with **Move to**, **Rename**, and **Delete** — the same menu either place.

### Folders never touch your files
A folder is just a label. Filing a document into one does **not** move it, copy it, or change it on disk — it only changes where Warroom shows it to you. That means nothing you do here can lose a document.

The same goes for deleting a folder: **your documents stay**. Deleting only removes the grouping, and everything that was inside moves up a level to wherever the folder used to be. If you want to get rid of a document itself, delete the document, not the folder.

### Finding things
Search from the grid looks across **every folder at once**, not just the one you're standing in — so you never have to remember where you filed something to get back to it.

---

## Cards
(Called "Cards" in the sidebar — the Library/All cards view.) All cards across every case and block in one view. Search by tag, citation, or body text. Flag/unflag cards with the flag icon. Click any card to jump to the block it lives in.

### Cut a card with Warroom AI (guided)
There's a **＋** button next to **Cards** in the sidebar (just like the one next to Cases). It opens a guided card cutter where Warroom AI does the repetitive highlighting/underlining and you steer what the card is about.

**First, save the article:**
- **Press ⌘S / Ctrl+S and save it as a Webpage (HTML)** — recommended, because the **images come with it**.
- Or **Print → Save as PDF** for **text only** (no images).

**Then cut:**
1. Click **＋** next to Cards and pick the saved `.html` page (or `.pdf`).
2. **Warroom AI reads the source** — it pulls the cite (author, quals, date, title, URL), strips the page down to the real article body, and gathers the article's images (using alt text, ignoring ads/logos).
3. **Choose the body.** Highlight the passages you want in the card and release — selections stack. Hover any selection and click **✕** to remove it. Open the **Pictures** dropdown to add any images (the ones Warroom AI thinks belong to the article are marked "suggested").
4. **Tell Warroom AI the plan.** Type what you're using the card for and pick a **highlight color (yellow / cyan / neon green)**, then click **Cut card**.
5. **Warroom AI cuts it** — it decides what to **underline** (read aloud), **highlight** (most important), and shrink to **small text** (kept for context, not read), and proposes **one or two taglines**. If it's genuinely unsure how to cut the card — usually because you left the plan blank and the passage supports more than one distinct argument — it'll ask you a quick clarifying question with a couple of options instead of guessing. Pick one (or type your own) and it finishes the cut. It only asks once.
6. **Review & fix.** Pick a tagline or write your own, edit the cite/year, and use the mini editor to fix the emphasis: select text and hit **Underline / Highlight / Small / Clear**. You can't change the words (the body stays verbatim) — only the formatting.
7. Click **Save card**. It lands in the **"Cut Cards"** case and shows up in the Cards view with its formatting intact.

Notes: HTML keeps images, PDF is text-only. Scanned/image-only PDFs have no selectable text to cut. Neon green highlight counts as "read aloud" everywhere in Warroom, alongside yellow and cyan. This needs a working AI key (Settings → API Keys).

---

## Opponents
Opponent profiles store scouting data.

- **Create**: Opponents → "+ New opponent" → type team name and school
- **Auto-scout**: click "Scout" on a profile → pulls OpenCaselist disclosures + Debate Land stats (requires OC login in Settings)
- **AI Scout Report**: auto-generated from disclosure data — gives Aff/Neg argument summary
- **Debate Land stats caching**: once matched, stats are saved and never re-searched automatically on later visits; if no team matches, that "no match" result is also remembered for 24 hours so reopening the profile doesn't re-search every time. Picked the wrong team? Click **Wrong team? Search again** next to the saved stats to reopen search without losing your current stats until you actually pick a new match — **Cancel**/**Keep current** backs out with no changes.
- **Notes**: add free-text notes to any opponent profile
- Rounds against a specific opponent are automatically linked

---

## Judge Scouting
- Ask me: "Look up judge [name]" — I'll pull their Tabroom paradigm directly
- Or: open a round → enter judge name → paste their paradigm → "Analyze paradigm"
- The Tabroom Live Monitor fetches paradigms automatically when a new pairing is posted

---

## Notes: private + team panels, tagging
An opponent or judge's Notes section shows a row of pills at the top — **Private**, plus one per team you're on — each toggling its own note panel on or off. A panel opens itself automatically the first time it has content, and then stays open for the rest of your session (even if you later clear its content) until you close it yourself or restart the app. With two or more panels open they sit side by side; with just one, it takes the full width. If you're in two teams that happen to share a name, their pills get a short suffix so you can tell them apart.

- Type **@** in any note box to attach a speech doc, flow, case, opponent, or judge — the same picker as @mentions in Team Chat. Pick an item and it becomes a small clickable chip below the box (your "@search" text is removed, since the tag lives as a chip, not as text).
- Click a chip to open what it points to. Click the **×** on a chip to remove it.
- **Private notes**: the tag stays on your device only, pointing at your local copy — nothing is uploaded.
- **Shared (team) notes**: the tag is uploaded to your team, so it's there next time a teammate opens that opponent/judge. Tagging an OpenCaselist-imported case is instant since it's already fetchable by link. If a tagged flow isn't in your app yet, opening the chip imports a copy for you. If a tagged opponent/judge isn't in your list yet, opening the chip takes you to Scouting so you can search for them.
- **Tagging a local speech doc**: if that exact file is already in your team's **Team Files**, it's reused automatically — no upload, no prompt. Otherwise you're asked *"Also add '[name]' to Team Files?"* — **Add** puts it in Team Files (so it's browsable there too, not just via this tag) and the tag points at it; **Skip** attaches it to just this tag instead, same as before.
- Tags don't update live — like the shared notes themselves, a teammate sees your new tag the next time they open that opponent/judge, not instantly.

---

## Tournaments & Rounds

- **Add tournament**: Tournaments → "+ New tournament"
- **Add round**: open tournament → "+ Add round"
- **Round fields**: number, side (Aff/Neg), opponent, room, time, result (W/L/pending), judge, paradigm, notes
- **Mission Brief**: click any round → pre-round prep screen with opponent disclosures, judge paradigm, AI block suggestions, notes editor
- **"Generate briefing"**: creates an AI-generated strategic prep document for that round
- Ask me: "Look up [tournament name]" — I'll search Tabroom and save it to your app automatically

---

## Tabroom Live Monitor
Auto-tracks new pairings during a tournament.

- **Setup**: open tournament → "Start Monitor" → enter your entry code (e.g. "Emery BL" — the team code from Tabroom). No Tabroom login required.
- **On new pairing**: fires OS notification, fetches judge paradigm, pulls OC disclosures, grabs Debate Land stats, creates round entry, navigates to Mission Brief automatically
- Requires OpenCaselist credentials in Settings for disclosure fetching

---

## Background Notifications
Warroom keeps notifying you **even when the app is closed** — for all five watchers:

- **Followed judges** — get alerted when a saved judge updates their Tabroom paradigm
- **Opponents** — get alerted when a saved opponent posts new disclosure on OpenCaselist
- **Tabroom live monitor** — new-round pairing alerts during a tournament
- **Tabroom inbox** — win/loss ballot-result alerts as they're posted
- **NSDA topics** — new resolution alerts the moment a topic drops

How it works:
- A small background helper installs itself automatically the first time you open Warroom (macOS and Windows) — you'll see a one-time "Background alerts are on" notification. Nothing else to set up. (On Windows it's removed automatically when you uninstall Warroom.)
- While a tournament monitor is running it checks every ~60 seconds for fast round/result alerts; otherwise it checks for judge, opponent, and topic updates periodically.
- When Warroom is open, the app handles notifications itself — the helper never sends duplicates.
- **Tap any notification** to jump straight to the judge, opponent, round, or topic — Warroom opens automatically if it was closed.
- It uses your saved Tabroom and OpenCaselist logins (from Settings) for the checks, just like the in-app monitor.

---

## Speech Timer
Built into the title bar at the top of the app — always visible, no need to navigate anywhere.

- **Select speech type**: click the speech label dropdown (e.g. "Constructive", "Cross-Ex") to pick which speech to time
- **Start / pause**: click the time display to start or pause the countdown
- **Reset**: click the reset button next to the timer
- **HS / CLG toggle** (policy only): a small "HS" or "CLG" pill left of the dropdown switches between high school and college speech times
- Times auto-match your debate event (policy, PF, or LD)

Speech times by event:

| Event | Speech | Time |
|---|---|---|
| Policy HS | Constructive | 8:00 |
| Policy HS | Cross-Ex | 3:00 |
| Policy HS | Rebuttal | 5:00 |
| Policy CLG | Constructive | 9:00 |
| Policy CLG | Cross-Ex | 3:00 |
| Policy CLG | Rebuttal | 6:00 |
| PF | Constructive | 4:00 |
| PF | Crossfire | 3:00 |
| PF | Rebuttal | 4:00 |
| PF | Summary | 3:00 |
| PF | Grand CX | 3:00 |
| PF | Final Focus | 2:00 |
| LD | AC | 6:00 |
| LD | CX | 3:00 |
| LD | NC | 7:00 |
| LD | 1AR | 4:00 |
| LD | NR | 6:00 |
| LD | 2AR | 3:00 |

The timer turns amber in the last 30 seconds and red when time is up (overtime counts up).

**Warroom AI can control the timer** using the `control_timer` tool. Say things like:
- "Start the timer" / "Pause" / "Reset the timer"
- "Set the timer to 1AR" / "Switch to Crossfire"
- "Switch to college times" (policy only)
- "What's the timer at?" / "How much time is left?"

### Coin Flip
A photorealistic minted-coin icon sits just left of the timer. Click it, then click **Flip** — the coin spins and lands on heads or tails.

**It's a genuine 50/50 flip.** The result is chosen randomly the instant you click, before the animation even starts — the spin you watch is just for show and never influences which side it lands on.

### Touch Bar (macOS)
If your Mac has a Touch Bar, the timer, coin flip, and search also show up there — the same controls, mirrored onto the hardware strip, not a separate feature. You get: a search button, a flip button, the current speech name (tap to move to the next speech), the live countdown, **−15s** / **+15s** buttons, play/pause, and reset.

Two things work a little differently on the Touch Bar, both just because of what that hardware can do: the coin's spin animation plays on your actual screen (the Touch Bar can't show it), so tapping "Flip" there opens the same popup and flips it for you to watch normally. And since you can't type on the Touch Bar, custom times are set with the +/− buttons instead of typing a number.

---

## Flows
.xlsx spreadsheets opened in-app.

- **Open**: drag .xlsx onto app window, or Flows section in sidebar → "+ Open flow"
- Share via team chat with "Can view" or "Can edit" permissions

### The Flows grid
Click the word **Flow** in the sidebar and you get your whole flow library at once — every flow and folder in a grid, exactly like the Cases grid. This is where folders are managed; there's no folder button cluttering the sidebar.

- **New flow / New folder**: buttons in the grid header. A flow made while you're inside a folder lands in that folder.
- **Auto Flow**: also in the grid header, for building a flow from speech docs.
- **File a flow**: drag its tile onto a folder — or drag it onto a folder in the sidebar tree
- **Reorder**: drag a flow tile onto another to place it before/after
- **Rename**: double-click a tile, or right-click → Rename
- **Right-click a tile** for **Move to** (any folder, even a collapsed one), **Rename**, and **Delete**
- **Open a folder**: click it; breadcrumbs at the top take you back up
- **Search** looks across **every folder at once**, so you never need to remember where you filed a flow

Folders still show in the sidebar under Flow as an expandable tree, and whatever you file in one place shows up in the other immediately — same folders, two views.

Same rules as Cases folders: a folder is **just a label**. Filing a flow never touches the flow itself, and deleting a folder never deletes a flow — everything inside moves up a level. Flow folders and Cases folders are separate systems, so a flow can't be dropped into a Cases folder or vice versa.

### Import a flow from a spreadsheet
You can bring an existing flow spreadsheet (.xlsx) straight into the app as a new flow sheet.

1. In the sidebar's **Flow** section, click the **import button** next to the `+`.
2. Pick the `.xlsx` file you want to import.
3. The app parses it and creates a **new flow** named after the file. Each worksheet (tab) in the spreadsheet becomes its own flow sheet.

Import is **very robust** — it works no matter how the spreadsheet is laid out. It first tries to auto-detect the layout itself, recognizing speech-column headers (for policy: 1AC, 1NC, 2AC, 2NC/1NR, 1AR, 2NR, 2AR; PF layouts too). Real policy has 8 speeches, but the app merges 2NC + 1NR (the neg block) into one column, so a standard 8-column sheet lines up cleanly. If it can't confidently work out a sheet's layout, it falls back to **Warroom AI** to read the spreadsheet and map the columns for you. Policy and PF flows are both supported.

The imported flow shows up in the sidebar named after the file — rename and edit it like any other flow.

### Editing a flow
The flow editor works like a paper flow, with some spreadsheet shortcuts on top.

**Format text in a cell.** While typing in a cell, select text and use the standard shortcuts (each also has a toolbar button):
- **Bold** — ⌘B
- *Italic* — ⌘I
- Underline — ⌘U
- Strikethrough — ⌘⇧X — handy for marking an argument as dropped
- Highlight — ⌘⇧H — paints the selection amber; press it again on highlighted text to clear it

Cells grow automatically to fit whatever you type.

**Pasting from Word.** Paste a tag straight out of a speech doc and it takes on the cell's own look — the doc's font, text size, text color and highlighting are all left behind, so nothing arrives in the wrong font, at the wrong size, or in unreadable dark-on-dark text. **Bold, italic, underline and strikethrough do carry over**, so a bolded tag stays bolded. If you want it highlighted, hit ⌘⇧H once it's in.

Paragraph breaks from the doc become a single line break, so a tag and its cite land on two tight lines instead of arriving with blank space above and between them.

If you have cells you pasted *before* this was fixed, they'll fix themselves the next time you open that flow — no need to retype them.

**Move around with the keyboard.**
1. **← / →** move your cursor through the text, exactly like anywhere else.
2. **↑ / ↓** move up or down a line inside the cell. When there's no line left to move to, they jump to the cell above or below — so in a one-line cell they just move between cells.
3. Press **Tab** or **Enter** to jump to the next column or row.
3. Press **⌘↑** or **⌘↓** (Ctrl on Windows) to shift the argument in the current cell up or down a row — it swaps places with the cell above/below and your cursor follows it, so you can keep nudging an argument into the right spot. This is undoable with ⌘Z.

**Switch sheets without the mouse.** Mid-round you're constantly jumping between the sheet for each off-case position and the case sheet.
- **⌘1** through **⌘8** jump straight to that sheet, counting from the left.
- **⌘9** always jumps to the **last** sheet, however many you have.
- **⌘T** makes a **new sheet** — for when they read an off-case position you didn't predict.

**Arrows are straight.** An arrow linking an argument to its answer is drawn as a straight line between the two cells. When both cells are in the same column (an answer that couldn't sit on its target's row), the line runs down the outside edge of the column so it never cuts across the arguments in between.

**Your work stays on the tab you put it on.** Warroom tracks the tab you're typing in by its identity, not its position, so switching tabs, dragging tabs into a new order, or a teammate adding or deleting a tab while you're live can't cause what you typed to land on the wrong tab. If you're flowing live with a teammate, their tab changes also no longer slide you onto a different tab mid-round, and your zoom level stays yours (it isn't pushed to or pulled from anyone else).

**Reorder tabs by dragging.** Grab any sheet tab at the bottom and drag it left or right to put your flows in whatever order you want — a blue line shows where it'll land, and it drops there when you let go. This is undoable with ⌘Z, and it's the quick fix if Auto Flow (or you) put a tab in the wrong spot.

**Each sheet remembers its own scroll position.** If you're halfway down the Politics DA and jump to the Case sheet, Case opens where *you* left it — not halfway down. A tab you haven't opened yet starts at the top.

**Columns always fill the window.** Collapse the sidebar, resize the app window, or open/close the AI chat panel and your columns automatically stretch or shrink to meet the new edge — they never leave a dead gap on the right, and their sizes stay proportional to each other the whole time (a column you widened stays proportionally wider). There's also a manual **Fit to window** button in the toolbar if you ever want to force a re-fit.

**Draw an arrow between cells.** This is the on-screen version of the line you'd draw on paper to link an argument to its answer.

The fastest way, without leaving the keyboard:
1. With your cursor in the **source cell** (the argument), press **⌘L**.
2. Arrow-key over to the **target cell** (its answer) and press **⌘L** again — the arrow is drawn.

Or with the mouse:
1. Click the **curved-arrow button** in the toolbar to enter draw mode.
2. Click the **source cell**, then the **target cell** — an arrow is drawn between them, even across columns.

The two are interchangeable: you can start an arrow with ⌘L and finish it with a click, or vice versa. To remove an arrow, click the **×** on its midpoint. Press **Esc** anytime to cancel drawing.

Arrows are saved with the sheet, so they're there when you reopen the flow.

**Insert a cell between two others.** Hover the line between two stacked cells in the same column and a tiny **+** appears on it. Click it to slot a blank cell in there — everything below shifts down one row in that column, so you can drop in an argument you missed without re-typing the ones under it. It's undoable with ⌘Z.

**Peek at a tab's contents.** Long tab names are shortened with an ellipsis so they never overflow. Hover a tab at the bottom and a tooltip shows its **full name** plus a ✨ **AI-written sentence** summarizing the argument as a whole on that sheet — not a list of what's on it, but the actual position, the way you'd describe it to a teammate. The first time you hover a tab with content on it, Warroom AI writes that sentence on the spot (you'll see "Warroom AI is summarizing this tab…" while it works); after that it's cached, so hovering the same tab again is instant — it only regenerates once you actually change something on that sheet.

**Find across the whole flow.** Press **⌘F** (Ctrl+F) to open the find bar — it searches **across all tabs** at once. Press **Enter** for the next match, **Shift+Enter** for the previous, and **Esc** to close. Stepping onto a match that lives on another tab switches you to that tab.

Matches are **highlighted in amber** so you don't have to hunt through a cell to spot them: every hit on the tab you're looking at gets a soft wash, and the one you're currently on is painted solid. The highlighting is only drawn on screen — it never becomes part of your flow.

**Undo and redo.** Press **⌘Z** to undo and **⌘⇧Z** to redo — there are toolbar buttons too, which grey out when there's nothing left to undo or redo. Undo covers text edits, column changes, colors, arrows, inserting rows, and **sheet tabs — adding, renaming, and deleting a tab are all undoable**, so accidentally deleting a tab full of arguments is one ⌘Z away from coming back. It undoes the change and **leaves you on the tab you're on** — changing tabs isn't an edit, so undo never moves you.

**Stock Issues vs. Advantage** only shows as a toggle while the flow is **empty**. Switching between them rebuilds the sheets for that layout, so once you've written anything, the toggle disappears — it can't wipe out tabs you've added, renamed, or filled in.

**Recolor a column.** Click the **▾** menu on any column header (it's always visible) and pick a color from the palette to recolor that column. Choose **Reset to default** to restore the side's standard color.

**Set default flow colors.** To change the colors used for new flows, go to **Settings → Flow** and set the default Aff/Pro and Neg/Con column colors under Column colors. These apply to all your flows.

**Flow together in realtime (live collaboration).** You and a teammate can type into the *same* flow at the same time and watch each other's edits appear letter-by-letter — perfect for splitting a round (one person flows aff, the other neg) or for a coach watching live.

**Sharing a flow now always makes it live** (as long as you're signed into a team) — you don't need to click "Go live" separately anymore. Click **Share** in the flow toolbar, pick who to send it to, and hit **Share**; going live happens automatically right before it sends. This matters because a plain (non-live) share used to hand your teammate an independent copy — editing theirs never touched yours, and if you both had your own copy open at once there was nothing tying them together. Now every share puts you both in the exact same document from the start.
1. Click **Share** in the flow toolbar (there's no separate "Collaborate" button anymore — both used to open the same panel, so they're one button now).
2. Pick who to send it to and click **Share** — this is the moment it goes live, if it wasn't already. A green **"Live"** pill appears in the toolbar showing who else is in the flow, and each teammate's cursor cell is outlined and labeled in their own color.
3. When your teammate opens what you sent, they join the *same* live flow — not a copy — and start seeing your edits instantly.
4. Edits in different cells always merge cleanly. If you both edit the *exact same cell* at once, nothing is lost — the text merges; you just won't see their changes to a cell while your cursor is sitting in it (they show up when you click away).
5. Click the **✕** on the Live pill to leave the live session on your device (your teammates keep collaborating). The flow keeps working offline either way.

Realtime sync needs the team's Supabase backend set up (the same one team chat uses).

### Round Analysis

Get a strategic read on the round straight from your flow — what's dropped, what's still contested, and what to say next.

1. Click the **magnifying-glass button** in the flow toolbar, next to Share.
2. Warroom AI automatically reads your **entire flow** — every sheet, every column, every argument you've written down — so you don't have to re-type anything.
3. Optionally add **notes** — which side you're on, the round number, what you think is winning or losing, or anything else that isn't already on the flow.
4. Optionally drop in **supplementary docs** (case docs, blocks) — drag `.docx` files onto the drop zone or click it to pick several at once, the same way you'd add docs to the Speech Doc viewer.
5. Click **Analyze round →**.

Warroom AI comes back with an actual result screen, not a paragraph to read through — it's built to look like **Impact Calc's** results:
- A colored **verdict banner** up top — who's ahead right now, and why, at a glance.
- **Dropped & Conceded** — every abandoned argument as its own small card, tagged by side and which sheet it's on.
- **Live Clashes** — each contested argument as a card, both sides' positions shown side-by-side with a winner badge, just like an Impact Calc clash card.
- **For Your Next Speech** — a short numbered list of concrete things to say, referencing your actual arguments, not generic advice.

The banner and clash cards use your real Aff/Neg (or Pro/Con) column colors — the same ones set in **Settings → Flow** (Column colors) — so it looks like it belongs to your flow, not a generic report.

If something essential is unclear — most often, which side you're on — Warroom AI asks **one quick question** with a few suggested answers (plus a free-text "Other") before finishing the analysis, instead of guessing.

**Your analysis is saved — closing the panel never loses it.** Open Round Analysis again for the same flow and you'll see your last result right away, with a small note at the top telling you when it was run (your flow may have moved on since then). Click **New analysis** when you want a real do-over — it clears your notes and uploaded docs too, not just the result — or **Done** to close and keep what you've got.

---

## Auto Flow

Turn a stack of speech docs into a flow automatically — Warroom AI reads the tags and cites (never the card bodies) and sorts each one into the right column and sheet.

1. Click the **wand-icon button** next to **Flow** in the sidebar.
2. **Upload your speech docs.** Drag several `.docx` files onto the drop zone at once, or click it to pick them from a file dialog.
3. **Warroom AI reads the docs** — it pulls each card's tag, cite, and heading structure (pocket/hat/block). It never looks at the card body. A doc with no cards is shown but doesn't stop the rest of the batch.
4. **Choose where they go:**
   - **Create a new flow** — Auto Flow figures out Policy vs. Public Forum from the docs' speech labels (`1AC`/`2NC` vs. "Pro Case"/"Con Rebuttal"), then for policy silently decides Stock issues vs. Advantage from whether the aff's structured as named advantages or as inherency/harms — there's no toggle for this, Warroom AI just picks it. It's a policy-first flow; a PF flow is created automatically when the docs read as PF.
   - **Add to an existing flow** — pick one of your flows from the list. Auto Flow reads that flow's actual current column and sheet names (even if you've renamed them from the defaults) so cards land correctly.
5. Click **Sort with Warroom AI →**. It matches each card's speech label to a column and its topic (hat/block) to a sheet, and **names a tab for every case and off-case position automatically** — the placeholder tabs from the default layout ("Off 1", "Adv 2") aren't treated as destinations; each position gets a tab named after itself ("Fism DA", "Cap K", "Warming"), taking over an unused placeholder slot rather than piling extra tabs on the end. **Your advantages come first**, as the leftmost tabs, in the order they came up in the 1AC — then your off-case flows after them. **Unused tabs are cleaned up**: the default layout seeds a fixed set of slots (three advantage tabs, four off-case tabs), but if your doc only has two advantages and two off-case flows, the leftover blank "Adv 3" / "Off 3" / "Off 4" tabs are removed automatically — you won't open a new flow to a row of empty tabs. (Your RFD/Notes tab and, for a stock-issues aff, the Inherency/Harms/Solvency tabs are always kept, blank or not.) If it's genuinely stuck — usually because a chunk of cards has no usable speech label — it asks **one quick question** for the whole batch instead of guessing.
6. **Review the placements.** Cards are grouped by destination sheet (new ones marked **NEW**), each showing its tag and "Sheet → Column". Uncheck any you don't want before writing.
7. Click **Write N cards to the flow**. Each card's tag and a **short cite** (just author and year — "Price '26", not the whole credentials paragraph) land in its column.

**Optional: summarize each card with AI.** On the same step there's a toggle switch, **off by default**, called "Summarize each card with Warroom AI". Turn it on and instead of writing the tagline + cite, Auto Flow writes a **short AI summary of the card** — built from *both* its tagline and the actual evidence in the card, and always **fewer words than the tagline itself** (Warroom AI is told the tagline's exact word count and has to come in under it). No AI ring on the resulting cells — an AI-written summary standing in for the tagline is still a tagline, and taglines never get the ring. This is the one part of Auto Flow that reads card bodies, and it costs an extra Warroom AI call, which is why it's off unless you ask for it.

**What Auto Flow does when it writes:**
- **Cites are shortened.** Warroom AI turns a card's full cite paragraph into the way a debater actually writes it on a flow — author surname plus a 2-digit year, or an abbreviated source name if there's no individual author.
- **New tabs use the doc's own shorthand.** If your case calls a position "Federalism DA" once but "Fism DA" everywhere after, the new tab is named "Fism DA" — the form you actually use.
- **Answers line up with what they answer.** When a card directly answers another (a perm, a no-link, an impact defense), Auto Flow puts it on the **same row** as the argument it answers. If two cards answer the same one, the second goes on the next row with an **arrow drawn back** to it, so the connection stays clear.
- **The plan goes first.** For policy, the plan text always lands in the very first cell of the first sheet.
- If a column is completely full, a card is skipped and listed at the end instead of silently vanishing.

**Tag styling.** Go to **Settings → Auto Flow tag style** to set whether Auto Flow writes tags in bold, italic, and/or underline (the cite line is always plain). The live preview shows exactly how a tag will look.

---

## Speech Doc Viewer
Opens .docx files in-app.

- **Open**: drag .docx onto app, or File → Open
- **Upload several at once**: drag a whole batch of .docx files onto the drop zone, or click it and multi-select in the file picker (⌘-click / shift-click). Every doc you pick is saved automatically and appears in the sidebar under **Cases** right away — the first one opens so you can start reading, and the rest are one click away. Nothing to save by hand.
- **Import a whole folder**: click "or import a whole folder of speech docs" under the drop zone and pick a folder from Finder — every .docx inside it (subfolders included) gets imported at once, filed into a new Cases folder named after the one you picked.
- Recent docs listed in Speech Doc section
- Attach to AI conversations or team chat messages
- **Document title**: the name of the open case/speech doc is always shown in the toolbar (between the tool cluster and the Credibility button), so you can tell at a glance which doc you're in. Double-click it to rename it in place — for an OpenCaseList case this renames the case, for a plain file it renames its sidebar entry. The file on disk is never touched.
- **Compare docs side by side**: a **compare-doc** button in the tool cluster (also shown on the empty drop-zone) opens a second and third doc pane next to your main one — drop or browse a file into it just like the main pane. Each pane scrolls, searches, and outlines independently; click into a pane to focus it before using ⌘F or the other pane-specific tools, so you're not searching all three at once. Each extra pane has its own **×** to close it. Opening a second or third pane automatically collapses the left sidebar to make room; it comes back once you're down to one pane again — unless you manually re-expand the sidebar while comparing, in which case that's remembered the next time you open this same set of docs. When 2+ panes are open, Credibility and Cross-Ex shrink to icon-only.
- **Resize panes**: drag the thin divider between two panes to resize them — they start out equal. This, along with each pane's outline-open state and any sidebar override, is saved together for the exact set of docs you have open — reopen the same files in the same panes and it's exactly how you left it; a different combination of docs starts fresh.
- **Leaving compare view**: clicking any doc in the sidebar (or using back/forward) closes the extra panes and opens that doc on its own — so you're never stuck in a compare layout. Reopen the comparison from the saved views below.
- **Compare views in the sidebar**: any time you have 2-3 docs open side by side, that combination is saved right under **Cases** in the sidebar (a row with a compare-view icon, above your regular docs, separated by a thin divider). Click one to reopen every pane at once, exactly as you left it. Changing a pane's doc updates that saved view in place rather than piling up near-identical copies; a genuinely new side-by-side setup gets its own entry. Hover a view and click **×** to remove it from the list (that only forgets the grouping — your docs are untouched, and there's an Undo toast). Views referencing a doc you've since deleted disappear on their own.
- **Sidebar, AI panel, and team chat auto-collapse**: opening a 2nd or 3rd pane automatically collapses the left sidebar (there's no room for it) and closes the Warroom AI panel and team chat panel if either was open — same reasoning, same side-of-screen real estate. Manually reopening any of the three while comparing is remembered as that exact combination's own preference; leaving compare view restores the sidebar and puts the AI/chat panels back to how they were right before you started comparing.
- **Fewer buttons per pane**: with 2+ panes open, each pane's toolbar folds Reading time, Send to flow, Credibility, and Cross-Ex into a **⋯** menu (hover it to open) so the doc name and the essentials still fit. They keep their full labels inside the menu.
- **Outline**: a slim pull-tab on the left edge of each pane — click it (or its arrow) to open a panel listing every heading in the doc — pockets, hats, blocks, and card tags — indented by level, with the same expand/collapse arrows as Word's own outline view. Opening it pushes your doc over rather than covering it; click the tab (or the panel's own × ) to tuck it away. It starts closed each time you open a doc, unless you've turned on **Always open the outline** in Settings — see the "Outline" bullet below for navigation details (jump-to-entry, layers, warnings), they all still apply, just reached via the pull-tab instead of a toolbar button or permanent side panel.
- **Outline layout when comparing docs**: with 2-3 panes open, opening an outline can affect the others two ways (set in Settings, default **Dedicated space**): **Dedicated space** opens a column that isn't resizable — the pane you opened it on, plus its neighbor toward the end of the row (or the one before it, if it's the last pane), share most of the width. Your other docs aren't shrunk at all; they just scroll off to the left, with an edge of the nearest one still showing so you know to scroll back. **Squish neighbor** just borrows the outline's width from one neighboring pane instead, so nothing scrolls and your reading width doesn't shrink. Dragging dividers is turned off while a Dedicated-space outline is open.
- **Comments**: select text and click the comment bubble that appears (or press **⌘⌥M** / **Ctrl+Alt+M** — the same shortcut Google Docs uses) to leave a note on it, Google-Docs style. Comments go to your **team** by default — everyone signed into the same team sees them, live, while you're both viewing the doc — or pick **Only me** to keep one just for yourself. The highlighted text gets a light purple wash, deliberately different from the document's own evidence highlighting, so it never looks like part of the original doc. A single plain **comment-icon** toolbar button (no AI ring — commenting doesn't call a model) opens the Comments panel listing every thread; click one to jump straight to its highlighted text, which flashes briefly so you can find it. Click the button again (or the panel's own ×) to close the panel and hide every highlight together. Only you can delete your own comments. Requires being signed into a team.
- **Fonts**: docs written in Calibri (the debate default) render in Calibri — or a clean sans-serif stand-in on machines without it — instead of falling back to a serif font. This holds for the whole document: if a doc used to show sans-serif headings but serif body text, it now renders consistently throughout. Docs that genuinely use Times New Roman still render in Times New Roman.

### Cases imported from OpenCaseList
When you click **+ Save to Cases** on an opponent's disclosed file, it's added to the **Cases** list in the sidebar and opens in this same full viewer — with the outline, find, reading time, send-to-flow, credibility, and cross-ex tools all available, exactly like one of your own speech docs.
- The toolbar shows an **"Imported from [team]"** label next to the doc name.
- The file is cached on your device after the first open, so reopening it is instant and works offline — no re-download from OpenCaseList.
- A **Check for changes** button re-fetches the file from OpenCaseList; if the disclosure was updated since you imported it, the viewer reloads the new version (and refreshes the cache). Otherwise it confirms you're up to date.
- **Focus mode** (toolbar): hides body text, showing only card tags, cites, and highlighted/underlined text
- **Outline** (left-edge pull-tab): slides out a panel listing every heading in the doc — pockets, hats, blocks, and card tags — indented by level, with the same expand/collapse arrows as Word's own outline view: click a branch's arrow to fold just that branch (its taglines/sub-points tuck away) without touching any other branch. It starts closed each time you open a document — click the pull-tab (or its arrow) to slide it out, click again to tuck it away. Click any entry to jump straight to it instantly; the entry for whatever you're currently reading stays highlighted as you scroll. Prev/next chevron buttons in the outline header step to the previous/next heading in one click, so you can move card-to-card without scrolling. A **layers button** (shows e.g. "2/4") in the header cycles how many heading levels are shown — collapse to just pockets/hats for fast high-level navigation in long files, then expand back to all levels. Cards that are unusually over- or under-highlighted versus the rest of the doc get a small amber warning badge; click it for an explanation and a "Dismiss permanently" option. Works on docs that use Word/Verbatim heading styles.
- **Send to Flow** (toolbar): pushes a card or heading from your speech doc straight into a flow sheet, like Verbatim's Send-to-Flow. Select text in the doc (or just scroll so a card tag is at the top), open the popover, pick **Selection** (sends the selected/heading text) or **Tag + cite** (sends the card tag plus the author + date), choose the target flow, sheet, and column, then send — it lands in the next empty row of that column. If that flow is open in another view, it updates live.
- **Find in document** (toolbar magnifier, or ⌘F / Ctrl+F): a search bar that highlights every match and jumps between them. Press Enter for the next match, Shift+Enter for the previous, or use the up/down chevrons; the counter shows "current / total". Press Esc to close.
- **Reading time & auto-scroll** (toolbar hourglass): shows how long the document will take you to read aloud at your reading speed. It counts only the words you actually read — headings (pockets/hats/blocks/tags), highlighted card text, and the author + date of each cite — not the full small-text cites or unread body, so the estimate matches what Verbatim shows. Type your words-per-minute (it's remembered between sessions), or tap the **Lay ~175** / **Flow ~300** presets — lay/traditional rounds average ~150–200 wpm, flow rounds (spreading) ~300–400+ wpm. If you select a portion of the doc first, it estimates just that selection instead of the whole thing. Tap **Auto-scroll at this pace** to have the doc scroll itself at your wpm — a floating control lets you pause/resume, change speed live, or stop.
- **Cross-Ex Practice** (toolbar): opens a side panel where Warroom AI writes targeted cross-examination questions for the open doc, drawn from your **highlighted** text. Each question hides its model answer behind a **Show answer** dropdown, and a **3 more like this** button generates three more of the same kind. The answer is what the **opponent** would likely say; the follow-up you should run next appears separately below it in a **Press next** box, so you can tell your own next move apart from their response. Warroom AI is automatically given the guide for your event (Policy / LD / PF).
  - **Aff/Neg split**: if a doc has both aff and neg, the questions are grouped under Aff and Neg headers, with more questions for whichever side has more content.
  - **Short-doc warning**: if the doc has little highlighted text or is very short, you'll see a notice that you may get few or shallow questions.
  - **Harder** button: runs a trap drill — Warroom AI asks a setup question, you type your answer, and it tells you whether you avoided the trap or fell for it, with the fix. Three traps per drill.
  - Tap **Generate** (or **Regenerate**) at the bottom. Your questions are saved per doc — they stay even if you close the panel or reopen the file, and only clear when you regenerate.
- **Card Credibility** (toolbar shield button): opens a side panel where Warroom AI grades the evidence in your doc. In one pass it scores **every card** at once and gives each one an overall score out of 10 plus a one-word verdict (**Strong / Solid / Shaky / Weak**), four sub-scores — **Author qualifications**, **Recency**, **Source quality**, and **Claim fit** (does the cite actually support what the tag claims?) — a short reason, and a **"press"** line: the single sharpest cross-ex attack on that card's credibility. Warroom AI judges only what the cite actually says and never makes up credentials, dates, or sources. Click any card (note the chevron) to expand its breakdown; over/under-highlighted cards also show a highlight warning here with the exact percentage. Use **Go to card in document** to jump straight to a card. Results are cached per document, so reopening the panel is instant and free; tap **Re-score** to refresh. (The Credibility and Cross-Ex panels share the same space — opening one closes the other.)

---

## Impact Calc
Full-screen hub — open it from the **Impact Calc** card on the home screen.

Two areas: **Practice** (the Outweigh game) and **Tools** (the doc-comparison analyzer and the Impact Library; Head-to-head Matchups is coming soon).

### The Outweigh game (Practice)
A live impact-calculus drill against Warroom AI. It automatically matches your event: **Policy** (Aff/Neg, plan/DA framing) or **Public Forum** (Pro/Con, no plan — weighing framed the way it reads in Summary/Final Focus). A badge next to the difficulty tag in the header shows which one is active. LD currently plays like Policy (not built out separately yet).

Pick a difficulty and spar:
- **Novice** — concrete, intuitive impacts; no theory.
- **JV** — classic impacts (nuclear war, bioweapons, hegemony); engage scope, probability, timeframe, reversibility.
- **Varsity** — extinction matchups and framework wars; win the metric before the calc resolves.

**Starting a round** — you're offered three options:
- **🎲 Surprise me** — Warroom AI invents a topic on the spot.
- **📝 Pick my own topic** — attach one of your imported cases or speech docs (one for your side, one for the opponent's — both optional), tell it which side you want to argue, and add any notes ("focus on a specific DA", "assume a flow judge", etc.). No docs imported yet? Drag a `.docx` onto the app, or use **Import doc** from the home screen's quick actions — or just skip the doc pickers and fill in the text fields.
- **📰 Use current topic** — pulls whatever resolution is currently stored for your active event from the Topics feature and builds the scenario around it. If nothing's been fetched yet for that event, it tells you to open Topics first rather than quietly making something up.

**How it plays**:
1. **Your impact** — Warroom AI reads its impact (claim + warrant + dimension ratings). You type your own impact and a short calc on why yours outweighs.
2. **AI rebuttal** — Warroom AI fires back a 1–2 minute rebuttal speech. You get the last word (final shot) with a 60-second pressure timer — it never auto-submits or locks you out; once it hits zero it just counts overtime, and the result screen tells you if you went over.
3. **Decision** — a banner announces the winner the instant the round ends (no need to scroll for it), with your score out of 10. Below that: the judge's reasoning, an independent grade of the **opponent's rebuttal** (its own score + a short critique — judged blind, in a separate call from the one that wrote the rebuttal, so it can't be biased toward or against itself), dimension-by-dimension feedback, and concrete tips. Hit **Play again** to choose a fresh start (surprise or custom) again.

### Compare two docs (Tools)
Compare two of your own cases, speech docs, or a flow and get a full impact breakdown:
1. Pick **Your doc** and **Their doc** (a case, an imported speech doc, or a flow — only one flow per comparison)
2. Click **Analyze Impact Calc**

**What you see**:
- **Clashes** — each row pairs one of your impacts against the opponent impact it directly competes with
- **Dimension winners** — a winner per clash on **Magnitude** (how big?), **Probability** (how likely?), **Timeframe** (how soon?), **Reversibility** (can it be undone?)
- **Overall verdict** — who wins the exchange and why, ready for your final rebuttal

Saved comparisons appear underneath for one-click reopening.

### Impact Library (Tools)
A **shared library of impacts that everyone using Warroom contributes to** — not just your team, the whole app. It uses your **chat account** (it's stored in the cloud), so you'll sign in through the chat panel the first time; if you're not signed in the screen shows a sign-in prompt.

Every entry is AI-structured: the impact broken out by **magnitude / probability / timeframe / reversibility** (each with a one-line reason), plus the standard **answers** for beating it and search tags.

**To contribute** (the **+ Contribute** button):
1. **Source** — pick one of your cases or speech docs, and/or paste a card or just describe the impact in your own words; choose the event; hit **Draft with AI**.
2. **Edit draft** — the AI hands back a structured impact. Fix anything it got wrong (ratings, wording, etc.).
3. **Review & submit** — the AI passes over your edited version to rewrite the answers/tags, **check your edit against the original source** (it warns you if you've overstated something the source doesn't back), and **flag anything already in the library that looks like a duplicate**. Then choose whether to stay **anonymous** (the default) or **credit yourself** by your chat name, and add it.

**To browse**: search by keyword, filter by event, and sort by **Top** (most-liked), **Newest**, **Saved** (your bookmarks), or **Mine**. Each entry has **👍 like / 👎 dislike / 🔖 save** — after you like or dislike, you can attach a quick reason tag (dislike reasons include **AI error**). You can delete entries you contributed.

> Setup note: the library needs its cloud tables. If it errors on first use, an admin needs to re-run `supabase/schema.sql` in the Supabase project.

---

## Find Cards (Logos) / Open Evidence
Built-in browser panels for evidence databases.

- **Logos**: sidebar → Find Cards. AI can also search Logos automatically (background tab, doesn't disturb your view)
- **Open Evidence**: sidebar → Open Evidence. Requires OpenCaselist login in Settings.

---

## LM Studio (run the AI on your own computer)
Instead of a cloud API, Warroom can talk to **LM Studio** — a free app that runs AI models locally on your machine. No API key, no per-message cost, and it works with no internet.

**Setup**
1. Install LM Studio from lmstudio.ai and download a model in it (Gemma 4 12B is the default Warroom expects).
2. In LM Studio, load the model, then open the **Developer** tab and click **Start Server**. It listens on `http://localhost:1234` by default.
3. In Warroom: **Settings → AI API key → LM Studio**.
4. Click **Loaded models** — Warroom asks your server what it has and lists it. Click the one you want.
5. Click **Test connection**. You should see the model reply "ready" with how long it took.

**Model options**
Three presets are offered: **Gemma 4 12B QAT** (near-12B quality, much smaller memory footprint), **Gemma 4 12B** (the default — strongest, needs the most RAM/VRAM), and **Gemma 4 E4B** (fastest and lightest, use this if the 12B models are slow or run out of memory).

These are just shortcuts. The exact model id depends on how you downloaded it, so you can type **any** model id, or pick from **Loaded models** — that list comes from your own server, so it's always right.

**Model options box (optional)**
JSON that gets merged into every request, overriding Warroom's defaults — `temperature`, `max_tokens`, `top_p`, `top_k`, `repeat_penalty`, `seed`, and `ttl` (seconds before LM Studio unloads the model to free memory). For example:

```json
{ "temperature": 0.1, "max_tokens": 8192, "ttl": 3600 }
```

Context length and GPU offload aren't in here — those are set inside LM Studio when you load the model, because its API doesn't accept them.

**Things to expect**
- **It's slower than the cloud.** A 12B model on a laptop can take a while on long jobs like Auto Flow or Round Analysis. Warroom waits up to 10 minutes before giving up. If you're hitting that, switch to Gemma 4 E4B.
- **Tools work.** Features where the AI acts on your app (editing a flow, saving a tournament, searching your cards) need "tool calling". Gemma 4 supports this natively, and for models that don't, LM Studio falls back to a prompt-based format instead of failing — so leave the tool checkbox on. Smaller models are less reliable at *choosing* the right tool, though, so expect the occasional miss.
- **Quality is lower than a frontier cloud model.** For cutting cards or scouting, a hosted model will usually do better. Local shines for privacy, cost, and working offline.

**If it doesn't connect**
- "Can't reach LM Studio" → the server isn't running. LM Studio → Developer → Start Server. Check the port matches Settings.
- "No model matching that name is loaded" → load it in LM Studio, or use **Loaded models** to pick the exact id.
- "Timed out" → the model is too big for your machine; try a smaller one.

---

## Warroom AI
Star icon in the title bar.

- **New chat**: pencil icon in panel header
- **Switch chats**: list icon in panel header
- **Attach context**: type `@` in the message box → select case/block/flow/opponent/image. Or use `+` button for .docx or image files.
- **Token saving**: strips body text from speech doc attachments to save cost. Toggle in attach menu or Settings.
- **Models**: Flash Lite (cheapest), Flash (default), 3.5 Flash (best quality). Change in Settings → Gemini Model.
- **Evidence search**: AI searches Logos/Open Evidence automatically when asked. Spinner shows per-search. Hover over a running search + click ✕ to exclude it.
- **Saved cards**: go to Cases → Agent Saves → Agent Inbox
- **Voice input**: microphone button in the composer
- **Reply to a message**: hover any message (yours or the AI's) and click Reply to quote it — your next message shows the quoted snippet and the AI gets that quote as context, without turning it into a separate thread. Click a quoted snippet to jump back to the original message.
- **Navigation**: ask the AI to take you anywhere — "open my Spending DA case", "go to settings", "show my tournaments". It opens the view for you.
- **Flow editing**: ask the AI to fill in or edit a flow — "add the perm to my Round 3 flow under 2AC", "put 'extend impact' in 2NR row 4". It can read your flow's columns/rows and write to specific cells. If the flow is open, edits appear live.
- **Opponent scouting**: ask "scout [team name]" and it pulls their disclosed rounds/cites from OpenCaselist (if the team is linked) and returns an AFF/NEG summary with citations — the same report you'd get from the "Scout" button on an opponent profile. Repeat asks return the cached report instantly; say "refresh" or "rescout" to regenerate it.

### AI Prompts
Every question or task Warroom sends to the AI — card cutting, scouting reports, mission briefs, cross-ex questions, card credibility, impact calc, the Outweigh game, and more — is built from an editable prompt file, not baked into the app. Throughout the Documentation page you'll find "View/edit this prompt" links next to each AI feature; clicking one opens that prompt in a plain text editor. Change the wording and save — your edit is used the very next time that feature runs, with no restart needed. If you want to go back to the original wording, just delete your edited copy.

### If an AI call fails
Nearly every "fire it off and wait" AI feature in Warroom (card cutting, Auto Flow, Round Analysis, cross-ex, Impact Calc, scouting, and more) automatically retries on failure — after **8 seconds**, then **30 seconds**, then **60 seconds** (4 tries total) — before finally giving up, so a brief outage or a rate limit usually resolves itself without you having to do anything. That's the point of it: these are background calls with no "try again" button of your own, so Warroom retries on your behalf. If it still doesn't come back after all four tries, a small toast appears in the bottom-right corner with the exact error the AI provider sent back (not a dumbed-down summary), on top of whatever that feature already shows. It's deliberately small and out of the way so it can't bury your flow mid-round: one line by default — **click it to see the full error** — repeats of the same error collapse into a single toast with a ×N counter instead of stacking up, and it clears itself after a few seconds. Warroom also stops re-asking once a call fails for a reason that won't fix itself (an exhausted quota, a bad API key), so one bad key can't turn into a stream of popups while you're flowing. The one place this doesn't apply is the **Warroom AI chat panel** — a chat message is something you can already just resend yourself, so it isn't auto-retried the same way.

---

## Team Chat
Chat icon in the title bar.

- **Sign in**: Settings → Chat
- **Create team**: in chat panel → "Create team" → share invite code
- **Join team**: in chat panel → "Join team" → enter invite code
- **DMs**: click a teammate's name
- **Share attachments**: cases, blocks, flows, opponents, tournaments, speech docs — all shareable in messages
- **Edit / delete**: hover your own message in a room or DM for Edit and Delete buttons
- **Reply**: hover any message (yours or someone else's) for a Reply button — quotes that message above your new one so context is clear without starting a separate thread. Click the quoted snippet on a sent message to jump back to the original.
- **Unread badge** shown on chat icon
- **Encryption**: every message and shared attachment is encrypted on your device (AES-256-GCM) before it's sent, so the cloud server only ever stores scrambled ciphertext — a leak of just the message data reveals nothing. The key is derived from your team's invite code, so keep that code private. Note this is not zero-knowledge encryption: the invite code is also stored on the server (it has to be, to let people join), so it's strong protection against a data leak, not a guarantee that the service operator can't read messages. Warroom AI never reads your team-chat history.

### Team Files
A file icon in the chat header (next to Direct Messages and Room Settings) opens **Team Files** — a shared file library separate from the message stream, so important docs don't get buried by chatter.

- **Upload**: "+ Add file" → pick a .docx. It's encrypted and shared with the whole team instantly.
- **Each file shows**: its name, when it was last modified, and who uploaded it.
- **Auto-update**: if you're the one who uploaded a file, Warroom watches your local copy — the next time you save changes in Word (or wherever you edit it), your team's copy updates automatically, no re-upload needed. This only works while your Warroom app is open on the device you uploaded from; a 🔄 "auto-updating" tag shows on files your device is actively watching.
- **Open a file**: click its name to view it in the Speech Doc Viewer.
- **Delete**: only the uploader can delete their own file (trash icon).

---

## Google Drive
- **Setup**: Settings → Google Drive → enter OAuth Client ID + Secret (create Desktop app credential in Google Cloud Console) → "Connect Drive"
- **Browse**: Google Drive from sidebar
- .docx → Speech Doc Viewer. .xlsx → Flows.

---

## NSDA Topics
Topics screen (sidebar or Settings).

- App checks for new topics on launch + polls aggressively on known release dates
- New topic → OS desktop notification + in-app banner (amber for PF, red for LD)
- AI-generated brief auto-created for new topics (can regenerate anytime)
- Current Policy topic injected into every AI conversation automatically

---

## Settings
Gear icon at bottom of sidebar.

| Setting | Description |
|---------|-------------|
| Debate event | HS Policy, HS LD, HS PF, College Policy (NDT/CEDA), College LD (NFA-LD) |
| Card staleness | How many years old a card can be before it's flagged outdated everywhere (default 4) |
| Reduce motion | Turns off transitions and animations across the app |
| Skip delete confirmations | Delete cases/blocks/tournaments/rounds/impact-library entries without an "are you sure?" prompt — the Undo toast still has you covered |
| Background notifications | 5 separate toggles — new pairings, round results, new topics, judge paradigm updates, opponent disclosures — all on by default |
| AI provider | Gemini (default), OpenAI, Anthropic, Grok, or **LM Studio** (runs on your own computer — see below) |
| Gemini API key | From aistudio.google.com. Required for all AI features. |
| Gemini model | Flash Lite / Flash (default) / 3.5 Flash |
| LM Studio | Server URL, model, and options — no API key needed. See "LM Studio" below. |
| Token saving default | Auto-strips body text from speech doc attachments |
| OpenCaselist login | Your Tabroom.com email and password (same credentials) |
| Google Drive | OAuth Client ID + Client Secret |
| Sharing default | "Can edit" or "Can view" for shared attachments |
| Flow | Column colors, new-flow defaults, and live editor behavior — one block, see below |
| Setup wizard | Re-run onboarding |

### Flow
One settings block covering everything about how flows work by default. None of it touches a flow you've already opened — those keep whatever they were last saved at.

**Column colors**

| Setting | Description |
|---------|-------------|
| Aff/Pro | Default color for Aff (policy) / Pro (PF) columns on all flows |
| Neg/Con | Default color for Neg (policy) / Con (PF) columns on all flows |

**New-flow defaults** (only affect the plain **+** new-flow button — Auto Flow always guesses its own layout, order, etc. from the doc)

| Setting | Description |
|---------|-------------|
| Default layout for a new policy flow | Stock issues or Advantage |
| Default speech order for a new PF flow | Pro first or Con first |
| Default zoom | 50–150% (default 100%), the zoom a brand-new flow opens at |
| Default text size | 10–20px (default 13px), the cell text size a brand-new flow opens at |

**Editor behavior**

| Setting | Description |
|---------|-------------|
| Auto-fit columns to window | On by default. Columns continuously stretch/shrink to fill the window as you resize it, collapse the sidebar, or open the AI chat panel. Turn it off if you'd rather set zoom yourself and have it stay put. |
| AI tab summaries on hover | On by default. Hovering a tab asks Warroom AI for a one-sentence summary of the argument on that sheet — cached after the first time, so it doesn't cost another call until the sheet's content changes. Turn it off and tabs only ever show the free local tag preview; Warroom AI is never called from a hover. |

One **Reset to defaults** at the bottom resets all of it — colors included.

### Speech docs & cases
Its own settings block, right below Appearance:

| Setting | Description |
|---------|-------------|
| Keep speech docs light | Dark mode only, on by default. The doc page itself stays light like paper while the rest of the app stays dark. |
| Speech doc margins | 0–100% (default 50%) of the doc's real page margins to keep, left/right only. Lower gives the text more width. Rescales an already-open doc live as you drag. |
| Speech doc text size | 80–150% (default 100%) zoom on the whole doc page — text, cards, everything together. Applies live. |
| Always open the outline | Off by default (never auto-opens). On shows it for every doc you open. |
| Start docs in Focus mode | Off by default. On hides body text and shows only card structure as soon as any doc opens. |
| Outline layout in compare view | Dedicated space (default) or Squish neighbor — see the Speech Doc Viewer section above. |

---

## Keyboard Shortcuts
Press **⌘/** (Mac) or **Ctrl+/** (Windows) anytime to open the full shortcuts list in-app — it's always up to date with this section. Also reachable from Settings → Keyboard Shortcuts.

- **⌘K / Ctrl K**: open global search
- **⌘/ / Ctrl+/**: open the keyboard shortcuts list
- **Escape**: close the current modal, popover, or overlay
- **⌘F / Ctrl F**: find on the current page — Documentation, User Manual, a speech doc, or a flow
- **Enter**: send message in AI panel or team chat
- **Shift+Enter**: new line in AI panel or team chat
- **Escape**: close mention picker or attach menu
- **@**: type in the composer (AI panel or team chat) to open the mention picker

### In a speech doc
- **⌘⌥M / Ctrl+Alt+M**: comment on the selected text (Google Docs' own shortcut)

### In a flow
- **⌘B / ⌘I / ⌘U / ⌘⇧X / ⌘⇧H**: bold / italic / underline / strikethrough / highlight in a cell
- **⌘F**: find across all sheets in the flow
- **⌘Z / ⌘⇧Z**: undo / redo
- **← / →**: move the cursor through the text
- **↑ / ↓**: move a line within the cell — or to the cell above / below when there's no line left
- **Tab / Enter**: move to next column / row
- **⌘↑ / ⌘↓**: shift an argument up / down a row (swaps with its neighbour, cursor follows)
- **⌘1 – ⌘8**: jump to that sheet; **⌘9** jumps to the last sheet
- **⌘T**: new sheet
- **⌘L**: draw an arrow — press it in the source cell, then again in the target cell
- **Esc**: cancel arrow-draw mode or close find

### Customizing shortcuts
Most of the shortcuts above (not the plain typing/navigation ones like Enter, Tab, or arrow keys) can be **disabled or rebound** to a different combo from the **⌘/** shortcuts list:

- **Disable one**: click the small power icon to the right of its key badge — it turns red and the key dims with a line through it. Click again to re-enable.
- **Rebind one**: double-click its key badge, then press your new combo (it must include ⌘/Ctrl or ⌥ — Shift alone isn't accepted, since Shift+letter is just typing a capital letter). Press Esc to cancel instead. If your combo is already used by another active shortcut, it'll tell you and ask for a different one.
- **Reset one back to default**: a small "reset" link appears next to any shortcut you've customized.
- A few multi-key groups (jumping between sheets ⌘1–9, moving a row ⌘↑/⌘↓) can be disabled but not individually rebound, since they're not a single combo.

Your changes are saved on this device and apply everywhere that shortcut is used in the app.

---

## Data & Storage
All local data in app userData folder. Sensitive values (API keys, passwords, tokens) encrypted via OS keychain. JSON files use write-then-rename to prevent data loss on crash. Chat data syncs via Supabase, with all message content and shared attachments encrypted client-side (AES-256-GCM) so the server only stores ciphertext. This is defense-in-depth against a data leak, not zero-knowledge encryption — the team key is derived from the invite code, which is also stored server-side. Doc comments (and opponent/judge notes) sync via Supabase too, but as plaintext — a lighter-sensitivity, easily-deleted annotation layer, not message history.
