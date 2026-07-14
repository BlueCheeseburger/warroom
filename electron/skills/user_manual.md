# Warroom App — User Manual

## Overview
Warroom is a desktop debate prep app for Policy, LD, and PF. All core data (cases, cards, opponents, tournaments) is stored locally — no account needed for prep features. Team chat and sharing use a cloud backend. Includes Warroom AI, an agentic AI assistant.

## Navigation
Sidebar icons switch between views: Home, Cases/Library, Opponents, Tournaments, Flows, Find Cards (Logos), Open Evidence, Google Drive, Settings. Bottom of sidebar toggles **Prep mode** (default) ↔ **Round mode** (tournament day). AI panel = star icon in title bar. Team chat = chat icon next to it.

---

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
- Cards 4+ years old are automatically flagged (highlighted in amber) as potentially outdated
- **Share via chat**: open case/block → share button to send as attachment

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
5. **Warroom AI cuts it** — it decides what to **underline** (read aloud), **highlight** (most important), and shrink to **small text** (kept for context, not read), and proposes **one or two taglines**.
6. **Review & fix.** Pick a tagline or write your own, edit the cite/year, and use the mini editor to fix the emphasis: select text and hit **Underline / Highlight / Small / Clear**. You can't change the words (the body stays verbatim) — only the formatting.
7. Click **Save card**. It lands in the **"Cut Cards"** case and shows up in the Cards view with its formatting intact.

Notes: HTML keeps images, PDF is text-only. Scanned/image-only PDFs have no selectable text to cut. Neon green highlight counts as "read aloud" everywhere in Warroom, alongside yellow and cyan. This needs a working AI key (Settings → API Keys).

---

## Opponents
Opponent profiles store scouting data.

- **Create**: Opponents → "+ New opponent" → type team name and school
- **Auto-scout**: click "Scout" on a profile → pulls OpenCaselist disclosures + Debate Land stats (requires OC login in Settings)
- **AI Scout Report**: auto-generated from disclosure data — gives Aff/Neg argument summary
- **Notes**: add free-text notes to any opponent profile
- Rounds against a specific opponent are automatically linked

---

## Judge Scouting
- Ask me: "Look up judge [name]" — I'll pull their Tabroom paradigm directly
- Or: open a round → enter judge name → paste their paradigm → "Analyze paradigm"
- The Tabroom Live Monitor fetches paradigms automatically when a new pairing is posted

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

---

## Flows
.xlsx spreadsheets opened in-app.

- **Open**: drag .xlsx onto app window, or Flows section in sidebar → "+ Open flow"
- Share via team chat with "Can view" or "Can edit" permissions

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

**Move around with the keyboard.**
1. Press the **arrow keys** to move to the next cell in that direction (Up/Down/Left/Right). They always jump cells — they never move your cursor around inside a cell — so getting anywhere on the flow is one keypress per cell.
2. Press **Tab** or **Enter** to jump to the next column or row.
3. Press **⌘↑** or **⌘↓** (Ctrl on Windows) to shift the argument in the current cell up or down a row — it swaps places with the cell above/below and your cursor follows it, so you can keep nudging an argument into the right spot. This is undoable with ⌘Z.

**Switch sheets without the mouse.** Mid-round you're constantly jumping between the sheet for each off-case position and the case sheet.
- **⌘1** through **⌘8** jump straight to that sheet, counting from the left.
- **⌘9** always jumps to the **last** sheet, however many you have.
- **⌘T** makes a **new sheet** — for when they read an off-case position you didn't predict.

**Draw an arrow between cells.** This is the on-screen version of the line you'd draw on paper to link an argument to its answer.

The fastest way, without leaving the keyboard:
1. With your cursor in the **source cell** (the argument), press **⌘L**.
2. Arrow-key over to the **target cell** (its answer) and press **⌘L** again — the arrow is drawn.

Or with the mouse:
1. Click the **curved-arrow button** in the toolbar to enter draw mode.
2. Click the **source cell**, then the **target cell** — an arrow is drawn between them, even across columns.

The two are interchangeable: you can start an arrow with ⌘L and finish it with a click, or vice versa. To remove an arrow, click the **×** on its midpoint. Press **Esc** anytime to cancel drawing.

Arrows are saved with the sheet, so they're there when you reopen the flow.

**Find across the whole flow.** Press **⌘F** (Ctrl+F) to open the find bar. It searches every sheet in the flow at once. Press **Enter** for the next match, **Shift+Enter** for the previous, and **Esc** to close.

**Undo and redo.** Press **⌘Z** to undo and **⌘⇧Z** to redo — there are toolbar buttons too. Undo covers text edits, column changes, colors, and arrows.

