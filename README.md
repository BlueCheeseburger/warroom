# Warroom

Warroom is a desktop app built for competitive policy debaters. It brings together everything you need for prep and in-round performance into one place — case and block management, evidence cutting, opponent scouting, tournament tracking, flowing, and an agentic AI assistant — all running locally with no account required.

It looks like a case organizer. Under the hood, it also runs a headless background daemon, real-time CRDT-merged collaborative flowing, and an AI agent with real tool-calling — not just chat.

## What's unusual about it

- **A background daemon that outlives the app.** Judge paradigm updates, opponent disclosure changes, live Tabroom round pairings, ballot results, and NSDA topic drops keep notifying **even when Warroom is closed**. This isn't a simple cron job — the daemon is the *same Electron binary* relaunched headless with a `--daemon` flag (the only way to reuse the OS-encrypted Tabroom/OpenCaselist credentials already on disk). It's installed as a native OS scheduler entry — a `launchd` LaunchAgent on macOS, a Task Scheduler task on Windows — that fires every 10 minutes. A heartbeat file lets the daemon detect whether the GUI app is already running so the two processes never do duplicate work or double-fire a notification; during an active tournament the daemon holds a resident 60-second polling loop instead of exiting. Clicking a daemon notification deep-links straight back into the app (`warroom://open/...`) even from a cold start.

- **Real-time collaborative flowing, not just shared documents.** Flows aren't "shared" the way a Google Doc link is shared — the flow's live cell content is a **Yjs CRDT** document. Multiple teammates can type in the same flow at once, in the same cell, and watch each other's keystrokes merge deterministically — no lock, no overwrite, no "who has the file open" conflict. Updates ride a Supabase Realtime broadcast channel (no per-keystroke database writes), with a debounced durable snapshot so a teammate who joins later or reconnects mid-round loads the current merged state instantly. Each device also keeps a local mirror, so flowing keeps working if the connection drops.

- **An agentic AI with real tool access, not a chatbot wrapper.** Warroom AI doesn't just answer questions about your prep — it takes multi-step actions with actual tool calls: searching Logos and Open Evidence in hidden webviews, cutting and saving evidence cards with verbatim body text, pulling judge paradigms and disclosures from Tabroom/OpenCaselist, editing cells directly in your flow sheets, navigating you to any view in the app, and running a full-text search across your cases, opponents, judges, tournaments, and speech docs. It runs a genuine agent loop (plan → call tools → observe results → continue) rather than a single-shot completion.

## Also included

- **Case & block organizer** — build and manage your aff and neg cases, blocks, and cards in a structured library
- **Evidence cutting** — paste a URL or article and cut formatted cards directly in the app
- **Card library** — search and browse your full evidence library with tag filtering
- **Global search (⌘K)** — a command-palette search across cases, speech docs, flows, opponents, judges, tournaments, topics, and AI chat history
- **Opponent scouting** — track opposing teams, their tendencies, and past round history
- **Tournament tracking** — save tournaments, rounds, and results; monitor live round data from Tabroom
- **Judge lookup** — pull judge paradigms and notes from Tabroom
- **Flowing** — take flows during rounds with a structured flow editor (live co-flowing described above)
- **Speech doc viewer** — open and read `.docx` speech docs in-app
- **Team chat** — real-time messaging with your team during prep and rounds
- **Google Drive integration** — access your Drive files without leaving the app
- **Open Evidence & Logos** — search open-source evidence databases directly from the app
- **NSDA Topics** — browse current policy, PF, and LD topics
- **Prep / Round mode** — toggle between prep mode and round mode to keep your workspace focused
- **Three visual themes** — Calm Native, Warm Paper, and Sharp Editorial, each with light and dark variants

## Tech stack

Electron · React · Tailwind CSS · Zustand · electron-vite · Supabase (team chat + Realtime CRDT sync) · Yjs · Gemini API

All debate data is stored locally — no cloud sync, no account required. Your Gemini API key is encrypted via Electron `safeStorage`.

## Download

Pre-built installers are available on the [Releases](https://github.com/BlueCheeseburger/warroom/releases) page for macOS (Apple Silicon and Intel) and Windows.

## Build from source

```bash
npm install
npm run dev          # development
npm run dist:mac     # macOS .dmg (Apple Silicon + Intel)
npm run dist:win     # Windows .exe
```

## Storage

All data lives at `app.getPath('userData')/warroom/db.json`. No accounts, no cloud sync.
