# Warroom

Warroom is a desktop app for competitive policy debaters. It's built around the stuff prep actually involves — cases and blocks, cutting evidence, scouting opponents, tracking tournaments, flowing — plus an AI assistant, all running locally with no account required.

At a glance it looks like a case organizer, which, fair, it mostly is. But a few things under the hood aren't what you'd expect from that description:

## A few things worth knowing about

**It keeps working after you close it.** There's a background daemon that watches for judge paradigm updates, opponent disclosure changes, live Tabroom pairings, ballot results, and new topic drops — and it keeps notifying you even with Warroom fully quit. To pull this off it relaunches the same Electron binary headless (a separate process wouldn't have access to the credentials Warroom already decrypted and stored via the OS keychain), and it's registered as a real OS-level scheduled task — `launchd` on macOS, Task Scheduler on Windows — so it's not something you have to remember to start. It's careful not to step on the running app: a small heartbeat file tells the daemon whether Warroom is already open, so you never get double notifications. During an active tournament it stays resident and checks every 60 seconds instead of the usual 10 minutes. Clicking one of its notifications reopens the app straight to the relevant judge, opponent, or round, even from a cold start.

**Flowing is actually collaborative, not just shared.** If you and a teammate open the same flow, you're not looking at "a shared file" — you're both editing the same live document, and it merges your keystrokes character by character as you type, even in the same cell at the same time, with no locking and no "someone else has this open" conflicts. That's a CRDT (Yjs) under the hood, syncing over a realtime channel rather than writing to a database on every keystroke. If someone joins late or their connection drops and comes back, they just catch up to the current state. It also keeps a local copy on each device, so a shaky connection at a tournament doesn't mean losing your flow.

**The AI actually does things, not just answers.** Warroom AI isn't a chat window bolted onto your data — it can search Logos and Open Evidence for you, cut and save evidence cards, look up judge paradigms and pull opponent disclosures, edit your flow sheets directly, navigate you around the app, and search across everything you've saved. It plans, calls tools, looks at what came back, and keeps going — a real multi-step agent, not a single autocomplete.

## Everything else it does

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