**Recolor a column.** Click the **▾** menu on any column header (it's always visible) and pick a color from the palette to recolor that column. Choose **Reset to default** to restore the side's standard color.

**Set default flow colors.** To change the colors used for new flows, go to **Settings → Flow colors** and set the default Aff/Pro and Neg/Con column colors. These apply to all your flows.

**Flow together in realtime (live collaboration).** You and a teammate can type into the *same* flow at the same time and watch each other's edits appear letter-by-letter — perfect for splitting a round (one person flows aff, the other neg) or for a coach watching live.
1. Click the **Live button** (two-people icon) in the flow toolbar. You need to be signed in to a team.
2. A green **"Live"** pill appears showing who else is in the flow. Each teammate's cursor cell is outlined and labeled in their own color.
3. **Share it** with your partner the normal way (Share button → pick them / your team room). When they open it, they join the *same* live flow — not a copy — and start seeing your edits instantly.
4. Edits in different cells always merge cleanly. If you both edit the *exact same cell* at once, nothing is lost — the text merges; you just won't see their changes to a cell while your cursor is sitting in it (they show up when you click away).
5. Click the **✕** on the Live pill to leave the live session on your device (your teammates keep collaborating). The flow keeps working offline either way.

Realtime sync needs the team's Supabase backend set up (the same one team chat uses).

---

## Speech Doc Viewer
Opens .docx files in-app.

- **Open**: drag .docx onto app, or File → Open
- Recent docs listed in Speech Doc section
- Attach to AI conversations or team chat messages
- **Document title**: the name of the open case/speech doc is always shown in the toolbar (between the tool cluster and the Credibility button), so you can tell at a glance which doc you're in.
- **Fonts**: docs written in Calibri (the debate default) render in Calibri — or a clean sans-serif stand-in on machines without it — instead of falling back to a serif font.

### Cases imported from OpenCaseList
When you click **+ Save to Cases** on an opponent's disclosed file, it's added to the **Cases** list in the sidebar and opens in this same full viewer — with the outline, find, reading time, send-to-flow, credibility, and cross-ex tools all available, exactly like one of your own speech docs.
- The toolbar shows an **"Imported from [team]"** label next to the doc name.
- The file is cached on your device after the first open, so reopening it is instant and works offline — no re-download from OpenCaseList.
- A **Check for changes** button re-fetches the file from OpenCaseList; if the disclosure was updated since you imported it, the viewer reloads the new version (and refreshes the cache). Otherwise it confirms you're up to date.
- **Focus mode** (toolbar): hides body text, showing only card tags, cites, and highlighted/underlined text
- **Outline** (toolbar): a side panel listing every heading in the doc — pockets, hats, blocks, and card tags — indented by level. It shows automatically the first time you open a document each app launch; after that it stays in whatever state you left it. Click any entry to jump straight to it instantly; the entry for whatever you're currently reading stays highlighted as you scroll. Prev/next chevron buttons in the outline header step to the previous/next heading in one click, so you can move card-to-card without scrolling. A **layers button** (shows e.g. "2/4") in the header cycles how many heading levels are shown — collapse to just pockets/hats for fast high-level navigation in long files, then expand back to all levels. Cards that are unusually over- or under-highlighted versus the rest of the doc get a small amber warning badge; click it for an explanation and a "Dismiss permanently" option. Toggle the whole panel with the Outline button. Works on docs that use Word/Verbatim heading styles.
- **Send to Flow** (toolbar): pushes a card or heading from your speech doc straight into a flow sheet, like Verbatim's Send-to-Flow. Select text in the doc (or just scroll so a card tag is at the top), open the popover, pick **Selection** (sends the selected/heading text) or **Tag + cite** (sends the card tag plus the author + date), choose the target flow, sheet, and column, then send — it lands in the next empty row of that column. If that flow is open in another view, it updates live.
- **Find in document** (toolbar magnifier, or ⌘F / Ctrl+F): a search bar that highlights every match and jumps between them. Press Enter for the next match, Shift+Enter for the previous, or use the up/down chevrons; the counter shows "current / total". Press Esc to close.
- **Reading time & auto-scroll** (toolbar hourglass): shows how long the document will take you to read aloud at your reading speed. It counts only the words you actually read — headings (pockets/hats/blocks/tags), highlighted card text, and the author + date of each cite — not the full small-text cites or unread body, so the estimate matches what Verbatim shows. Type your words-per-minute (it's remembered between sessions), or tap the **Lay ~175** / **Flow ~300** presets — lay/traditional rounds average ~150–200 wpm, flow rounds (spreading) ~300–400+ wpm. If you select a portion of the doc first, it estimates just that selection instead of the whole thing. Tap **Auto-scroll at this pace** to have the doc scroll itself at your wpm — a floating control lets you pause/resume, change speed live, or stop.
- **Cross-Ex Practice** (toolbar): opens a side panel where Warroom AI writes targeted cross-examination questions for the open doc, drawn from your **highlighted** text. Each question hides its model answer behind a **Show answer** dropdown, and a **3 more like this** button generates three more of the same kind. Warroom AI is automatically given the guide for your event (Policy / LD / PF).
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
| Gemini API key | From aistudio.google.com. Required for all AI features. |
| Gemini model | Flash Lite / Flash (default) / 3.5 Flash |
| Token saving default | Auto-strips body text from speech doc attachments |
| OpenCaselist login | Your Tabroom.com email and password (same credentials) |
| Google Drive | OAuth Client ID + Client Secret |
| Sharing default | "Can edit" or "Can view" for shared attachments |
| Flow colors | Default Aff/Pro and Neg/Con column colors for all flows |
| Setup wizard | Re-run onboarding |

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

### In a flow
- **⌘B / ⌘I / ⌘U / ⌘⇧X / ⌘⇧H**: bold / italic / underline / strikethrough / highlight in a cell
- **⌘F**: find across all sheets in the flow
- **⌘Z / ⌘⇧Z**: undo / redo
- **Arrow keys**: move to the neighbouring cell in that direction (always — never moves the cursor inside a cell)
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
All local data in app userData folder. Sensitive values (API keys, passwords, tokens) encrypted via OS keychain. JSON files use write-then-rename to prevent data loss on crash. Chat data syncs via Supabase, with all message content and shared attachments encrypted client-side (AES-256-GCM) so the server only stores ciphertext. This is defense-in-depth against a data leak, not zero-knowledge encryption — the team key is derived from the invite code, which is also stored server-side.
