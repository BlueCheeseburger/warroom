import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../store/appStore';

// ─── Section helpers ──────────────────────────────────────────────────────────

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-semibold text-ink mb-3 mt-8 first:mt-0 flex items-center gap-2">
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-ink mb-1.5 mt-4">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink/70 leading-relaxed mb-2">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-1 mb-3 pl-4">{children}</ul>;
}

function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="text-sm text-ink/70 leading-relaxed list-disc list-outside">
      {children}
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="px-1 py-0.5 rounded text-xs font-mono"
      style={{ background: 'var(--bg-elevated)', color: 'rgb(var(--ink-rgb))' }}
    >
      {children}
    </code>
  );
}

function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    blue: '#3b82f6',
    purple: '#8b5cf6',
    amber: '#f59e0b',
    emerald: '#10b981',
    rose: '#f43f5e',
  };
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: colors[color] + '22', color: colors[color] }}
    >
      {children}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-4 mb-4"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
    >
      {children}
    </div>
  );
}

// ─── TOC ──────────────────────────────────────────────────────────────────────

const TOC_SECTIONS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'stack',       label: 'Tech stack' },
  { id: 'data-model',  label: 'Data model' },
  { id: 'navigation',  label: 'Navigation & modes' },
  { id: 'cases',       label: 'Cases & blocks' },
  { id: 'library',     label: 'Card library' },
  { id: 'opponents',   label: 'Opponents' },
  { id: 'tournaments', label: 'Tournaments & rounds' },
  { id: 'monitor',     label: 'Tabroom live monitor' },
  { id: 'background',  label: 'Background notifications' },
  { id: 'flows',       label: 'Flows' },
  { id: 'speech-doc',  label: 'Speech doc viewer' },
  { id: 'impact-calc', label: 'Impact Calc' },
  { id: 'find-cards',  label: 'FindCards (Logos)' },
  { id: 'open-ev',     label: 'Open Evidence' },
  { id: 'agent',       label: 'Warroom Agent (AI)' },
  { id: 'chat',        label: 'Team chat' },
  { id: 'gdrive',      label: 'Google Drive' },
  { id: 'settings',    label: 'Settings' },
  { id: 'storage',     label: 'Storage & security' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'topics',      label: 'NSDA Topics' },
  { id: 'ai-guide',    label: 'AI help guide' },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function Documentation() {
  const { setView } = useApp();
  const [activeSection, setActiveSection] = useState('overview');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id.replace('doc-', ''));
          }
        }
      },
      { root: container, rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );
    TOC_SECTIONS.forEach(({ id }) => {
      const el = container.querySelector(`#doc-${id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  function scrollTo(id: string) {
    setActiveSection(id);
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const activeSectionLabel = TOC_SECTIONS.find((s) => s.id === activeSection)?.label ?? '';

  return (
    <div className="flex h-full min-h-0" style={{ background: 'var(--bg-main)' }}>
      {/* Sidebar TOC */}
      <div
        className="w-44 shrink-0 flex flex-col py-6 px-3 overflow-y-auto scroll-thin"
        style={{ borderRight: '1px solid var(--border-side)' }}
      >
        <button
          className="flex items-center gap-1.5 text-xs mb-5 font-medium"
          style={{ color: 'var(--nav-inactive-color)', background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={() => setView({ kind: 'settings' })}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 15L7 10L12 5" />
          </svg>
          Settings
        </button>
        <div className="label mb-2" style={{ fontSize: 9 }}>Contents</div>
        <nav className="space-y-0.5">
          {TOC_SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className="w-full text-left px-2 py-1 rounded-lg text-xs transition"
              style={{
                background: activeSection === s.id ? 'var(--item-selected-bg)' : 'transparent',
                color: activeSection === s.id ? 'var(--item-selected-text)' : 'var(--nav-inactive-color)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: activeSection === s.id ? 600 : 400,
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin px-8 py-8 max-w-3xl">
        <div className="label mb-1">Warroom</div>
        <h1 className="text-xl font-bold text-ink mb-0.5">Project Documentation</h1>
        <p className="text-sm font-medium mb-1" style={{ color: '#4285F4' }}>
          {activeSectionLabel}
        </p>
        <p className="text-xs mb-8" style={{ color: 'var(--nav-inactive-color)' }}>
          Last updated: May 2026
        </p>

        {/* ── Overview ──────────────────────────────────────────────── */}
        <section id="doc-overview">
          <H2>Overview</H2>
          <P>
            Warroom is a cross-platform desktop application built for competitive debaters.
            It is primarily designed for policy debate but also supports Public Forum (PF) and Lincoln-Douglas (LD).
            It centralises everything a debate team needs during prep and at tournament: case management,
            evidence cards, opponent scouting, round tracking, live tournament monitoring, team chat,
            and an AI assistant (Warroom AI).
          </P>
          <P>
            It runs as a native Electron app on macOS and Windows. All core data is stored locally
            (no account required to use prep features); collaborative features (chat, sharing) use
            Supabase for real-time sync.
          </P>
          <div className="flex flex-wrap gap-2 mb-4">
            <Badge color="blue">Electron</Badge>
            <Badge color="purple">React + TypeScript</Badge>
            <Badge color="amber">Warroom AI</Badge>
            <Badge color="emerald">Supabase</Badge>
          </div>
        </section>

        {/* ── Tech stack ────────────────────────────────────────────── */}
        <section id="doc-stack">
          <H2>Tech stack</H2>
          <Card>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><span className="font-medium text-ink">Runtime</span><span className="ml-2 text-ink/60">Electron 42</span></div>
              <div><span className="font-medium text-ink">UI framework</span><span className="ml-2 text-ink/60">React 18 + TypeScript</span></div>
              <div><span className="font-medium text-ink">Bundler</span><span className="ml-2 text-ink/60">Vite via electron-vite</span></div>
              <div><span className="font-medium text-ink">Styling</span><span className="ml-2 text-ink/60">Tailwind CSS + CSS variables</span></div>
              <div><span className="font-medium text-ink">State</span><span className="ml-2 text-ink/60">Zustand</span></div>
              <div><span className="font-medium text-ink">Backend/Chat</span><span className="ml-2 text-ink/60">Supabase (Postgres + realtime)</span></div>
              <div><span className="font-medium text-ink">AI</span><span className="ml-2 text-ink/60">Google Gemini API</span></div>
              <div><span className="font-medium text-ink">Docx parsing</span><span className="ml-2 text-ink/60">mammoth + docx-preview</span></div>
              <div><span className="font-medium text-ink">Spreadsheets</span><span className="ml-2 text-ink/60">xlsx (SheetJS)</span></div>
              <div><span className="font-medium text-ink">PDF parsing</span><span className="ml-2 text-ink/60">pdf-parse</span></div>
              <div><span className="font-medium text-ink">Fuzzy search</span><span className="ml-2 text-ink/60">Fuse.js</span></div>
              <div><span className="font-medium text-ink">HTML parsing</span><span className="ml-2 text-ink/60">cheerio</span></div>
            </div>
          </Card>
          <H3>Process architecture</H3>
          <P>
            The app follows Electron's two-process model. <Code>electron/main.ts</Code> is the main
            process — it handles file I/O, secure storage, all network requests to external APIs
            (Tabroom, OpenCaselist, Debate Land, Gemini, Google Drive), and the Tabroom monitor
            background worker. <Code>electron/preload.ts</Code> exposes a <Code>window.warroom</Code>{' '}
            IPC bridge to the renderer. The renderer (<Code>src/</Code>) is a React SPA that never
            makes direct network calls.
          </P>
        </section>

        {/* ── Data model ────────────────────────────────────────────── */}
        <section id="doc-data-model">
          <H2>Data model</H2>
          <P>
            All local data lives in a single <Code>DB</Code> object (defined in <Code>src/types.ts</Code>)
            persisted as <Code>userData/warroom/db.json</Code>.
          </P>
          <Card>
            <div className="space-y-3 text-sm">
              <div>
                <span className="font-semibold text-ink">Case</span>
                <span className="ml-2 text-ink/60">id · name · side (aff|neg) · blocks[] · shared?</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Block</span>
                <span className="ml-2 text-ink/60">id · caseId · title · type · cards[] · createdAt · updatedAt</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Card</span>
                <span className="ml-2 text-ink/60">id · blockId · tag · cite · body · year · flagged · createdAt</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Opponent</span>
                <span className="ml-2 text-ink/60">id · teamName · school · teamId · caselist · notes · disclosures · roundsAgainst[] · stats · tabroom_entry_id</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Tournament</span>
                <span className="ml-2 text-ink/60">id · name · date · start · end · location · event_type · rounds[] · tabroom_id · tabroom_event_id · tabroomEntryCode</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Round</span>
                <span className="ml-2 text-ink/60">id · tournamentId · number · side · opponentId · room · time · result · notes · judgeNotes · argsRead[] · argsWorked[] · argsFailed[] · judgeName · judgeParadigm · autoFilled · isBye</span>
              </div>
            </div>
          </Card>
          <P>
            Relationships use string ID references (e.g. <Code>Block.cards</Code> is an array of
            Card IDs). The DB root also stores <Code>manualWins</Code> and <Code>manualLosses</Code>{' '}
            for adjusting the W/L record beyond round-derived totals.
          </P>
        </section>

        {/* ── Navigation ────────────────────────────────────────────── */}
        <section id="doc-navigation">
          <H2>Navigation & modes</H2>
          <P>
            Navigation is view-stack-free: one active <Code>View</Code> at a time, stored in Zustand.
            The sidebar provides top-level navigation; views are rendered by a <Code>Router</Code>{' '}
            function in <Code>App.tsx</Code>. Three "persistent" webviews (FindCards, OpenEv, AgentSearchViews)
            are always mounted but hidden so they don't reload on navigation.
          </P>
          <H3>Views</H3>
          <UL>
            <LI><Code>home</Code> — Dashboard with stats, live/upcoming tournament card, recent cases</LI>
            <LI><Code>case</Code> — Individual case editor with all blocks</LI>
            <LI><Code>block</Code> — Single block with its evidence cards</LI>
            <LI><Code>library</Code> — Full card library across all cases/blocks</LI>
            <LI><Code>speech-doc</Code> — In-app .docx viewer (also used as speech doc editor)</LI>
            <LI><Code>tournaments</Code> — Tournament list</LI>
            <LI><Code>tournament</Code> — Tournament detail with round list</LI>
            <LI><Code>round</Code> — Mission Brief (pre-round prep screen)</LI>
            <LI><Code>opponents</Code> — Opponent search & list</LI>
            <LI><Code>opponent</Code> — Opponent profile with disclosures, stats, AI scout report</LI>
            <LI><Code>settings</Code> — App settings (supports <Code>scrollTo</Code> param)</LI>
            <LI><Code>flow</Code> — Spreadsheet flow viewer/editor</LI>
            <LI><Code>logos</Code> — FindCards Logos webview (persistent)</LI>
            <LI><Code>open-ev</Code> — Open Evidence webview (persistent)</LI>
            <LI><Code>gdrive</Code> — Google Drive file browser</LI>
            <LI><Code>docs</Code> — This documentation page</LI>
          </UL>
          <H3>App modes</H3>
          <P>
            Two modes toggled in the sidebar: <strong>Prep</strong> (default, for case building and
            scouting) and <strong>Round</strong> (tournament day, streamlined view focused on current
            round). The mode is persisted per session.
          </P>
        </section>

        {/* ── Cases & Blocks ─────────────────────────────────────────── */}
        <section id="doc-cases">
          <H2>Cases & blocks</H2>
          <P>
            Cases are the top-level unit of prep — an aff or neg position. Each case contains
            <strong> blocks</strong> (e.g. "T-Topicality", "Heg DA", "2AC vs DA"). Blocks hold
            individual evidence <strong>cards</strong> (tag + cite + body text + year).
          </P>
          <H3>Card extraction</H3>
          <P>
            Cards can be imported from a <Code>.docx</Code> file via AI extraction. The main process
            parses the file with mammoth, then sends the text to Warroom AI (using the
            <Code>extractCards</Code> IPC handler) which returns structured{' '}
            <Code>{'{ tag, cite, body, year }'}</Code> objects. The cards are created in the selected
            block.
          </P>
          <H3>Block suggestions</H3>
          <P>
            On the Mission Brief (round view), Warroom can suggest which blocks to read against an
            opponent's positions using <Code>suggestBlocks</Code> — Warroom AI compares the opponent's
            disclosed arguments against your block list and returns a ranked selection.
          </P>
        </section>

        {/* ── Library ────────────────────────────────────────────────── */}
        <section id="doc-library">
          <H2>Card library</H2>
          <P>
            The <strong>Cards</strong> view (sidebar label "Cards") aggregates all cards across every case and block.
            Cards can be searched, flagged, and clicked to open their block. Flagged cards are highlighted for quick reference.
            Cards can be exported or shared as attachments in team chat.
          </P>
          <P>
            <strong>＋ Cut from PDF.</strong> The Cards header has a button to import a PDF — for example a web article
            saved via your browser's <em>Print → Save as PDF</em>. Warroom AI reads the PDF and cuts debate cards from it
            using the card-cutting format: it writes a declarative tag, formats the cite (author, date, title, URL), and
            trims each body to the verbatim sentences that prove the tag. You review the cut cards in a modal — edit the
            tag, cite, or year inline and uncheck any you don't want — then save. Saved cards land in a <Code>Cut Cards</Code>{' '}
            case and appear in the Cards view immediately. The PDF must contain selectable text (scanned image-only PDFs
            can't be cut), and this requires a working AI key.
          </P>
        </section>

        {/* ── Opponents ─────────────────────────────────────────────── */}
        <section id="doc-opponents">
          <H2>Opponents</H2>
          <P>
            Opponent profiles store scouting data for teams you might face. Each opponent tracks:
          </P>
          <UL>
            <LI>Team name, school, notes</LI>
            <LI>
              <strong>OpenCaselist disclosures</strong> — pulled via the OC API: rounds disclosed,
              aff position name, neg position names, raw round data, raw cite text
            </LI>
            <LI>
              <strong>AI Scout report</strong> — Warroom AI synthesises the OC data into a readable
              aff/neg summary with citations (stored as <Code>disclosures.aiScout</Code>)
            </LI>
            <LI>
              <strong>Debate Land stats</strong> — career OTR, peak rank, avg speaks, win%, bids,
              total record (via <Code>window.warroom.dl</Code> IPC)
            </LI>
            <LI>Rounds against this opponent (linked by round ID)</LI>
          </UL>
          <H3>Opponent search</H3>
          <P>
            Opponents can be looked up by team name via OpenCaselist full-text search and/or
            Debate Land search. The app de-duplicates across local DB and search results.
          </P>
        </section>

        {/* ── Tournaments & Rounds ───────────────────────────────────── */}
        <section id="doc-tournaments">
          <H2>Tournaments & rounds</H2>
          <H3>Tournaments</H3>
          <P>
            Tournaments store name, dates (start/end), location, event type, and an optional
            Tabroom tournament ID + event ID for monitor integration. An entry code
            (e.g. <Code>Emery BL</Code>) is also stored and used by the live monitor.
          </P>
          <H3>Rounds</H3>
          <P>
            Each round within a tournament records: round number, side (aff/neg), opponent,
            room, time, result (win/loss/pending), judge name + paradigm text, and notes.
            Three argument tracking lists are available: <Code>argsRead</Code>, <Code>argsWorked</Code>,
            <Code>argsFailed</Code>. Rounds created by the Tabroom monitor are flagged{' '}
            <Code>autoFilled: true</Code>.
          </P>
          <H3>Mission Brief</H3>
          <P>
            The round view (<Code>MissionBrief</Code>) is the pre-round prep screen. It shows:
            opponent info and disclosures, judge paradigm, AI-suggested blocks, and a notes editor.
            It can be accessed by clicking a round in the tournament view.
          </P>
        </section>

        {/* ── Tabroom Monitor ────────────────────────────────────────── */}
        <section id="doc-monitor">
          <H2>Tabroom live monitor</H2>
          <P>
            The Tabroom monitor polls Tabroom's public API in the background for new pairings
            at an active tournament. When a new round is posted it:
          </P>
          <UL>
            <LI>Fires an OS-level notification</LI>
            <LI>Scrapes the judge's paradigm from Tabroom</LI>
            <LI>Pulls opponent disclosures from OpenCaselist</LI>
            <LI>Fetches opponent stats from Debate Land</LI>
            <LI>Auto-creates the round entry in your tournament (marked <Code>autoFilled</Code>)</LI>
            <LI>Navigates directly to the new round's Mission Brief</LI>
          </UL>
          <P>
            To start: open a tournament → click <strong>Start Monitor</strong> → enter your entry
            code (the team code used on Tabroom, e.g. <Code>Emery BL</Code>). No Tabroom login
            required — uses the public pairing API. Requires OpenCaselist credentials (set in
            Settings) for disclosure fetching.
          </P>
          <P>
            The monitor runs in the main process (<Code>electron/main.ts</Code>) as a persistent
            background loop. Events are sent to the renderer via IPC using{' '}
            <Code>window.warroom.tabroom.monitor.onNewRound</Code> etc.
          </P>
        </section>

        {/* ── Background notifications (daemon) ──────────────────────── */}
        <section id="doc-background">
          <H2>Background notifications</H2>
          <P>
            Warroom's five watchers — followed-judge paradigm updates, opponent disclosure
            updates, the live Tabroom round monitor, the Tabroom inbox (ballot results), and the
            NSDA topic scraper — keep notifying you <strong>even when the app is closed</strong>.
            This is handled by a headless background daemon: the same app binary relaunched with a{' '}
            <Code>--daemon</Code> flag (so it can decrypt your stored Tabroom / OpenCaselist
            credentials), managed by a <Code>launchd</Code> LaunchAgent on macOS and a Task
            Scheduler task (<Code>WarroomDaemon</Code>) on Windows.
          </P>
          <P>
            The daemon is <strong>hybrid</strong>: while a tournament monitor is active it stays
            resident and polls every ~60s for fast round/result alerts; otherwise it is woken on an
            interval (~10&nbsp;min) to run the judge, opponent, and topic checks, then exits. It is
            installed automatically on first launch (packaged macOS &amp; Windows builds) with a
            one-time heads-up notification; the Windows uninstaller removes the scheduled task.
          </P>
          <P>
            The daemon and the open app <strong>never double-notify</strong>: the GUI writes a
            heartbeat (<Code>runtime/heartbeat.json</Code>) every 20s, and the daemon defers all
            work whenever the app is alive — it only takes over when the app is closed. Periodic
            checks are cadence-gated via <Code>runtime/daemon-runs.json</Code>, and the live
            monitor config + seen-round dedup state are shared through{' '}
            <Code>runtime/monitors.json</Code> so handoffs never re-fire old alerts.
          </P>
          <P>
            Clicking a daemon notification deep-links back into the app (launching it if needed) via
            the <Code>warroom://</Code> URL scheme — e.g. <Code>warroom://open/judge/&lt;id&gt;</Code>,{' '}
            <Code>warroom://open/opponent/&lt;id&gt;</Code>,{' '}
            <Code>warroom://open/tournament/&lt;id&gt;?round=&lt;n&gt;</Code>, and{' '}
            <Code>warroom://topics/&lt;pf|ld&gt;</Code>.
          </P>
        </section>

        {/* ── Flows ─────────────────────────────────────────────────── */}
        <section id="doc-speech-timer">
          <H2>Speech Timer</H2>
          <P>
            A built-in countdown timer lives in the title bar at the top of the app — always visible
            without navigating anywhere. Click the speech-type dropdown (e.g. "Constructive",
            "Cross-Ex") to select which speech to time, then click the time display to start or
            pause the countdown. A reset button sits next to the timer.
          </P>
          <P>
            For Policy, a small <Code>HS</Code> / <Code>CLG</Code> pill to the left of the
            dropdown switches between high school and college speech lengths. Speech times auto-match
            the active debate event (Policy, PF, or LD). The display turns amber in the last 30
            seconds and red when time expires; it then counts up as overtime.
          </P>
          <P>
            Warroom AI can fully control the timer — start, pause, reset, select a speech type, or
            switch HS/CLG — by asking in plain language (e.g. "start the timer", "set it to 1AR",
            "switch to college times", "how much time is left?").
          </P>
        </section>

        <section id="doc-flows">
          <H2>Flows</H2>
          <P>
            Flows are <Code>.xlsx</Code> spreadsheets opened in-app using SheetJS. They appear in
            the sidebar under a "Flows" section. Opening a <Code>.xlsx</Code> file from Finder/Explorer
            registers it in the flows index and opens the flow view automatically. Flows can be
            shared via team chat with view or edit permissions.
          </P>
          <P>
            Each flow has an ID, name, and debate event type. The flows index is persisted separately
            from the main DB in <Code>flows_index.json</Code>.
          </P>
          <H3>Importing a flow</H3>
          <P>
            An <strong>import button</strong> sits next to the <Code>+</Code> in the sidebar's Flow
            section. Clicking it opens a file picker for an existing flow spreadsheet
            (<Code>.xlsx</Code>); the app parses it and creates a new flow named after the file. Each
            <strong> worksheet (tab)</strong> in the workbook becomes its own flow sheet in the app.
          </P>
          <P>
            Import is <strong>very robust</strong> — it works no matter how the spreadsheet is laid
            out. It first tries to auto-detect the structure algorithmically, recognizing
            speech-column headers (for policy: <Code>1AC</Code>, <Code>1NC</Code>, <Code>2AC</Code>,{' '}
            <Code>2NC/1NR</Code>, <Code>1AR</Code>, <Code>2NR</Code>, <Code>2AR</Code>, plus PF
            column layouts). Real policy debate has 8 speeches, but the app merges{' '}
            <strong>2NC + 1NR</strong> (the neg block) into a single column, so a standard 8-column
            source sheet maps cleanly onto the app's layout. If it can't confidently figure out a
            sheet's structure, it falls back to <strong>Warroom AI</strong> to interpret the
            spreadsheet and map the columns correctly. Both policy and PF flows are supported.
          </P>
          <P>
            The imported flow appears in the sidebar and can be renamed and edited like any other
            flow.
          </P>
          <H3>Editing flows</H3>
          <P>
            The flow editor works like a paper flow with spreadsheet conveniences. Cells support{' '}
            <strong>rich text</strong> — <Code>⌘B</Code> for bold, <Code>⌘I</Code> for italic,{' '}
            <Code>⌘U</Code> for underline, and <Code>⌘⇧X</Code> for strikethrough (the standard
            keyboard shortcuts). Cells <strong>auto-grow</strong> to fit their text.
          </P>
          <P>
            <strong>Keyboard navigation:</strong> arrow keys move between cells when the caret is at
            a cell's edge (Up / Down / Left / Right); <Code>Tab</Code> and <Code>Enter</Code> move to
            the next column / row; <Code>Alt+↑</Code> / <Code>Alt+↓</Code> shift a cell's content
            between rows.
          </P>
          <P>
            <strong>Draw arrows:</strong> the curved-arrow toolbar button enters draw mode — click a
            source cell, then a target cell, to draw a connector arrow linking an argument to its
            answer across columns (like the line on a paper flow). Click the <Code>×</Code> on an
            arrow's midpoint to delete it; press <Code>Esc</Code> to cancel. Arrows are saved per
            sheet.
          </P>
          <P>
            <strong>Find (<Code>⌘F</Code>):</strong> a find bar searches across all sheets in the
            flow. Enter / Shift+Enter jump between matches; Esc closes. (Mirrors the speech-doc
            viewer's find.)
          </P>
          <P>
            <strong>Undo / redo:</strong> <Code>⌘Z</Code> undoes and <Code>⌘⇧Z</Code> (or{' '}
            <Code>⌘Y</Code>) redoes, also available as toolbar buttons. Undo covers text edits, column
            changes, colors, and arrows.
          </P>
          <P>
            <strong>Column colors:</strong> each column header has an always-visible <Code>▾</Code>{' '}
            menu with a color palette to recolor that column; "Reset to default" restores the side
            color. The default Aff/Pro and Neg/Con column colors can be set for all flows in{' '}
            <strong>Settings → Flow colors</strong>.
          </P>
          <H3>Live collaboration (realtime co-flowing)</H3>
          <P>
            The <strong>Live</strong> toolbar button (two-people icon) turns a flow into a shared
            realtime session — two or more teammates can type into the same flow at once and see
            each other's edits appear <strong>character-by-character</strong>, like Google Docs.
            A green "Live" pill shows who else is present, and each teammate's active cell is ringed
            and tagged in their color.
          </P>
          <P>
            Under the hood the flow's editable state is mapped onto a <strong>Yjs CRDT</strong>{' '}
            document (<Code>src/lib/flowDoc.ts</Code>). Each cell is a <Code>Y.Text</Code> holding its
            HTML, so concurrent edits merge deterministically — even two people in the same cell never
            lose text (the cell <em>this</em> user is focused in is left alone until blur to protect
            the caret). Layout/structure (columns, colors, variant, sheet names) lives in a{' '}
            <Code>meta</Code> map and the <Code>sheets</Code> array as last-write-wins.
          </P>
          <P>
            <strong>Transport:</strong> Yjs update and awareness bytes ride a Supabase{' '}
            <em>Realtime broadcast</em> channel keyed by the flow's unguessable id (no per-keystroke
            DB writes). Durability is a debounced base64 snapshot of the doc in a new{' '}
            <Code>flows</Code> table (team-scoped RLS), so a teammate who opens the flow later — or
            reconnects — loads the current merged state. The Supabase client lives in the main
            process; the renderer talks to it through the <Code>flowSync:*</Code> IPC bridge
            (<Code>src/lib/flowSync.ts</Code>). Sharing a live flow sends a <em>pointer</em> (same id
            + team) so recipients join the same doc instead of getting a frozen copy. Each device
            keeps a local <Code>flow_data_*</Code> mirror so the flow still works offline. (Requires a
            configured Supabase backend and the <Code>flows</Code> table from{' '}
            <Code>supabase/schema.sql</Code>.)
          </P>
        </section>

        {/* ── Speech Doc ─────────────────────────────────────────────── */}
        <section id="doc-speech-doc">
          <H2>Speech doc viewer</H2>
          <P>
            The <Code>SpeechDocViewer</Code> renders <Code>.docx</Code> files in-app using{' '}
            <Code>docx-preview</Code>. It is always mounted (hidden when inactive) so it preserves
            state across navigation. Recent docs are tracked in <Code>localStorage</Code> under{' '}
            <Code>warroom-speech-doc-recents</Code>.
          </P>
          <P>
            Opening a <Code>.docx</Code> from Finder triggers the <Code>onFileOpen</Code> IPC event
            and navigates to the speech-doc view. Speech docs can also be attached to chat messages
            and shared with teammates.
          </P>
          <P>
            The toolbar includes <strong>Focus mode</strong> (hides body text, leaving only card
            structure and highlighted / underlined runs), <strong>Outline</strong> (heading
            navigation), <strong>Find</strong> (in-doc search), <strong>Reading time</strong> /
            auto-scroll, <strong>Send to Flow</strong>, <strong>Cross-Ex Practice</strong>, and{' '}
            <strong>Card Credibility</strong>. The open document's name is always shown in the
            toolbar between the tool cluster and the AI-tool pills.
          </P>
          <P>
            <strong>Office-font substitution.</strong> macOS ships no Calibri, so{' '}
            <Code>docx-preview</Code>'s inline <Code>font-family: Calibri</Code> would fall back to a
            serif (Times New Roman-like) font — wrong for nearly all debate docs. A one-time global{' '}
            <Code>@font-face</Code> block redefines the Office families (Calibri, Cambria, …) with{' '}
            <Code>local()</Code> source chains that resolve to real Office fonts when installed, else
            metric-compatible open fonts, else a clean system sans-serif — so Calibri docs render
            sans-serif everywhere.
          </P>
          <H3>OpenCaseList-imported cases</H3>
          <P>
            Cases imported from an opponent's disclosure (<strong>+ Save to Cases</strong>) are
            stored in <Code>db.cases</Code> with an <Code>ocSource</Code> object and routed by the{' '}
            <Code>Router</Code> to this same <Code>SpeechDocViewer</Code> (not the block-based{' '}
            <Code>CaseView</Code>), so they get the full toolset. The docx bytes are cached in{' '}
            <Code>localStorage</Code> under <Code>warroom-oc-docx-&lt;url&gt;</Code> — pre-warmed at
            import — so reopening is instant and offline with no re-fetch. The toolbar shows an{' '}
            <strong>Imported from [team]</strong> label and a <strong>Check for changes</strong>{' '}
            button that re-fetches, compares byte length, and reloads if the disclosure was updated.
          </P>
          <H3>Find (in-document search)</H3>
          <P>
            The magnifier button (or <Code>⌘F</Code> / <Code>Ctrl+F</Code>) opens a find bar.
            Matches are painted with the <strong>CSS Custom Highlight API</strong> (
            <Code>CSS.highlights</Code> + <Code>Highlight</Code> + <Code>Range</Code>) instead of
            wrapping nodes in <Code>&lt;mark&gt;</Code>, so the document DOM is never mutated — focus
            mode, outline ids, and dark-mode fixes stay intact. Enter / Shift+Enter (or the chevrons)
            move between matches and center the active one; a counter shows "current / total". Press
            Esc to close.
          </P>
          <H3>Reading time &amp; auto-scroll</H3>
          <P>
            The hourglass button opens a popover estimating how long the doc takes to read aloud at your
            words-per-minute, which is saved between sessions. It counts only spoken words — headings
            (pockets / hats / blocks / tags), highlighted card text, and the bold author + date of each
            cite — not plain underlined / bold body text, the full small-text cites, or unread body, so
            the estimate matches Verbatim's highlighted-word count. Preset chips set
            ~175 wpm (lay / traditional) and ~300 wpm (flow / spreading). Select a portion of the doc
            first and it estimates just that selection. <strong>Auto-scroll</strong> scrolls the doc at
            your wpm (a <Code>requestAnimationFrame</Code> loop paced by{' '}
            <Code>scrollHeight / wordCount</Code>); a floating control lets you pause / resume, change
            speed live, or stop.
          </P>
          <H3>Send to Flow</H3>
          <P>
            The grid-with-arrow button opens a popover that pushes a card or heading from your speech doc
            straight into a flow (<Code>.xlsx</Code>) sheet, like Verbatim's Send-to-Flow. Pick a{' '}
            <strong>mode</strong> — <strong>Selection</strong> (the text you've selected, or the heading at
            the top of the view if nothing is selected) or <strong>Tag + cite</strong> (the current card's
            tag plus its author + date) — then choose the target <strong>flow</strong>, <strong>sheet</strong>,
            and <strong>column</strong>. A live preview shows exactly what will be sent. On send, the content
            lands in the <strong>next empty row</strong> of that column; if the flow is open in another view,
            it updates live.
          </P>
          <H3>Outline (heading navigation)</H3>
          <P>
            The <strong>Outline</strong> button opens a left-hand panel listing every heading in the
            document — pockets, hats, blocks, and card tags — indented by level, so you can jump
            anywhere in one click instead of scrolling. <Code>docx-preview</Code> tags each paragraph
            with a class from its style id (<Code>docx-render_heading4</Code> for a Verbatim tag,
            etc.), so <Code>buildOutline</Code> detects heading paragraphs, stamps each with a stable{' '}
            <Code>data-outline-id</Code>, and records its level and text. Clicking an entry scrolls to
            and flashes that heading; a scroll listener keeps the entry for whatever you're currently
            reading highlighted. Prev / next chevron buttons in the <strong>outline header</strong> step
            through headings relative to the active one. Works on docs that use Word / Verbatim heading
            styles.
          </P>
          <P>
            The outline <strong>auto-shows only on the first document you open each app launch</strong>;
            after that it stays in whatever state you left it. A <strong>layers button</strong> (e.g.
            "2/4") in the header cycles how many heading levels are shown — collapse a long file to just
            pockets / hats for fast high-level navigation, then expand back. Cards that are unusually{' '}
            <strong>over- or under-highlighted</strong> versus the rest of the doc (computed by comparing
            each card's highlight ratio against the doc's mean ± 1.5σ) get an amber warning badge; click it
            for an explanation and a permanent dismiss (saved per-doc).
          </P>
          <H3>Cross-Ex Practice</H3>
          <P>
            The <strong>Cross-Ex Practice</strong> button opens a right-hand panel where Warroom AI
            generates targeted cross-examination questions for the open document — built from your{' '}
            <strong>highlighted</strong> text (what the opponent actually reads) — each paired with a
            model answer that stays hidden behind a <strong>Show answer</strong> dropdown until you
            reveal it. Warroom AI is automatically fed the skill for whichever event you're doing
            (Policy, LD, or PF) so the questions use the right vocabulary and strategy.
          </P>
          <P>
            If a document contains both <strong>aff and neg</strong> content, questions are split into{' '}
            <strong>Aff</strong> and <strong>Neg</strong> sections, with more questions for whichever
            side has more highlighted content. If the doc has very little highlighted text or is very
            short, a warning explains you may get few or shallow questions.
          </P>
          <P>
            Each question pill has a <strong>3 more like this</strong> button that generates three
            fresh questions probing the same weakness and inserts them inline below. The footer{' '}
            <strong>Generate / Regenerate</strong> button rebuilds the set, and the{' '}
            <strong>Harder</strong> button runs a <strong>trap drill</strong>: Warroom AI asks a
            setup question, you type your answer, and it grades whether you avoided the trap or fell
            for it (springing the gotcha and giving the fix). Grading uses a fast, cheap model.
          </P>
          <P>
            Your questions are saved per-document, so they stay put when you close and reopen the
            panel, reload the doc, or restart the app — they only clear when you regenerate.
          </P>
          <H3>Card Credibility</H3>
          <P>
            A shield-icon <strong>Credibility</strong> button opens a right-hand panel that grades the
            evidentiary credibility of every card in the open doc. It is <strong>mutually exclusive</strong>{' '}
            with the Cross-Ex panel — opening one closes the other. The renderer extracts cards from the
            rendered DOM via <Code>buildCards</Code>: a "card" is a paragraph at the deepest heading level
            present (<Code>Heading4</Code> in Verbatim docs) used as the tag, plus the following
            non-heading paragraphs as the cite (capped at ~80 words / 600 chars). Headings with no
            citation under them (section headers, blank tags, analytics) are skipped. Cards are sent{' '}
            <strong>numbered</strong> to the model.
          </P>
          <P>
            The <Code>ai:scoreCards</Code> handler takes{' '}
            <Code>{'{ cards: { tag: string; cite: string }[] }'}</Code> and returns{' '}
            <Code>{'{ ok, scores?: { score, verdict, author, recency, source, claim, reason, press }[], error? }'}</Code>.
            In <strong>one AI call</strong> the model scores all cards at once and returns a JSON array in
            the <strong>same order</strong>; results map back to cards by index. Each card gets an overall{' '}
            <strong>score 0–10</strong>, a one-word <strong>verdict</strong> (Strong 8–10 / Solid 6–7 /
            Shaky 4–5 / Weak 0–3), four sub-scores (<strong>Author qualifications</strong>,{' '}
            <strong>Recency</strong>, <strong>Source quality</strong>, and <strong>Claim fit</strong> —
            whether the cite actually supports the tag's claim), a short <strong>reason</strong>, and
            a <strong>"press"</strong> line — the single best cross-examination attack on that card's
            credibility. The prompt gives the model an explicit rubric per factor: author by{' '}
            <strong>domain match</strong> (with org reputation as a proxy when individual credentials are
            absent), recency by <strong>topic-specific decay rate</strong>, and source by a publication
            hierarchy.
          </P>
          <P>
            The call uses <Code>callAI(prompt, 'balanced')</Code>. The <strong>balanced tier</strong> is
            your selected model from Settings, but never the cheapest "lite" model — e.g. Gemini 2.5 Flash
            Lite is bumped up to Gemini 2.5 Flash (analogously for OpenAI / Anthropic). The prompt instructs
            the model to judge author and source <strong>only</strong> from what the cite text states and to{' '}
            <strong>never fabricate</strong> credentials, dates, or outlets.
          </P>
          <P>
            Results are cached per document in <Code>localStorage</Code> under{' '}
            <Code>warroom-cred-&lt;path&gt;</Code>, keyed by a content hash (<Code>hashCards</Code>, which
            hashes the tag text only since cite text can vary slightly between renders) so the cache is
            invalidated when the doc's cards change — reopening the panel is instant and free.{' '}
            <Code>loadCred</Code> / <Code>saveCred</Code> read and write the cache, and a{' '}
            <strong>Re-score</strong> button forces a fresh pass. The panel lists each card with a colored
            score chip and a chevron affordance; clicking a card expands its four sub-score bars, reason,
            and press line. Over / under-highlighted cards also show a dismissible highlight warning here
            with the exact percentage. A <strong>Go to card in document</strong> button scrolls the doc to
            that card and flashes it.
          </P>
        </section>

        {/* ── Impact Calc ────────────────────────────────────────────── */}
        <section id="doc-impact-calc">
          <H2>Impact Calc</H2>
          <P>
            Impact Calc is a full-screen hub for everything impact-weighing. Open it from the{' '}
            <strong>Impact Calc</strong> card on the home screen. It has two areas: <strong>Practice</strong>{' '}
            (the Outweigh game) and <strong>Tools</strong> (the doc-comparison analyzer, plus Impact Library
            and Head-to-head Matchups, which are coming soon).
          </P>

          <H3>The Outweigh game</H3>
          <P>
            A practice drill where you spar with Warroom AI over impact calculus. Pick a difficulty —{' '}
            <strong>Novice</strong> (concrete, intuitive impacts, no theory), <strong>JV</strong> (classic
            policy impacts — engage scope, probability chains, reversibility), or <strong>Varsity</strong>{' '}
            (extinction matchups and framework wars). The round runs in three beats:
          </P>
          <UL>
            <LI><strong>Your impact</strong> — Warroom AI presents its impact (a claim, a warrant, and
              ratings on the four dimensions). You write your own impact and a short calc explaining why
              yours outweighs.</LI>
            <LI><strong>AI rebuttal</strong> — Warroom AI fires back a tight 1–2 minute rebuttal speech,
              defending its impact and attacking yours on a specific dimension. You get a final shot — the
              last word — with a 60-second pressure timer (it never auto-submits).</LI>
            <LI><strong>Decision</strong> — a judge calls the round: who won, a 1–10 score on your calc
              work, a written verdict, dimension-by-dimension feedback, and concrete tips for next time.</LI>
          </UL>

          <H3>Compare two docs (Tools)</H3>
          <P>
            The original analyzer compares two of your own cases, speech docs, or a flow and produces an
            AI impact-calculus breakdown — every clash, a winner on each standard (magnitude, probability,
            timeframe, reversibility), and an overall verdict suitable for a final rebuttal. Saved
            comparisons are listed underneath for one-click reopening.
          </P>
          <P>
            The game is powered by <Code>ai:outweighScenario</Code>, <Code>ai:outweighRebuttal</Code>, and{' '}
            <Code>ai:outweighJudge</Code>; the comparison tool by <Code>ai:compareImpactsText</Code>. All
            run on the best model tier (your selected model, never Flash Lite).
          </P>
        </section>

        {/* ── FindCards ─────────────────────────────────────────────── */}
        <section id="doc-find-cards">
          <H2>FindCards (Logos)</H2>
          <P>
            <Code>FindCards</Code> is a persistent Electron <Code>&lt;webview&gt;</Code> pointing
            at Logos evidence search. The view is always mounted off-screen; navigating to{' '}
            <Code>logos</Code> makes it visible. The Warroom Agent can also trigger Logos searches
            programmatically via the agent search registry without disturbing the user-visible view
            (using a second hidden webview in <Code>AgentSearchViews</Code>).
          </P>
        </section>

        {/* ── Open Ev ────────────────────────────────────────────────── */}
        <section id="doc-open-ev">
          <H2>Open Evidence</H2>
          <P>
            Similar to FindCards — a persistent webview pointing at Open Evidence (openev.net). The
            Agent can search Open Evidence via a dedicated hidden webview without affecting what the
            user sees. Files from Open Evidence can be downloaded and saved locally via the{' '}
            <Code>opencaselist.fetchFileToTemp</Code> IPC bridge.
          </P>
        </section>

        {/* ── Warroom Agent ──────────────────────────────────────────── */}
        <section id="doc-agent">
          <H2>Warroom Agent (AI)</H2>
          <P>
            The Warroom Agent is an AI assistant (Warroom AI) that lives in a resizable right-side
            panel (<Code>GeminiPanel</Code>). It supports multi-turn conversation and tool calls.
          </P>
          <H3>Model selection</H3>
          <UL>
            <LI><strong>Gemini 2.5 Flash Lite</strong> — cheapest, fastest; auto-enables token saving</LI>
            <LI><strong>Gemini 2.5 Flash</strong> — default; best balance of cost and quality</LI>
            <LI><strong>Gemini 3.5 Flash</strong> — highest quality; best for complex analysis</LI>
          </UL>
          <P>
            Agentic tasks (tool calls, sub-agent searches) always use the Flash model regardless
            of the model selection above.
          </P>
          <H3>@mentions / attachments</H3>
          <P>
            Type <Code>@</Code> in the chat input to attach context from your local data:
          </P>
          <UL>
            <LI><Code>@case</Code> — attach a full case</LI>
            <LI><Code>@block</Code> — attach a block's cards</LI>
            <LI><Code>@flow</Code> — attach a flow spreadsheet</LI>
            <LI><Code>@opponent</Code> — attach opponent profile / disclosures</LI>
            <LI><Code>@member</Code> — mention a team member</LI>
            <LI><Code>@image</Code> — paste an image from clipboard</LI>
            <LI><Code>@speechdoc</Code> — attach a speech doc</LI>
          </UL>
          <H3>Token saving</H3>
          <P>
            When attaching a speech doc, "token saving" mode sends only underlined text, citations,
            and headings (not small body text) to reduce token usage. Auto-enabled for Flash Lite.
            Can be toggled globally in Settings or per-conversation.
          </P>
          <H3>Agent tool calls</H3>
          <P>
            The agent can call these tools during a conversation:
          </P>
          <UL>
            <LI><Code>search_logos</Code> — searches the Logos debate evidence database via a hidden webview in <Code>AgentSearchViews</Code></LI>
            <LI><Code>search_openevidence</Code> — searches the Open Evidence Project via a second hidden webview in <Code>AgentSearchViews</Code></LI>
            <LI><Code>save_card_to_library</Code> — saves a card with full verbatim body text to the <Code>__agent_inbox__</Code> block inside the <Code>__agent__</Code> case ("Agent Saves"). Cards saved this way appear in the normal card library.</LI>
            <LI><Code>fetch_article</Code> — fetches/extracts text from a URL for cutting cards from web sources</LI>
            <LI><Code>get_skill</Code> / <Code>write_skill</Code> — load or save a skill <Code>.md</Code> file</LI>
            <LI><Code>search_tabroom_tournament</Code> · <Code>get_tournament_details</Code> · <Code>save_tournament_to_app</Code> · <Code>search_judge</Code> — Tabroom lookups</LI>
            <LI><Code>navigate_app</Code> — opens any view for the user (top-level, or a case/block/opponent/tournament/flow resolved by name)</LI>
            <LI><Code>list_flows</Code> / <Code>read_flow</Code> / <Code>edit_flow_cell</Code> — list flows, read a flow's columns + cells, and write individual cells. Edits write to <Code>flow_data_&lt;id&gt;</Code> and fire a <Code>warroom-flow-updated</Code> event so an open flow reloads live.</LI>
          </UL>
          <P>
            The agent runs a minimum of 3 searches per evidence request using varied query terms. Saved cards always use the complete verbatim card body — never a summary. The save handler validates the body is non-empty before writing to the DB.
          </P>
          <H3>Chat sessions</H3>
          <P>
            Each conversation has an auto-generated title (generated by Warroom AI after the first
            exchange). Sessions are stored locally. The active session ID is tracked in Zustand
            as <Code>geminiActiveId</Code>.
          </P>
        </section>

        {/* ── Team Chat ──────────────────────────────────────────────── */}
        <section id="doc-chat">
          <H2>Team chat</H2>
          <P>
            Team chat uses Supabase for real-time messaging. It appears in a resizable panel
            on the right side (separate from the Warroom AI panel). Features:
          </P>
          <UL>
            <LI>Team creation with invite codes; members can join/leave; owner can kick members</LI>
            <LI>Channel messages and direct messages (DMs) between team members</LI>
            <LI>Message editing and deletion</LI>
            <LI>Attachments: cases, blocks, flows, opponents, images, speech docs — shared with edit or view permissions</LI>
            <LI>Round references in messages (link to a specific round)</LI>
            <LI>Unread count badge on the chat icon in the sidebar</LI>
            <LI>User lookup by email via <Code>lookupUserByEmail</Code></LI>
          </UL>
          <H3>Auth</H3>
          <P>
            Chat uses Supabase auth (email + password). Credentials are stored encrypted on device
            via <Code>safeStorage</Code>. Sign-in state is cached in <Code>localStorage</Code>.
          </P>
          <H3>Chat width</H3>
          <P>
            The chat panel is resizable (260–600 px, default 320 px). Width is persisted in
            <Code>localStorage</Code> as <Code>warroom-chat-width</Code>.
          </P>
        </section>

        {/* ── Google Drive ──────────────────────────────────────────── */}
        <section id="doc-gdrive">
          <H2>Google Drive integration</H2>
          <P>
            Google Drive lets you browse your Drive files in-app and open Word docs or
            spreadsheets directly. Setup requires creating a Desktop OAuth app credential in Google
            Cloud Console.
          </P>
          <H3>Setup flow</H3>
          <UL>
            <LI>Enter OAuth Client ID and Client Secret in Settings → Google Drive</LI>
            <LI>Click "Connect Drive" — the app opens a browser OAuth flow</LI>
            <LI>After authorization, tokens are stored encrypted via <Code>safeStorage</Code></LI>
          </UL>
          <H3>Capabilities</H3>
          <UL>
            <LI>List and paginate Drive files</LI>
            <LI>Search files by name</LI>
            <LI>Fetch a file's content (base64) for in-app rendering</LI>
            <LI>Upload a local spreadsheet as a Google Sheet</LI>
            <LI>Open <Code>.docx</Code> files in the Speech Doc Viewer</LI>
            <LI>Open <Code>.xlsx</Code> files in the Flow viewer</LI>
          </UL>
        </section>

        {/* ── Settings ──────────────────────────────────────────────── */}
        <section id="doc-settings">
          <H2>Settings</H2>
          <Card>
            <div className="space-y-2.5 text-sm">
              <div>
                <span className="font-semibold text-ink">Debate event</span>
                <span className="ml-2 text-ink/60">HS Policy · HS LD · HS PF · College Policy (NDT/CEDA) · College LD (NFA-LD)</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Gemini API key</span>
                <span className="ml-2 text-ink/60">Stored encrypted. Powers card extraction, block suggestions, and Warroom AI.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Gemini model</span>
                <span className="ml-2 text-ink/60">Flash Lite / Flash (default) / 3.5 Flash</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Token saving default</span>
                <span className="ml-2 text-ink/60">Auto-strips small body text from speech doc attachments to the Agent.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">OpenCaselist login</span>
                <span className="ml-2 text-ink/60">Same as Tabroom.com credentials. Required for opponent scouting and Open Ev.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Google Drive</span>
                <span className="ml-2 text-ink/60">OAuth Client ID + Secret. Requires Desktop app type in Google Cloud.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Chat</span>
                <span className="ml-2 text-ink/60">Shows current user; sign-out button.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Sharing default</span>
                <span className="ml-2 text-ink/60">Can edit (default) or Can view — applied when sharing via chat.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Flow colors</span>
                <span className="ml-2 text-ink/60">Default Aff/Pro and Neg/Con column colors applied to all flows.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Setup wizard</span>
                <span className="ml-2 text-ink/60">Re-runs the onboarding flow.</span>
              </div>
            </div>
          </Card>
        </section>

        {/* ── Storage & security ─────────────────────────────────────── */}
        <section id="doc-storage">
          <H2>Storage & security</H2>
          <H3>Local data</H3>
          <UL>
            <LI><Code>userData/warroom/db.json</Code> — main database (cases, blocks, cards, opponents, tournaments, rounds)</LI>
            <LI><Code>userData/warroom/flows_index.json</Code> — list of open flows with metadata</LI>
            <LI><Code>userData/warroom/app_settings.json</Code> — debate event, AI model, token saving</LI>
            <LI><Code>userData/warroom/secure_*.json</Code> — encrypted secrets (API key, OC credentials, GDrive tokens, chat credentials)</LI>
          </UL>
          <H3>Secure storage</H3>
          <P>
            Sensitive values (API keys, passwords, OAuth tokens) are encrypted with Electron's{' '}
            <Code>safeStorage</Code> (OS keychain-backed AES encryption). In dev mode, base64 fallback
            is used since the safeStorage key changes on each rebuild.
          </P>
          <H3>Encrypted chat</H3>
          <P>
            All team-chat and DM content is end-to-end encrypted before it leaves your computer.
            Message text and every shared attachment (cases, blocks, flows, opponents, tournaments,
            speech docs) are encrypted client-side with <Code>AES-256-GCM</Code>; the cloud database
            only ever stores ciphertext. Each team has one symmetric key, derived from the team's
            invite code via <Code>PBKDF2</Code> (200k iterations, salted with the team id). Because
            every member already knows the invite code, everyone derives the identical key with no
            key exchange — and the key itself is never transmitted or stored on any server. Sender
            name, timestamps, and attachment labels stay readable for display; only the actual
            content is encrypted. Warroom AI does not read team-chat history, so no plaintext is
            ever sent to the AI provider.
          </P>
          <H3>Path safety</H3>
          <P>
            IPC handlers that read arbitrary file paths maintain a <Code>trustedPaths</Code> set —
            only paths originating from a file dialog or internally-generated temp files are accepted.
            This prevents a compromised renderer from reading arbitrary disk paths.
          </P>
          <H3>File writes</H3>
          <P>
            JSON writes use a write-then-rename pattern (<Code>db.json.tmp</Code> → <Code>db.json</Code>)
            to prevent data loss on crash.
          </P>
        </section>

        {/* ── Architecture ───────────────────────────────────────────── */}
        <section id="doc-architecture">
          <H2>Architecture</H2>
          <H3>IPC bridge (<Code>window.warroom</Code>)</H3>
          <P>
            The preload script exposes a typed <Code>window.warroom</Code> namespace with these
            sub-namespaces:
          </P>
          <UL>
            <LI><Code>storage</Code> — read/write JSON files in userData</LI>
            <LI><Code>secure</Code> — get/set encrypted values</LI>
            <LI><Code>dialog</Code> — open file dialog, save buffer to disk</LI>
            <LI><Code>ai</Code> — extractCards, suggestBlocks, teamSummary, parseRoundEmail</LI>
            <LI><Code>clipboard</Code> — readImage (for pasting screenshots into Agent)</LI>
            <LI><Code>opencaselist</Code> — login, search, rounds, cites, file fetch/save</LI>
            <LI><Code>shell</Code> — openPath, openBuffer (open files in external app)</LI>
            <LI><Code>fs</Code> — readFileBytes, writeTempFile (for trusted file operations)</LI>
            <LI><Code>dl</Code> — searchTeam, getTeamStats (Debate Land)</LI>
            <LI><Code>tabroom</Code> — getTournament, getEntries, getPairings, fetchTournament, monitor.*</LI>
            <LI><Code>chat</Code> — all Supabase chat + Warroom AI operations</LI>
            <LI><Code>gdrive</Code> — status, connect, disconnect, listFiles, searchFiles, fetchFile, uploadAsSheets</LI>
            <LI><Code>platform</Code> — <Code>'darwin'</Code> or <Code>'win32'</Code></LI>
            <LI><Code>onFileOpen</Code> — subscribe to file-open events from the OS</LI>
          </UL>
          <H3>Zustand store (<Code>src/store/appStore.ts</Code>)</H3>
          <P>
            Single global store (<Code>useApp</Code>) holds: DB state, current view, mode, theme,
            event type, flows index, chat state (user, team, members, unread count), Warroom AI panel
            state, onboarding state, and the agent search function registry.
          </P>
          <H3>Persistent webviews</H3>
          <P>
            Three Electron <Code>&lt;webview&gt;</Code> elements are always mounted to avoid reloads:
            <Code>FindCards</Code> (Logos), <Code>OpenEvView</Code> (openev.net), and two agent
            search webviews in <Code>AgentSearchViews</Code>. They use CSS <Code>display: none</Code>{' '}
            (not React unmounting) to hide/show.
          </P>
          <H3>Tabroom monitor flow</H3>
          <P>
            Main process polls Tabroom every ~30s. On a new pairing, it fires parallel requests for
            judge paradigm (Tabroom scrape), OC disclosures (OC API), and DL stats. Results are
            bundled into a <Code>TabroomRoundBrief</Code> and sent to the renderer via IPC.{' '}
            <Code>App.tsx</Code> handles the event: deduplicates, upserts the opponent, creates the
            round, and navigates.
          </P>
        </section>

        <section id="doc-topics">
          <H2>NSDA Topics</H2>
          <P>
            Warroom monitors <strong>speechanddebate.org/topics/</strong> for the latest Policy, Public Forum, and Lincoln-Douglas resolutions.
          </P>
          <H3>Topic monitor</H3>
          <UL>
            <LI>On every app launch, Warroom checks whether a new topic has dropped and updates stored data.</LI>
            <LI>PF and LD topics drop on known dates (Aug 1, Oct 1, Dec 1, etc.) at 9:00am CT. The app polls aggressively only on release days — up to every 2 minutes in the 30-minute window after release time.</LI>
            <LI>When a new topic is detected, a <strong>desktop notification</strong> fires immediately. Clicking it opens the Topics screen.</LI>
            <LI>A vivid <strong>in-app banner</strong> appears at the top of the window (amber for PF, red for LD) with a pulsing indicator and the full resolution text. It persists until dismissed.</LI>
          </UL>
          <H3>Topic brief</H3>
          <UL>
            <LI>When a new topic drops, a Warroom AI brief is automatically generated. It covers: resolution breakdown, Aff/Neg arguments, frameworks, core clash, research priorities, and pitfalls.</LI>
            <LI>The brief can be regenerated at any time from the Topics screen.</LI>
            <LI>Requires an API key in Settings → API Keys.</LI>
          </UL>
          <H3>Policy topic context</H3>
          <P>
            The current Policy topic is injected into every Warroom Agent conversation as system context, so the agent always knows what resolution is being debated without you needing to state it.
          </P>
        </section>

        {/* ── AI Help Guide ───────────────────────────────────────────── */}
        <section id="doc-ai-guide">
          <H2>AI help guide</H2>
          <P>
            The Warroom AI (star icon in the title bar) can answer any "how do I…" or "where is…"
            question about the app, search for evidence on Logos and Open Evidence, cut cards from
            articles or URLs, look up judges and tournaments on Tabroom, and more. Just ask in plain
            English.
          </P>
          <P>
            The full user manual — including every feature, keyboard shortcut, and step-by-step
            workflow — is maintained as a plain-text file you can read directly:
          </P>
          <Card>
            <div className="flex items-start gap-3">
              <span className="text-lg">📖</span>
              <div>
                <div className="text-sm font-semibold text-ink mb-0.5">Full User Manual</div>
                <Code>electron/skills/user_manual.md</Code>
                <div className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
                  This file is also the knowledge source the AI loads when you ask it how to use the app.
                  It is kept in sync with every new feature added to Warroom.
                </div>
              </div>
            </div>
          </Card>
          <H3>Custom skills</H3>
          <P>
            The AI's knowledge is built from skill files — plain Markdown files in{' '}
            <Code>electron/skills/</Code>. You can add your own skills (team conventions, case notes,
            judge paradigms, etc.) by dropping a <Code>.md</Code> file into{' '}
            <Code>userData/warroom/skills/</Code>. Read the tutorial:
          </P>
          <Card>
            <div className="flex items-start gap-3">
              <span className="text-lg">✏️</span>
              <div>
                <div className="text-sm font-semibold text-ink mb-0.5">How to Write Skills</div>
                <Code>electron/skills/HOW_TO_WRITE_SKILLS.txt</Code>
                <div className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
                  Explains the skill file format, naming conventions, what makes a good skill, and includes
                  a full example. Skills are lazy-loaded — only fetched when the AI needs them.
                </div>
              </div>
            </div>
          </Card>
        </section>

        <div className="h-16" />
      </div>
    </div>
  );
}
