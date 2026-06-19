# Warroom

Warroom is a desktop app built for competitive policy debaters. It brings together everything you need for prep and in-round performance into one place — case and block management, evidence cutting, opponent scouting, tournament tracking, flowing, and an AI assistant — all running locally with no account required.

## Features

- **Case & block organizer** — build and manage your aff and neg cases, blocks, and cards in a structured library
- **Evidence cutting** — paste a URL or article and cut formatted cards directly in the app
- **Card library** — search and browse your full evidence library with tag filtering
- **Opponent scouting** — track opposing teams, their tendencies, and past round history
- **Tournament tracking** — save tournaments, rounds, and results; monitor live round data from Tabroom
- **Judge lookup** — pull judge paradigms and notes from Tabroom
- **Flowing** — take flows during rounds with a structured flow editor
- **Speech doc viewer** — open and read `.docx` speech docs in-app
- **Warroom AI** — an AI assistant powered by Gemini that can search evidence, cut cards, scout opponents, look up judges, summarize cases, suggest blocks, and more
- **Team chat** — real-time messaging with your team during prep and rounds
- **Google Drive integration** — access your Drive files without leaving the app
- **Open Evidence & Logos** — search open-source evidence databases directly from the app
- **NSDA Topics** — browse current policy, PF, and LD topics
- **Prep / Round mode** — toggle between prep mode and round mode to keep your workspace focused
- **Three visual themes** — Calm Native, Warm Paper, and Sharp Editorial, each with light and dark variants

## Tech stack

Electron · React · Tailwind CSS · Zustand · electron-vite · Supabase (team chat) · Gemini API

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
