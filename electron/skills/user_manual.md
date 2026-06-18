# Warroom App — User Manual

## Overview
Warroom is a desktop debate prep app for Policy, LD, and PF. All core data (cases, cards, opponents, tournaments) is stored locally — no account needed for prep features. Team chat and sharing use a cloud backend. Includes Warroom AI, an agentic AI assistant.

## Navigation
Sidebar icons switch between views: Home, Cases/Library, Opponents, Tournaments, Flows, Find Cards (Logos), Open Evidence, Google Drive, Settings. Bottom of sidebar toggles **Prep mode** (default) ↔ **Round mode** (tournament day). AI panel = star icon in title bar. Team chat = chat icon next to it.

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

## Card Library
All cards across every case and block in one view. Search by tag, citation, or body text. Filter by case or block using dropdowns. Flag/unflag cards with the flag icon.

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

## Flows
.xlsx spreadsheets opened in-app.

- **Open**: drag .xlsx onto app window, or Flows section in sidebar → "+ Open flow"
- Share via team chat with "Can view" or "Can edit" permissions

---

## Speech Doc Viewer
Opens .docx files in-app.

- **Open**: drag .docx onto app, or File → Open
- Recent docs listed in Speech Doc section
- Attach to AI conversations or team chat messages
- **Focus mode** (toolbar): hides body text, showing only card tags, cites, and highlighted/underlined text
- **Cross-Ex Practice** (toolbar): opens a side panel where Warroom AI writes targeted cross-examination questions for the open doc. Each question hides its model answer behind a **Show answer** dropdown, and a **3 more like this** button generates three more questions of the same kind. Warroom AI is automatically given the guide for your event (Policy / LD / PF) so the questions fit your format. Tap **Generate questions** (or **Regenerate**) at the bottom of the panel. Your questions are saved per doc — they stay even if you close the panel or reopen the file, and only clear when you regenerate.

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
- **Navigation**: ask the AI to take you anywhere — "open my Spending DA case", "go to settings", "show my tournaments". It opens the view for you.
- **Flow editing**: ask the AI to fill in or edit a flow — "add the perm to my Round 3 flow under 2AC", "put 'extend impact' in 2NR row 4". It can read your flow's columns/rows and write to specific cells. If the flow is open, edits appear live.

---

## Team Chat
Chat icon in the title bar.

- **Sign in**: Settings → Chat
- **Create team**: in chat panel → "Create team" → share invite code
- **Join team**: in chat panel → "Join team" → enter invite code
- **DMs**: click a teammate's name
- **Share attachments**: cases, blocks, flows, opponents, tournaments, speech docs — all shareable in messages
- **Edit / delete**: hover your own message in a room or DM for Edit and Delete buttons
- **Unread badge** shown on chat icon
- **Encryption**: every message and shared attachment is end-to-end encrypted. Only your team can read what's sent — the cloud server only ever stores scrambled ciphertext. The key is derived from your team's invite code, so keep that code private. Warroom AI never reads your team-chat history.

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
| Setup wizard | Re-run onboarding |

---

## Keyboard Shortcuts
- **Enter**: send message in AI panel
- **Shift+Enter**: new line in AI panel
- **Escape**: close mention picker or attach menu
- **@**: type in AI composer to open mention picker

---

## Data & Storage
All local data in app userData folder. Sensitive values (API keys, passwords, tokens) encrypted via OS keychain. JSON files use write-then-rename to prevent data loss on crash. Chat data syncs via Supabase, with all message content and shared attachments end-to-end encrypted (AES-256-GCM) so the server only stores ciphertext.
