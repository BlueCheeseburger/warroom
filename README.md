# Warroom

Desktop prep tool for competitive policy debaters. Electron + React + Tailwind. Local-only storage.

## Quick start

```bash
npm install
npm run dev
```

## Build

```bash
npm run dist:mac    # .dmg (arm64 + x64)
npm run dist:win    # .exe
```

## Storage

All data lives at `app.getPath('userData')/warroom/db.json`. No accounts, no cloud sync. Gemini API key is encrypted via Electron `safeStorage`.

## Phase status

- [x] Phase 1 — Scaffold + shell
- [ ] Phase 2 — Case/block/card organizer
- [ ] Phase 3 — Prep/Round mode polish
- [ ] Phase 4 — Gemini AI features
- [ ] Phase 5 — OpenCaselist integration
- [ ] Phase 6 — Mission brief
- [ ] Phase 7 — Tournament mode
