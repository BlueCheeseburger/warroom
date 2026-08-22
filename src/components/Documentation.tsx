import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../store/appStore';
import { useInPageFind, FindBar } from './useInPageFind';

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

// Opens the editable copy of an AI prompt template (electron/prompts/<name>.txt, or
// the user-override copy at <userData>/warroom/prompts/<name>.txt) in the OS's
// default text editor. See the "AI Prompts" section for how this works.
function PromptLink({ name, children }: { name: string; children?: React.ReactNode }) {
  return (
    <a
      onClick={() => window.warroom.prompts.openInEditor(name)}
      style={{ cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}
      className="text-xs"
    >
      {children ?? 'View/edit this prompt →'}
    </a>
  );
}

// ─── TOC ──────────────────────────────────────────────────────────────────────

const TOC_SECTIONS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'stack',       label: 'Tech stack' },
  { id: 'data-model',  label: 'Data model' },
  { id: 'navigation',  label: 'Navigation' },
  { id: 'undo-toasts', label: 'Undo toasts' },
  { id: 'global-search', label: 'Global search (⌘K)' },
  { id: 'shortcuts',   label: 'Keyboard shortcuts (⌘/)' },
  { id: 'cases',       label: 'Cases & blocks' },
  { id: 'cases-grid',  label: 'Cases grid & folders' },
  { id: 'library',     label: 'Card library' },
  { id: 'opponents',   label: 'Opponents' },
  { id: 'tournaments', label: 'Tournaments & rounds' },
  { id: 'monitor',     label: 'Tabroom live monitor' },
  { id: 'background',  label: 'Background notifications' },
  { id: 'speech-timer', label: 'Speech Timer' },
  { id: 'flows',       label: 'Flows' },
  { id: 'auto-flow',   label: 'Auto Flow' },
  { id: 'speech-doc',  label: 'Speech doc viewer' },
  { id: 'impact-calc', label: 'Impact Calc' },
  { id: 'find-cards',  label: 'FindCards (Logos)' },
  { id: 'open-ev',     label: 'Open Evidence' },
  { id: 'lmstudio',    label: 'LM Studio (local)' },
  { id: 'agent',       label: 'Warroom Agent (AI)' },
  { id: 'chat',        label: 'Team chat' },
  { id: 'gdrive',      label: 'Google Drive' },
  { id: 'settings',    label: 'Settings' },
  { id: 'storage',     label: 'Storage & security' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'topics',      label: 'NSDA Topics' },
  { id: 'ai-guide',    label: 'AI help guide' },
  { id: 'ai-prompts',  label: 'AI Prompts' },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function Documentation() {
  const { setView } = useApp();
  const [activeSection, setActiveSection] = useState('overview');
  const scrollRef = useRef<HTMLDivElement>(null);
  const find = useInPageFind(scrollRef);

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
    <div className="relative flex h-full min-h-0" style={{ background: 'var(--bg-main)' }}>
      {find.open && (
        <FindBar query={find.query} setQuery={find.setQuery} idx={find.idx} count={find.count} step={find.step} close={find.close} />
      )}
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
        <p className="text-xs mb-1" style={{ color: 'var(--nav-inactive-color)' }}>
          Last updated: 8/20/26
        </p>
        <p className="text-xs mb-8" style={{ color: 'var(--placeholder)' }}>
          Press <Code>⌘F</Code> / <Code>Ctrl F</Code> to search this page.
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
          <H2>Navigation</H2>
          <P>
            Navigation is view-stack-free: one active <Code>View</Code> at a time, stored in Zustand.
            The sidebar provides top-level navigation to everything — Cases, Tournaments, Scouting,
            Cards, Google Drive, Flow, Speech doc, Chat, and Topics are all reachable at once; there's
            no separate mode to switch between. Views are rendered by a <Code>Router</Code> function
            in <Code>App.tsx</Code>. Three "persistent" webviews (FindCards, OpenEv, AgentSearchViews)
            are always mounted but hidden so they don't reload on navigation.
          </P>
          <P>
            When the sidebar is collapsed to icons only, right-click <strong>Cases</strong> for a new
            case (opens a blank speech doc) or right-click <strong>Flow</strong> for a new flow — the
            same actions the expanded sidebar's <Code>+</Code> buttons trigger, so collapsing the
            sidebar doesn't lose the shortcut.
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
        </section>

        {/* ── Undo toasts ───────────────────────────────────────────── */}
        <section id="doc-undo-toasts">
          <H2>Undo toasts</H2>
          <P>
            A shared <Code>pushUndoToast(message, onUndo)</Code> action on the Zustand store
            (<Code>appStore.ts</Code>) drives a bottom-left toast (<Code>UndoToast.tsx</Code>,
            mounted once in <Code>App.tsx</Code>): "Deleted 'X'" plus an Undo button, auto-dismissing
            after 3.5 seconds. Wired up on the major destructive deletes — cases, blocks, cards,
            tournaments, rounds, opponents, flows, flow sheets, saved AI chats, saved impact calc
            entries, impact library entries, and folders. Deliberately not wired up on chat/DM
            message deletion (syncs live to other users) or flow column/arrow deletes
            (too fine-grained during active flowing).
          </P>
          <P>
            Each delete site snapshots the relevant state right before mutating it, then passes a
            closure that restores that snapshot as <Code>onUndo</Code>. For anything backed by the
            main <Code>db</Code> object, the snapshot must be <Code>structuredClone(db)</Code>, not
            a bare reference — the app's delete-reducer convention (<Code>{'{ ...db }'}</Code> then
            deleting a key off a nested dict) only shallow-copies the top-level object, so a bare
            snapshot would get silently corrupted by the very delete it's meant to undo. The Impact
            Library (Supabase-backed) has no restore-by-id API, so its undo re-submits the same
            content as a new row instead — best effort, not a true restore.
          </P>
        </section>

        {/* ── Global search ──────────────────────────────────────────── */}
        <section id="doc-global-search">
          <H2>Global search <Badge color="blue">⌘K</Badge></H2>
          <P>
            Press <Code>⌘K</Code> (<Code>Ctrl K</Code> on Windows) anywhere — or click the search bar
            below Home in the sidebar — to open a command-palette search across everything in the app.
            Results are grouped by type and ranked with fuzzy matching (Fuse.js).
          </P>
          <H3>What it searches</H3>
          <UL>
            <LI><strong>Cases</strong> — name, OpenCaseList source, and the document's distilled content keywords.</LI>
            <LI><strong>Speech docs</strong> — file name plus content keywords extracted from the .docx.</LI>
            <LI><strong>Flows</strong> — name and every filled-in cell across all sheets.</LI>
            <LI><strong>Opponents</strong> — team, school, notes, and disclosure titles (aff/neg position names + cite titles). File names only — never file contents.</LI>
            <LI><strong>Judges</strong> — name, institution, and paradigm text.</LI>
            <LI><strong>Tournaments</strong> — name, location, and event.</LI>
            <LI><strong>Topics</strong> — the current resolution for each event.</LI>
            <LI><strong>AI chats</strong> — full conversation history.</LI>
          </UL>
          <H3>How keywords are built</H3>
          <P>
            On launch, Warroom distills the top content keywords from each case and speech doc (up to
            2,000 per document, stopwords and 1–10 numbers removed) and caches them. Pure numbers above
            10 stay searchable (e.g. a <Code>$1,500,000</Code> plan figure). On top of that 2,000 cap,
            every card's <strong>tagline and cite (author, date, publication)</strong> is guaranteed
            searchable regardless of how often those words appear elsewhere in the document — a tag
            mentioned once shouldn't lose to a body word repeated 50 times. Opening a matched case or
            speech doc auto-opens the in-document find on the searched term; matched opponent disclosures
            auto-scroll and highlight the term in the title.
          </P>
          <H3>External & AI search</H3>
          <P>
            The palette footer offers one-click external searches — <strong>Logos</strong>,
            <strong> Google Scholar</strong>, and <strong>Open Evidence</strong> — for the current query.
            Warroom AI can also run the same data search itself via its <Code>search_warroom</Code> tool
            (e.g. "find arctic in my files"); speech docs, flows, and chat history are renderer-only, so
            for those use this palette directly.
          </P>
          <H3>Searching this documentation</H3>
          <P>
            Press <Code>⌘F</Code> / <Code>Ctrl F</Code> on the Documentation and User Manual pages to find
            text on the page — Enter / Shift+Enter jump between matches, Esc closes.
          </P>
        </section>

        {/* ── Keyboard shortcuts ─────────────────────────────────────── */}
        <section id="doc-shortcuts">
          <H2>Keyboard shortcuts <Badge color="blue">⌘/</Badge></H2>
          <P>
            Press <Code>⌘/</Code> (<Code>Ctrl+/</Code> on Windows) anywhere to open{' '}
            <Code>ShortcutsOverlay.tsx</Code> — the full, organized list of every shortcut in the app.
            Also reachable from Settings → Keyboard Shortcuts. Purely client-side: it reads a static{' '}
            <Code>GROUPS</Code> array (no IPC), and picks <Code>⌘</Code> vs <Code>Ctrl</Code> labels off{' '}
            <Code>window.warroom.platform</Code>.
          </P>
          <P>
            State lives in <Code>useApp</Code> as <Code>shortcutsOpen</Code> / <Code>setShortcutsOpen</Code>,
            mirroring the search palette's <Code>searchOpen</Code> pattern exactly — same backdrop + card
            styling, Esc-to-close, mounted unconditionally in <Code>App.tsx</Code> (the component
            self-guards on <Code>shortcutsOpen</Code>).
          </P>
          <P>
            The list groups shortcuts into <strong>Global</strong> (⌘K search, ⌘/ this list, Esc),{' '}
            <strong>Find on a page</strong> (⌘F), <strong>AI panel & team chat</strong> (Enter/Shift+Enter/@),{' '}
            <strong>Speech doc viewer</strong> (⌘⌥M comments on the selection), and <strong>Flow editor</strong>{' '}
            (formatting, undo/redo, arrow-drawing, cell navigation).
            When a new global or component-level keyboard shortcut is added anywhere in the app, add it
            here too — grep for <Code>metaKey || e.ctrlKey</Code> across <Code>src/</Code> to find every
            shortcut currently wired up.
          </P>
          <H3>Disabling & rebinding shortcuts</H3>
          <P>
            <Code>shortcutPrefs.ts</Code> is the single source of truth for every rebindable shortcut's
            default combo (<Code>DEFAULT_BINDINGS: Record&lt;string, KeyBinding&gt;</Code>, keyed by the
            entry's stable <Code>id</Code>). A shortcut with an entry there can be both disabled and
            rebound per-user; entries without one (Enter, Tab, arrow keys, and multi-key groups like the
            ⌘1–9 sheet switcher or the ⌘↑/⌘↓ row-move pair) are fixed. Two independent{' '}
            <Code>localStorage</Code> keys back this: a disabled-id set and a{' '}
            <Code>Record&lt;string, KeyBinding&gt;</Code> of overrides.
          </P>
          <P>
            Every consuming keydown handler calls one function —{' '}
            <Code>matchesShortcut(e, id)</Code> — instead of hand-rolling its own key comparison. It
            checks disabled state, then compares the event against the effective binding (override if
            set, else default). This is what makes a rebind or disable take effect everywhere that id is
            wired up at once (e.g. <Code>find-page</Code> covers ⌘F in Documentation, User Manual, the
            speech doc viewer, flows, and the Logos/Open Ev/Google Scholar webviews — one toggle or
            rebind, every call site).
          </P>
          <P>
            Two separate controls that never share a gesture: <strong>click a shortcut's key badge
            itself</strong> to disable/re-enable it — hovering previews a faint strikethrough across the
            whole badge, and a disabled badge settles into a persistent red tint + red strikethrough (not
            just dimmed text). A separate <strong>pencil icon to the shortcut's left</strong> opens
            rebinding — the keys turn into a "Press new keys…" prompt, and the next keydown with{' '}
            <Code>⌘</Code>/<Code>Ctrl</Code> or <Code>⌥</Code> held becomes the new binding{' '}
            (<Code>isBindingValid</Code> rejects anything without a real modifier — Shift alone doesn't
            count, since Shift+letter is just typing a capital letter in a text field, and this runs
            inside flow cells). <Code>findConflict</Code> rejects a combo already claimed by another
            enabled shortcut, surfacing which one. A customized entry shows a small, hover-revealed
            "reset" link back to default. <Code>⌘/</Code> itself is disableable/rebindable, but Settings
            → Keyboard Shortcuts always opens this overlay directly, so it's never a dead end.
          </P>
          <P>
            Custom rebindings and disables travel with a full Settings export/import (Settings →
            Import/Export Settings) — both of <Code>shortcutPrefs.ts</Code>'s localStorage keys
            (<Code>warroom-disabled-shortcuts</Code>, <Code>warroom-shortcut-bindings</Code>) are in{' '}
            <Code>SETTINGS_LOCALSTORAGE_KEYS</Code>, same as every other listed preference.
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
            block. <PromptLink name="card_extraction" />
          </P>
          <H3>Block suggestions</H3>
          <P>
            On the Mission Brief (round view), Warroom can suggest which blocks to read against an
            opponent's positions using <Code>suggestBlocks</Code> — Warroom AI compares the opponent's
            disclosed arguments against your block list and returns a ranked selection.{' '}
            <PromptLink name="suggest_blocks" />
          </P>
        </section>

        {/* ── Cases grid & folders ───────────────────────────────────── */}
        <section id="doc-cases-grid">
          <H2>Cases grid &amp; folders</H2>
          <P>
            Clicking the <strong>Cases</strong> title in the sidebar opens the{' '}
            <Code>{"{ kind: 'cases-grid'; folderId?: string }"}</Code> view — a full-screen grid of
            every case <em>and</em> every imported speech doc, each drawn as a Google-Docs-style
            first-page preview. <Code>buildCaseItems(db)</Code> (<Code>src/utils/caseItems.ts</Code>)
            flattens the three sources that live in different places into one <Code>CaseItem</Code>{' '}
            list: <Code>case</Code> (built from blocks, in <Code>db.cases</Code>),{' '}
            <Code>oc-case</Code> (an OpenCaseList import — also in <Code>db.cases</Code>, but backed
            by real docx bytes via <Code>ocSource</Code>), and <Code>speech-doc</Code> (a{' '}
            <Code>.docx</Code> you opened, which lives only in the{' '}
            <Code>warroom-speech-doc-recents</Code> localStorage list).
          </P>

          <H3>The folder model</H3>
          <P>
            Folders live in <Code>src/utils/caseFolders.ts</Code> and persist through{' '}
            <Code>window.warroom.storage</Code> under the <Code>case_folders</Code> key — not
            localStorage, because this is durable library structure rather than view state.{' '}
            <Code>CaseFoldersData</Code> is two fields: a flat <Code>folders</Code> array (each with
            a <Code>parentId</Code>, so nesting is arbitrary depth) and an <Code>assignments</Code>{' '}
            map of <Code>itemKey → folderId</Code>. Item keys are namespaced so one map can address
            either bucket: <Code>case:&lt;id&gt;</Code> for cases and{' '}
            <Code>doc:&lt;path&gt;</Code> for speech docs (<Code>itemKeyForCase</Code> /{' '}
            <Code>itemKeyForDoc</Code>). An item with no entry sits at the top level.
          </P>
          <P>
            <strong>A folder is only a label.</strong> Filing something into one writes an
            assignment and nothing else — it never moves, copies, renames, or deletes the underlying
            file on disk or the record in <Code>db.cases</Code>. The whole folder structure can be
            thrown away without losing a single document. Consequently{' '}
            <strong>deleting a folder keeps its documents</strong>: <Code>deleteFolder</Code>{' '}
            re-parents its subfolders and reassigns its items to the deleted folder's parent (or back
            to the top level), so the only thing lost is the grouping.{' '}
            <Code>resolveItemFolder</Code> is defensive in the same spirit — an assignment pointing
            at a folder that no longer exists resolves to the top level rather than stranding the
            document somewhere unreachable.
          </P>
          <P>
            Every mutation (<Code>createFolder</Code>, <Code>renameFolder</Code>,{' '}
            <Code>deleteFolder</Code>, <Code>moveFolder</Code>, <Code>moveItem</Code>) is{' '}
            <strong>pure</strong> and returns a new <Code>CaseFoldersData</Code>; callers apply it
            through the <Code>useCaseFolders()</Code> hook's{' '}
            <Code>update((d) =&gt; moveItem(d, key, folderId))</Code>. Writes broadcast a window
            event, so the grid and the sidebar tree — both consumers of the same hook — re-render
            together in the same tick. <Code>moveFolder</Code> refuses a move into the folder's own
            subtree (<Code>isSelfOrDescendant</Code>) since that would orphan it.
          </P>

          <H3>Sidebar tree</H3>
          <P>
            The sidebar's Cases section mirrors the same state as a nested tree. Top-level folders
            come from <Code>childFolders(folders, null)</Code>; expanding one reveals its subfolders
            recursively plus the items assigned to it, and the loose list underneath holds only items
            whose <Code>resolveItemFolder</Code> is <Code>null</Code>. Expanded folders persist in
            localStorage under <Code>sidebar-cases-folders-open</Code>. A folder row navigates to{' '}
            <Code>{"{ kind: 'cases-grid', folderId }"}</Code>; the section title itself opens the
            grid at the top level. Items and folders are HTML5-draggable onto folder rows to file
            them, and dropping anywhere that isn't a folder row falls through to a top-level drop
            zone, which is how something gets un-filed.
          </P>

          <H3>Page previews</H3>
          <P>
            Items backed by real docx bytes (speech docs and <Code>oc-case</Code> imports) get a{' '}
            <strong>real first page</strong>: the docx is rendered with{' '}
            <Code>docx-preview</Code> using <Code>breakPages: true</Code>, and only page one is kept
            and scaled down into the tile. Because that render is expensive, the result is cached in
            localStorage under <Code>warroom-case-preview-&lt;key&gt;</Code>, keyed by the same
            namespaced item key as the folder assignments — so a revisit is instant and offline.
          </P>
          <P>
            Block-built <Code>case</Code> items have <strong>no docx behind them</strong>, so there
            is no page to render. Their tile is <strong>synthesized</strong> instead — a page-shaped
            mock laid out from the case's own tags and cites — so the grid reads as one consistent
            wall of documents rather than a mix of pages and placeholders.
          </P>
          <P>
            <strong>Cross-view drag-and-drop.</strong> The sidebar tree and the grid are separate
            React trees, so a drag started in one can't see the other's local state — only the
            native <Code>DataTransfer</Code> is shared ground. <Code>ITEM_DRAG_MIME</Code> /{' '}
            <Code>FOLDER_DRAG_MIME</Code> (<Code>caseFolders.ts</Code>) are the MIME strings both
            sides write on drag-start and read on drop. The subtler half of the fix is on{' '}
            <Code>dragover</Code>: each tree's <Code>canDrop</Code> check originally required{' '}
            <em>local</em> drag state, which a cross-tree drag never sets — both sides now fall
            back to inspecting <Code>e.dataTransfer.types</Code> (readable during{' '}
            <Code>dragover</Code>, unlike <Code>.getData()</Code>) when there's no local drag,
            so the hover is still accepted and the drop fires.
          </P>
          <P>
            <strong>Multi-select and bulk actions.</strong> Cmd/Ctrl+click toggles an item into a
            selection <Code>Set&lt;string&gt;</Code> without navigating — intercepted in the click
            capture phase so it never reaches the item's own click handler. A selection bar offers{' '}
            <strong>Move to</strong> (every folder, breadcrumb-labeled) and <strong>Delete</strong>,
            folding over the selected keys. Right-click (or a hover "⋯" button in the grid) gives
            the same three actions — Move to / Rename / Delete — for one item at a time, in both
            the sidebar and the grid. Deleting a case and deleting a speech doc are different
            operations under the hood (db mutation vs. a recents entry); both are unified behind
            small exported helpers in <Code>caseItems.ts</Code> (
            <Code>deleteCaseAndBlocks</Code>, <Code>removeFromRecents</Code>,{' '}
            <Code>renameInRecents</Code>) so every UI surface agrees on what "delete a case"
            actually means.
          </P>
          <P>
            <strong>Import a whole folder.</strong> <Code>dialog:openFolderOfDocx(extensions?)</Code>{' '}
            opens a native directory picker and recursively walks it (capped at 2000 files) for
            files matching the given extensions (default <Code>['docx']</Code>), trusting each one
            the same way a file dialog does. <Code>pickFolder()</Code> in{' '}
            <Code>SpeechDocViewer.tsx</Code> imports every result, then creates one new folder
            named after the picked directory and files every doc into it in a single update — so a
            folder import always lands as one correctly-named group. Onboarding's import step
            passes <Code>['docx', 'xlsx']</Code> to import speech docs and flows together.
          </P>
          <P>
            <strong>Share a whole folder.</strong> A <strong>Share folder</strong> hover action on
            each folder tile (alongside Rename/Delete) opens the same <Code>SharePanel</Code> every
            single case/doc share already uses, but in a new multi-item mode:{' '}
            <Code>itemsInFolderRecursive</Code> (<Code>caseItems.ts</Code>) collects every case and
            speech doc filed under that folder <em>and its subfolders</em>, each becomes its own
            attachment (same payload shapes the single-item share sites already build — file bytes
            for docs, <Code>{'{ case, blocks }'}</Code> for cases), and every recipient gets one
            message carrying all of them together rather than a flood of separate shares. Flow
            folders don't get this action — they keep their own always-live sharing model.
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
            <strong>＋ Cut a card with Warroom AI.</strong> The <Code>＋</Code> next to “Cards” in the sidebar opens a guided
            cutter where Warroom AI does the repetitive highlighting and underlining while you steer the card. First save the
            article: press <em>⌘S / Ctrl+S → save as a Webpage (HTML)</em> to include images, or <em>Print → Save as PDF</em>{' '}
            for text only. Then Warroom AI reads the source — pulling the cite, the real article body, and the images
            (alt-text aware, ads/logos filtered). You <strong>highlight the passages you want</strong> (selections stack;
            hover and ✕ to remove one), optionally add pictures from the dropdown, type what you're using the card for, and
            pick a highlight color (<strong>yellow / cyan / neon green</strong>). Warroom AI then decides what to underline
            (read aloud), highlight (most important), and shrink to small text (context), and proposes one or two taglines.
            A mini editor lets you fix the emphasis — select text and hit Underline / Highlight / Small / Clear — without
            changing the words (the body stays verbatim). Saved cards land in the <Code>Cut Cards</Code> case and render with
            their formatting everywhere a card appears. Neon green highlight counts as “read aloud” across Warroom, alongside
            yellow and cyan.
          </P>
          <P>
            <strong>If Warroom AI is genuinely unsure</strong> how to cut a card — usually because you didn't say what it's
            for and the passage supports more than one distinct argument — it can ask you one quick clarifying question with
            a couple of concrete options, instead of guessing. Pick one (or type your own) and it finishes the cut using your
            answer. It only asks once per card.
          </P>
          <P>
            <PromptLink name="cutter_read_source">View/edit the "read source" prompt →</PromptLink>
            {' · '}
            <PromptLink name="cutter_emphasize">View/edit the "emphasis &amp; taglines" prompt →</PromptLink>
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
              aff/neg summary with citations (stored as <Code>disclosures.aiScout</Code>).{' '}
              <PromptLink name="team_summary" />
            </LI>
            <LI>
              <strong>Debate Land stats</strong> — career OTR, peak rank, avg speaks, win%, bids,
              total record (via <Code>window.warroom.dl</Code> IPC). Once matched, the result is
              stored on <Code>opp.stats</Code> and never re-searched automatically; a "no team
              matched" search result is also cached (24h, localStorage) so revisiting an
              unmatched opponent doesn't re-hit the network every time. A <strong>Wrong team?
              Search again</strong> link next to already-saved stats reopens the search box
              (pre-filled, event tabs intact) without discarding the current stats until a new
              match is actually picked — <strong>Cancel</strong>/<strong>Keep current</strong>{' '}
              backs out without changing anything.
            </LI>
            <LI>Rounds against this opponent (linked by round ID)</LI>
          </UL>
          <H3>Opponent search</H3>
          <P>
            Opponents can be looked up by team name via OpenCaselist full-text search and/or
            Debate Land search. The app de-duplicates across local DB and search results.
          </P>
          <H3>Notes: private + per-team panels, tagging</H3>
          <P>
            An opponent/judge profile's Notes section (<Code>SharedNotesEditor</Code>) is no longer a
            single box with a visibility dropdown — it's a <strong>Private</strong> panel plus one
            panel per team you belong to, each independently toggleable via the pill row at the top
            (multi-team names that collide are disambiguated with a trailing invite-code fragment,
            e.g. "JLHS Policy (a1b2)", since duplicate team names are a real possibility, not a
            rendering bug). A panel auto-opens the first time it has content (text or a tag, checked
            once per team via a lightweight probe on mount) and then stays open for the rest of the
            app session — including if its content is later fully cleared — until explicitly toggled
            closed or the app restarts (session-scoped via <Code>sessionStorage</Code>, keyed per
            entity). Two or more open panels render side by side in a 2-column grid; a single open
            panel takes the full width.
          </P>
          <P>
            Typing <Code>@</Code> in either a private or team note textarea opens the same picker
            used for @mentions in chat (filtered to speech doc/flow/case/opponent/judge — see below),
            letting you attach an item to that note as a small clickable chip below the textarea.
            There's no separate "+ Tag" button; selecting an item strips the "@query" fragment you
            were typing (tags are structured chips, not inline text) and adds the chip. Tagging works
            differently depending on whether the note is private or shared with your team:
          </P>
          <UL>
            <LI>
              <strong>Private notes</strong> — tags are stored locally (<Code>noteTags</Code> on the
              opponent/judge record) and just point at the local item; nothing is uploaded.
            </LI>
            <LI>
              <strong>Shared (team) notes</strong> — tagging inserts a row into the generalized{' '}
              <Code>message_attachments</Code> table (the same table chat attachments use, now also
              keyed by <Code>team_id</Code> + <Code>note_entity_type</Code>/<Code>note_entity_id</Code>{' '}
              + the tagging user instead of requiring a chat message). A tagged OpenCaselist-imported
              case just stores its source URL, since that's already fetchable. Tags on a teammate's
              shared note show up as read-only chips the next time you open that opponent/judge —
              there's no live push, and private tags never leave your device. Opening a teammate's
              flow tag that you don't already have imports a snapshot as a new local flow; an
              opponent/judge tag navigates by a stable cross-user id (OpenCaselist team ID or Tabroom
              judge ID) if you have a matching local record, otherwise it opens Scouting so you can
              search for them.
            </LI>
            <LI>
              <strong>Tagging a local speech doc</strong> — first checked against your team's{' '}
              <strong>Team Files</strong> library (name + exact byte match, decrypted client-side with
              the team key). If a match exists, the tag just points at that existing entry — no
              re-upload. If not, it's added automatically, no confirmation: the file is encrypted and
              uploaded into Team Files (capped at 2.5MB, same limit as OpenCaselist caching) and the
              tag references that entry, so a teammate opening the tag gets a real, openable copy of
              the doc.
            </LI>
            <LI>
              <strong>Unreachable-tag warning</strong> — a case tag you added that isn't
              OpenCaselist-imported (<Code>data.kind === 'unavailable'</Code>) has no way to reach a
              teammate's device, so it's shown to <em>you</em>, the tagger, with an amber border and a
              ⚠️ icon in place of the type icon, tooltip explaining why — not just to a teammate who
              clicks it and hits a dead end.
            </LI>
          </UL>
          <H3>Reverse lookup: "Tagged in"</H3>
          <P>
            A flow's toolbar and a speech doc/OpenCaselist-imported case's toolbar (<Code>TaggedInIndicator.tsx</Code>)
            show a small "🏷 Tagged in N" pill when at least one opponent/judge note (private or
            shared, across every team) has that exact item tagged. Click it for a dropdown listing
            each match with its source ("Private" or a team name); clicking a match navigates to that
            opponent/judge if you have a matching local record, or shows disabled/greyed if you don't.
            Matching uses a stable identity per item type: a flow by its own id (works across the live
            realtime-synced case since teammates on a shared flow have the same id), an
            OpenCaselist-imported case/doc by its source URL, and a plain local speech doc only against
            your own private tags (there's no portable identity for a bare local file, so shared
            matches aren't attempted). The shared-side query is a new IPC handler,{' '}
            <Code>notes:findTagsByRef</Code>, filtering <Code>message_attachments</Code> by a
            whitelisted JSON-path key (<Code>localRefId</Code>/<Code>url</Code>/<Code>teamFileId</Code>)
            — never arbitrary user input — plus a new <Code>note_entity_name</Code> column so a match
            can show a friendly name even when the viewer has no matching local opponent/judge record
            to resolve <Code>note_entity_id</Code> against.
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
          <P>
            <strong>Custom speech times</strong> — a collapsed-by-default section at the top of the
            tournament page lets you override any individual speech's length (<Code>Tournament.customSpeechTimes</Code>,
            label → seconds) for off-the-clock/non-standard formats. While you're viewing that tournament
            or one of its rounds, the title bar's speech timer (<Code>TitleBar.tsx</Code>'s{' '}
            <Code>SpeechTimer</Code>) resolves the active tournament from the current view and applies any
            overrides on top of the normal <Code>getSlots(event, level)</Code> defaults, matched by label.
            Anywhere else in the app, the timer is unaffected.
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
            It can be accessed by clicking a round in the tournament view. Its AI-generated briefing
            (situation, opponent intel, judge notes, game plan, watch out for) is powered by{' '}
            <Code>ai:missionBrief</Code>. <PromptLink name="mission_brief" />
          </P>
          <P>
            A <strong>Tagged items</strong> card (<Code>TaggedItemsCard</Code> in{' '}
            <Code>MissionBrief.tsx</Code>) surfaces everything tagged in this round's opponent and
            judge notes — private and every shared team, via <Code>fetchAllTagsForEntity</Code> from{' '}
            <Code>src/lib/noteTags.ts</Code> — as clickable chips, read-only. It's the forward
            counterpart to the "Tagged in" reverse lookup on flows/docs (see the Opponents section):
            instead of asking "who tagged this item", it asks "what did this opponent/judge tag",
            which is exactly what's useful at the moment you're prepping a specific round. Clicking a
            chip opens the target the same way a tag click does anywhere else (<Code>openForwardTag</Code>).
            The card renders nothing if there are no tags for either the opponent or the judge.
          </P>
          <P>
            Pasting or dropping a Tabroom pairing email screenshot auto-fills a round's fields via
            OCR, with a Warroom AI vision fallback (<Code>ai:parseRoundEmail</Code>) when the
            deterministic OCR parse doesn't match a known Tabroom format.{' '}
            <PromptLink name="round_email_parse" />
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

          <H3>Coin Flip</H3>
          <P>
            A coin-flip icon sits just to the left of the timer. Click it to open a small popup with
            an animated flip, then click <strong>Flip</strong> — the coin spins and lands on heads or tails.
          </P>
          <P>
            <strong>It is a genuine 50/50 flip.</strong> The outcome is decided the instant you click
            — via <Code>Math.random() &lt; 0.5</Code> — before any animation runs. The spin you see
            (a random 4–7 extra full turns) is purely cosmetic; the coin is then told to land at the
            rotation angle that matches the result already chosen. Nothing about the visual weights
            the outcome toward either side.
          </P>

          <H3>Touch Bar <Badge color="blue">macOS</Badge></H3>
          <P>
            On a Touch Bar MacBook, the timer, coin flip, and global search also live on the physical
            Touch Bar — a mirror of the title bar controls, not a replacement for them. It shows a
            search button, a flip button, the speech-type name (tap to cycle to the next speech), a
            live countdown, <Code>−15s</Code> / <Code>+15s</Code> stepper buttons, play/pause, and reset.
          </P>
          <P>
            Two things intentionally work differently there, both hardware limits rather than
            oversights: the coin's animation can't run on the Touch Bar itself (it has no way to host
            the app's actual on-screen content), so the flip button opens the popup and runs the real
            animation on your display, same as clicking it normally. And there's no way to type on the
            Touch Bar, so instead of clicking a digit and entering a number, custom time is set with the
            +/− steppers.
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
          <H3>Flow folders and the Flows grid</H3>
          <P>
            Clicking <strong>Flow</strong> in the sidebar opens the <Code>FlowsGrid</Code> view — your
            whole flow library as a grid of folders and flow tiles, mirroring the Cases grid. Folder
            management lives there rather than behind a sidebar header button (which was removed, to
            match how Cases works). <Code>src/utils/flowFolders.ts</Code> stores the same shape as{' '}
            <Code>caseFolders.ts</Code> under its own <Code>flow_folders</Code> key and reuses all the
            same pure tree helpers; <Code>FlowsGrid</Code> also imports the generic folder UI
            (breadcrumbs, folder tiles, the delete-confirm dialog) straight from <Code>CasesGrid</Code>,
            so the two libraries can't drift apart — only the flow tile itself is bespoke.
          </P>
          <P>
            Everything behaves like Cases: drag to file, drag tile-onto-tile to reorder, right-click for
            Move to / Rename / Delete (works even when the target folder is collapsed), breadcrumb
            navigation with folders as drop targets, and search that spans every folder at once. Flow
            folders use distinct drag MIME types from Cases folders, so the two trees can't accept each
            other's items. A folder is only a label: filing never touches{' '}
            <Code>flow_data_&lt;id&gt;</Code>, and deleting a folder moves its contents up a level. The
            sidebar still shows the same folders as an expandable tree — same store, so both views stay
            in step.
          </P>
          <P>
            <strong>Default order.</strong> New flows appear newest-created-first, same as Cases —
            <Code>FlowMeta</Code> carries a <Code>createdAt</Code> timestamp set at every creation site,
            and both the grid and the sidebar tree seed it into the shared folder order the same way
            Cases does. Drag a tile onto another to reorder; that sticks until rearranged again. Flows
            created before this field existed fall back to their position in the flows index.
          </P>
          <P>
            <strong>Multi-select and bulk actions.</strong> Cmd/Ctrl+click a flow tile to select several
            at once — a bar appears with <strong>Move to</strong> and <strong>Delete</strong>, same
            component the Cases grid uses. Deleting (single tile or bulk) is undoable via the usual
            bottom-left toast.
          </P>
          <P>
            <strong>Tile preview.</strong> Each tile's mini flow-grid glyph reflects whether that flow
            actually has content in its first few columns yet, instead of always drawing the same fixed
            decoration.
          </P>
          <H3>Two engines</H3>
          <P>
            Auto Flow's step 2 offers a choice, remembered between runs:{' '}
            <strong>Read the document</strong> or <strong>Warroom AI</strong>. The parser uses the
            doc's own heading structure — the speech heading gives the column, the position heading
            gives the tab — so it is instant, makes no API call, and has <em>no length limit at any
            file size</em>. On real speech docs it places about 98% of cards unaided.
          </P>
          <P>
            Warroom AI is for the case the parser can't do: a doc that labels every off-case block
            with the same generic header, so the headings never say what the positions are. Rather
            than guess, the parser groups those cards on one tab and reports the count on the review
            step, suggesting the AI instead.
          </P>
          <H3>Your own instructions</H3>
          <P>
            <strong>Settings → Auto Flow instructions</strong> is one line of free text folded into
            the sorting prompt on every run — tab organisation ("always give T its own tab") or flow
            naming ("name flows Opponent — Round N"). It outranks Warroom AI's own defaults on
            anything it covers, including the aff-name default below. It deliberately cannot change
            the response format, drop cards, or invent them; the prompt tells the model to follow the
            format and ignore any part of an instruction that conflicts with it.
          </P>
          <H3>Naming, and when nothing gets written</H3>
          <P>
            A new flow is named after the <strong>aff being read</strong> — Warroom AI reads it off
            the 1AC — since that's how a debater refers to a round whichever side they were on. When
            the docs give no usable read on the aff (a neg-only upload) it returns nothing rather
            than guessing, and the flow is named after today's date instead. Never the file name.
          </P>
          <P>
            If Warroom AI comes back without a usable placement for a single card, <strong>no flow is
            created</strong> — the run fails with an explanation and returns to the sort step. This
            previously produced an empty flow with one blank tab and no error, because the default
            layout's tabs are all numbered placeholders and the cleanup pass correctly removed every
            one of them.
          </P>
          <H3>Live writing vs. review</H3>
          <P>
            A <strong>brand-new</strong> flow skips the review step entirely: the flow is created
            empty, opened, and then filled in front of you, with the tab switching on its own as
            Warroom AI moves between positions. The wizard collapses to a small corner card with a{' '}
            <strong>Skip animation</strong> button. Every frame is a real save, so closing mid-run
            keeps whatever has landed.
          </P>
          <P>
            Adding into an <strong>existing</strong> flow deliberately keeps the review step and
            writes in one silent pass — that flow holds your own work, so a bad placement has a real
            cost and approval stays opt-in.
          </P>
          <H3>How Auto Flow creates and cleans up tabs</H3>
          <P>
            When Auto Flow needs a tab for a position it found, it <strong>makes a new one</strong>.
            It never takes over one of the blank numbered tabs a flow starts with ("Off 3", "Adv 2")
            and renames it — that used to repurpose slots you might have been holding, and it made
            tab order depend on which slot happened to be free rather than on the order positions
            actually came up in the doc.
          </P>
          <P>
            Then, once everything is written, any tab that is <em>both</em> still carrying a default
            name (<Code>Off 4</Code>, <Code>Adv 3</Code>, <Code>Sheet 2</Code>) <em>and</em>{' '}
            completely empty is removed. A tab with a real name is always kept even when it's blank —
            an empty "Politics DA" tab tells you the position was there but nothing landed on it.
            Cleanup runs on existing flows too, and a flow is never left with zero tabs.
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
            spreadsheet and map the columns correctly. Both policy and PF flows are supported.{' '}
            <PromptLink name="flow_import" />
          </P>
          <P>
            The imported flow appears in the sidebar and can be renamed and edited like any other
            flow.
          </P>
          <H3>Editing flows</H3>
          <P>
            The flow editor works like a paper flow with spreadsheet conveniences. Cells support{' '}
            <strong>rich text</strong> — <Code>⌘B</Code> bold, <Code>⌘I</Code> italic,{' '}
            <Code>⌘U</Code> underline, <Code>⌘⇧X</Code> strikethrough, and <Code>⌘⇧H</Code>{' '}
            highlight, each with a toolbar button as well. Highlighted text is forced to dark ink so
            the amber stays readable in dark mode. Cells <strong>auto-grow</strong> to fit their text.
          </P>
          <P>
            <strong>Keyboard navigation:</strong> <Code>←</Code> / <Code>→</Code> move the cursor
            through the text, like anywhere else. <Code>↑</Code> / <Code>↓</Code> move a line within
            the cell, and jump to the cell above / below only once there is no line left to go to.{' '}
            <Code>Tab</Code> and <Code>Enter</Code> move to the next column / row.
          </P>
          <P>
            <strong>Pasting:</strong> text pasted from Word or Google Docs is cleaned before it lands
            in the cell. Bold, italic, underline and strikethrough survive; the source document's
            font, size, text color and background are dropped so the paste takes on the cell's own
            styling instead of arriving in Calibri-at-12pt (or, from a dark-themed doc, in invisible
            white). Word's paragraph structure is flattened to a single line break, and the newlines
            it pretty-prints between its tags are collapsed — otherwise a pasted tag arrives with
            blank lines above it and a gap before its cite, because cells preserve typed whitespace.
            Font, size and text color are stripped on <em>render</em> as well, not just on paste — so
            cells pasted before this existed clean themselves up the next time the flow is opened.
            Cleaning is shared with the sanitizer that guards remote and AI-written cell content, in{' '}
            <Code>src/lib/cellHtml.ts</Code>.
          </P>
          <P>
            <strong>Sheets by keyboard:</strong> <Code>⌘1</Code>–<Code>⌘8</Code> jump straight to that
            sheet, <Code>⌘9</Code> jumps to the last sheet (the browser-tab convention, so it still
            lands somewhere useful when a flow has more than nine sheets), and <Code>⌘T</Code> makes a
            new sheet. These work whether or not a cell has focus.
          </P>
          <P>
            <strong>Per-sheet scroll position:</strong> each sheet remembers where it was scrolled to,
            so jumping to another tab and back returns you to the spot you left rather than carrying
            the previous tab's offset over. A tab you haven't visited opens at the top. Positions are
            tracked per sheet id (so deleting or reordering tabs can't mix them up) and last for the
            session.
          </P>
          <P>
            <strong>Columns fill the window.</strong> Collapsing the sidebar, resizing the app window,
            or opening/closing the AI chat panel all automatically stretch or shrink your columns to
            meet the new edge — no dead gap, no manual re-zoom — while keeping every column's size
            proportional to the others. A <strong>Fit to window</strong> toolbar button forces a
            re-fit on demand too.
          </P>
          <P>
            <strong>Arrows are straight lines:</strong> an arrow linking an argument to its answer is
            drawn edge-to-edge as a straight line. Same-column arrows (an answer that couldn't share
            its target's row) run down the outside edge of the column so the line never cuts through
            the arguments between the two endpoints.
          </P>
          <P>
            <strong>Reorder tabs by dragging:</strong> sheet tabs can be dragged left/right to any
            order — a blue insertion marker shows the drop position, the active tab follows itself,
            and the reorder is undoable with <Code>⌘Z</Code> (it's a recorded sheet op like add /
            delete / rename). Handy for fixing a tab Auto Flow placed out of order.
          </P>
          <P>
            <strong>Move an argument (<Code>⌘↑</Code> / <Code>⌘↓</Code>):</strong> swaps the cell's
            content with the cell above / below it in the same column and carries the caret along, so
            an argument can be nudged into position without cut-and-paste. It saves and records
            history like typing does, so it is undoable with <Code>⌘Z</Code>.
          </P>
          <P>
            <strong>Draw arrows:</strong> arrows link an argument to its answer across columns, like
            the line you'd draw on a paper flow. Press <Code>⌘L</Code> inside the source cell to mark
            it, arrow-key to the target cell, and press <Code>⌘L</Code> again to draw — or use the
            curved-arrow toolbar button and click the source cell, then the target cell. The two are
            interchangeable, so an arrow can be started with the keyboard and finished with a click.
            Click the <Code>×</Code> on an arrow's midpoint to delete it; press <Code>Esc</Code> to
            cancel. Arrows are saved per sheet.
          </P>
          <P>
            <strong>Insert a cell between two others:</strong> hover a cell and a small <Code>+</Code>{' '}
            appears on its bottom edge — click it to slot a blank cell into that column between the two,
            shifting everything below it down one row. It's a single-column insert (the other columns
            stay put), so you can drop in a missed argument without re-typing the ones under it.
            Undoable with <Code>⌘Z</Code>.
          </P>
          <P>
            <strong>Tab previews:</strong> long tab names truncate with an ellipsis instead of
            overflowing. Hover a tab at the bottom and a tooltip shows its full name plus a summary
            of the argument as a whole on that sheet — a real Warroom-AI-written sentence (marked
            with a ✨), not a list of what's on the tab. The first time you hover a tab with content
            on it, Warroom AI generates that sentence on the spot (you'll briefly see "Warroom AI is
            summarizing this tab…"); it's then cached and reused on every later hover until you
            actually change something on that sheet, so most hovers don't cost a call at all. Auto
            Flow's opt-in AI card-summary option can also seed this for free at write time, folded
            from the per-card summaries it already generated.
          </P>
          <P>
            <strong>Find (<Code>⌘F</Code>):</strong> a find bar searches across all tabs in the flow.
            Enter / Shift+Enter jump between matches; Esc closes. Every hit on the tab you're looking
            at gets a soft amber wash and the one you're currently on is painted solid, so your eye
            lands on it without hunting through the cell. Highlighting is drawn over the text rather
            than written into it, so it never becomes part of the flow. (Mirrors the speech-doc
            viewer's find.)
          </P>
          <P>
            <strong>Undo / redo:</strong> <Code>⌘Z</Code> undoes and <Code>⌘⇧Z</Code> redoes, also
            available as toolbar buttons — which grey out when there's nothing left to undo or redo.
            Undo covers text edits, column changes, colors, arrows, inserted rows, layout switches,
            and sheet-tab operations — adding, renaming, and deleting a tab all record history, so a
            deleted tab (and everything on it) comes back with <Code>⌘Z</Code>.
            It undoes what you <em>changed</em> and leaves you on the tab you're looking at — switching
            tabs isn't an edit, so it's never something undo puts back.
          </P>
          <P>
            <strong>Stock Issues vs. Advantage</strong> is only offered as a toggle while the flow is
            still empty — switching rebuilds the sheets for that layout, so once there's any content
            the toggle disappears rather than risk wiping tabs you've added, renamed, or filled. (The
            Policy/PF event toggle isn't shown at all — a flow's event is set when it's created.)
          </P>
          <P>
            <strong>Column colors:</strong> each column header has an always-visible <Code>▾</Code>{' '}
            menu with a color palette to recolor that column; "Reset to default" restores the side
            color. The default Aff/Pro and Neg/Con column colors can be set for all flows in{' '}
            <strong>Settings → Flow</strong> (Column colors).
          </P>
          <H3>Live collaboration (realtime co-flowing)</H3>
          <P>
            <strong>Sharing a flow starts a live session automatically</strong> — there's no
            separate "Collaborate" button, and no "Go live" button either; both used to lead to (or
            trigger) the same thing sharing now does on its own. Open <strong>Share</strong>, pick
            who to send it to, and hitting <strong>Share</strong> is the moment it goes live (if it
            wasn't already) — recipients join the exact same document instead of getting a copy, and
            can type into it at once with edits appearing <strong>character-by-character</strong>,
            like Google Docs. A green <strong>Live</strong> pill in the toolbar shows who else is
            present and lets you leave the session — it's a status readout, not a button — and each
            teammate's active cell is ringed and tagged in their color.
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
          <P>
            <strong>Sharing a flow now always goes live first</strong> if it isn't already and a team
            is signed in — there's no path left that hands a recipient an independent copy. Without
            this, a plain share created a brand-new flow id on the recipient's side, so if both people
            happened to have their own copy open at the same time, there was no shared document
            underneath — just two flows silently drifting apart with no way to reconcile them. Sending
            now starts (or reuses) the live session before building the share payload, so every
            recipient always lands in the exact same document from the moment they open it.
          </P>
          <H3>Round Analysis</H3>
          <P>
            A magnifying-glass toolbar button next to Share opens <strong>Analyze Round</strong> — a
            wizard that reads the debater's own flow as ground truth for what has been said and
            where, and asks Warroom AI for a strategic read: what looks dropped or conceded, which
            clashes are still live and who currently appears to be ahead on each, and concrete
            suggestions for the next speech in the flow's own speech order.
          </P>
          <P>
            The flow is automatically flattened into a plain-text summary — sheet by sheet, column
            by column (in the flow's actual left-to-right speech order), one line per non-empty cell
            in row order — using the same <Code>flushAndGetSheets()</Code> snapshot the Share panel
            uses, so unsaved edits on the active tab are included. Before analyzing, the debater can
            add free-text notes (which side they're on, the round number, what they think is
            winning or losing — anything not already on the flow) and optionally drop in
            supplementary <Code>.docx</Code> files (case docs, blocks) for extra context, extracted
            the same way the speech doc viewer reads a document. <PromptLink name="analyze_round" />
          </P>
          <P>
            If something essential is genuinely unclear — most often, which side the debater is
            on, since that decides every "who's ahead" call — Warroom AI can pause and ask a single
            clarifying question (the same ambiguity escape hatch the guided card cutter uses) instead
            of guessing; the debater answers and the analysis re-runs with that context.
          </P>
          <P>
            <strong>The result is structured, not a wall of prose</strong> — it's built to look and
            read like <strong>Impact Calc's</strong> result view. A colored <strong>verdict banner</strong>{' '}
            shows who's ahead right now and why; a <strong>Dropped &amp; Conceded</strong> section lists
            each abandoned argument as its own card, tagged by side and sheet; a{' '}
            <strong>Live Clashes</strong> section shows each contested argument as a card with both
            sides' positions side-by-side and a winner badge, exactly like Impact Calc's clash cards;
            and a numbered <strong>For Your Next Speech</strong> list gives concrete, flow-specific
            next steps. The banner and clash cards use your <em>actual</em> Aff/Neg (or Pro/Con) column
            colors from <strong>Settings → Flow</strong> (Column colors), so the analysis matches what you
            already see on your flow. Every piece of AI-written text still supports{' '}
            <strong>bold</strong>/<em>italic</em>/<u>underline</u> emphasis.
          </P>
          <P>
            <strong>Your analysis is saved automatically</strong> — closing the panel never loses it.
            Reopening it for the same flow shows the last result right away instead of an empty setup
            screen, with a small note above the verdict banner telling you when it was run (your flow
            may have changed since). Click <strong>New analysis</strong> when you actually want a fresh
            read — it clears your notes and uploaded docs too, not just the result, so it's a real
            restart rather than a re-run.
          </P>
        </section>

        {/* ── Auto Flow ──────────────────────────────────────────────── */}
        <section id="doc-auto-flow">
          <H2>Auto Flow</H2>
          <P>
            A wand-icon button next to the sidebar's Flow section opens <strong>Auto Flow</strong> — a
            wizard that uploads one or more speech docs (<Code>.docx</Code>) and has Warroom AI sort
            every card's tag into the right column and sheet of a flow, either a brand-new one or an
            existing one.
          </P>
          <P>
            Auto Flow reads only headings and cites, via the same{' '}
            <Code>speechdoc:extractBlocks</Code> handler / <Code>ExtractedFlowCard</Code> shape used
            elsewhere (pocket, hat, block, tag, cite) — it <strong>never</strong> reads or transmits a
            card's body text, to Warroom AI or anywhere else. A doc that fails to parse or yields no
            cards is shown but doesn't block the rest of the batch.
          </P>
          <H3>Choosing a destination</H3>
          <P>
            The user picks either a <strong>new flow</strong> — Auto Flow infers policy vs. PF from
            the uploaded docs' speech-label pockets (<Code>1AC</Code>/<Code>1NC</Code>-style labels vs.
            "Pro Case"/"Con Rebuttal"-style labels; there's no manual event toggle), and for policy
            also guesses Stock Issues vs. Advantage from the aff's structure (named advantages vs.
            inherency/harms headings) — this has no toggle either, it's decided silently and just
            works — both falling back to sensible defaults when the docs give no usable signal — or
            an <strong>existing flow</strong>, in which case Warroom AI is told that flow's actual
            current column labels and sheet names (which may have been renamed from the defaults)
            rather than assuming the standard set.
          </P>
          <H3>Sorting and review</H3>
          <P>
            For every card, Warroom AI picks a column by matching the card's pocket (speech label)
            case-insensitively against the flow's real columns, and a sheet by matching the card's hat,
            then block, then pocket topically against the flow's real sheet names — proposing a new
            sheet tab when nothing plausibly fits, and naming that tab with the doc's own shorthand for
            the position when it uses one (a case that says "Federalism DA" once but "Fism DA"
            afterward gets a "Fism DA" tab). Numbered placeholder tabs from the default layout ("Off
            1", "Adv 2", "Contention 1") are never treated as destinations — every case and off-case
            position gets a tab named after the position itself, and the write step renames an unused
            placeholder slot to that name rather than stacking new tabs after a row of dead defaults.
            Tabs are also <strong>ordered</strong>: your advantages come first, as the leftmost tabs,
            in the order they came up in the 1AC, with off-case flows after them. On a new flow,
            leftover blank placeholder tabs are <strong>pruned</strong> — a two-advantage doc won't
            leave a dead "Adv 3", and unused "Off 3"/"Off 4" slots are dropped (RFD/Notes and the
            stock-issues aff tabs are always kept, blank or not). When a doc labels every off-case
            block with the same generic header ("1NC", "Off", "1NC—OFF") instead of naming the
            position, it reads the actual tags to tell the positions apart, keeps distinct positions
            (a CP vs. a DA) on separate tabs instead of merging them, and — when you've pre-named
            some tabs and left others blank — files each unmatched position into a remaining empty
            slot rather than forcing it into a named tab it doesn't belong to.
            It also shortens each card's cite to how a debater
            actually writes it — author and year ("Price '26"), not the full credentials paragraph —
            and flags which cards answer which (a perm, a no-link) and which card is the plan text. It
            can pause with a single clarifying question for the whole batch (the same ambiguity escape
            hatch the guided card cutter uses) when a chunk of cards has no usable pocket label, or two
            sheets are equally plausible — never to ask permission for a routine new tab.{' '}
            <PromptLink name="auto_flow_classify" />
          </P>
          <P>
            The review step groups proposed placements by destination sheet (new tabs marked{' '}
            <strong>NEW</strong>), showing each card's tag and its "Sheet → Column" destination with a
            checkbox to drop any placement before it's written.
          </P>
          <H3>Optional AI card summaries</H3>
          <P>
            A toggle switch on the destination step (<strong>off by default</strong>) swaps each card's
            tagline + cite for a <strong>short AI summary of the card</strong>, written from both its
            tagline and its actual evidence, and forced to be <em>fewer words than the tagline itself</em>
            {' '}— Warroom AI is given the tagline's exact word count as a ceiling, and the result is
            hard-truncated if it overshoots anyway. The word counts are computed the moment the docs are
            uploaded, so nothing has to be recalculated when the option is switched on.
          </P>
          <P>
            This is the one part of Auto Flow that reads card bodies, and they never leave the main
            process — the evidence is re-read there, summarized, and only the short summaries come back.
            No <strong>AI ring</strong> on the resulting cells, though — an AI-written summary is
            standing in for the tagline itself, and taglines never get the ring (see the
            Architecture section). It costs an extra Warroom AI call, which is why it's opt-in.
          </P>
          <H3>Writing into the flow</H3>
          <P>
            Accepted placements are written straight to the flow's stored data (not through the live
            Yjs sync path) in three passes so answers line up with what they answer. The{' '}
            <strong>plan</strong> goes first — always the very first cell of the first sheet. Then
            every <strong>original</strong> card lands in the first empty row of its column. Finally
            each <strong>answering</strong> card is placed: on the <em>same row</em> as the card it
            answers when that spot is free (so they read across like a paper flow), or — when a second
            card answers the same one — on the next row with an <strong>arrow drawn back</strong> to
            what it answers, so the connection stays visible. If a column runs out of room, that
            placement is skipped and surfaced in a summary rather than silently dropped. The tag is
            wrapped in whatever emphasis is set in <strong>Settings → Auto Flow tag style</strong>{' '}
            (bold/italic/underline — the only emphasis a flow cell can carry, per{' '}
            <Code>src/lib/cellHtml.ts</Code>'s allowed tags); the shortened cite underneath is always
            plain text.
          </P>
        </section>

        {/* ── Speech Doc ─────────────────────────────────────────────── */}
        <section id="doc-speech-doc">
          <H2>Speech doc viewer</H2>
          <P>
            The <Code>SpeechDocViewer</Code> renders <Code>.docx</Code> files in-app using{' '}
            <Code>docx-preview</Code>. It is always mounted (hidden when inactive) so it preserves
            state across navigation. Recent docs are tracked in <Code>localStorage</Code> under{' '}
            <Code>warroom-speech-doc-recents</Code> (cap {40}), which doubles as the sidebar's
            Cases list — writes dispatch a <Code>storage</Code> event so the sidebar re-reads.
          </P>
          <P>
            Opening a <Code>.docx</Code> from Finder triggers the <Code>onFileOpen</Code> IPC event
            and navigates to the speech-doc view. Speech docs can also be attached to chat messages
            and shared with teammates.
          </P>
          <P>
            <strong>Multi-upload.</strong> The drop zone and picker both accept many docs at once —{' '}
            <Code>dialog:openFiles</Code> opens a <Code>multiSelections</Code> dialog. Every path is
            written to recents <em>before</em> the first doc renders, so the whole batch shows up in
            the sidebar immediately and a doc that fails to render still lands there. Because
            Electron removed <Code>File.path</Code> in v32, dropped files are resolved via{' '}
            <Code>webUtils.getPathForFile</Code> in the preload; since that only resolves genuine{' '}
            <Code>File</Code> objects (a renderer cannot forge one carrying an arbitrary path), a
            drag-drop is a valid trust anchor and <Code>fs:trustDropped</Code> persists those paths
            the same way dialog picks are trusted.
          </P>
          <P>
            <strong>Drop zone feedback.</strong> One of the app's three file-drop targets — this one,
            Auto Flow, and AnalyzeRound's supplementary-docs zone — all share <Code>useDragActive()</Code>{' '}
            for the drag-over reaction (accent border + tinted background while a file's dragged over).
            After a drop, this zone unmounts in favor of <Code>LoadingPanel</Code>, same as Auto Flow's
            own loading screen; AnalyzeRound's zone stays mounted through the read instead, so it shows
            a <Code>ProgressBar</Code> in place of the drop prompt while busy.
          </P>
          <P>
            <strong>Import a whole folder.</strong> <Code>dialog:openFolderOfDocx</Code> opens a
            native directory picker and recursively walks it (capped at 2000 files) for{' '}
            <Code>.docx</Code> files, trusting each one the same way. <Code>pickFolder()</Code>{' '}
            imports every result, then creates one new Cases folder named after the picked
            directory and files every doc into it in a single update.
          </P>
          <P>
            The toolbar includes <strong>Focus mode</strong> (hides body text, leaving only card
            structure and highlighted / underlined runs), <strong>Find</strong> (in-doc search),{' '}
            <strong>Reading time</strong> / auto-scroll, <strong>Send to Flow</strong>,{' '}
            <strong>Cross-Ex Practice</strong>, and <strong>Card Credibility</strong>. The open
            document's name is always shown in the toolbar between the tool cluster and the
            AI-tool pills.
          </P>
          <P>
            <strong>Side-by-side compare (up to 3 panes).</strong> A <strong>compare-doc</strong>{' '}
            button in the tool cluster (and on the idle drop-zone) opens a second and third doc
            pane alongside the main one, each independently scrollable, searchable, and drag/drop
            or browse-loadable — useful for reading a case against a block, or comparing two teams'
            1ACs. The main pane (pane 0) always tracks whatever the rest of the app opened (sidebar,
            Home, Cases grid); the two extra panes are opened and closed from inside the viewer
            itself, via the <Code>extraDocPanes</Code> array in <Code>appStore</Code>. Clicking into
            a pane focuses it — keyboard shortcuts like <Code>⌘F</Code> apply only to the focused
            pane so three open panes don't all react to the same keypress. Each extra pane has its
            own close (×) button next to its filename. Opening a second or third pane
            auto-collapses the left sidebar (no room for it) and closes the Warroom AI panel and
            team chat panel if either was open, for the same reason; all three re-expand/reopen once
            you're back down to one pane, restored to whatever they were right before comparing
            started — unless you manually change one while comparing, in which case that choice is
            remembered the next time you open this exact combination of docs (see below;{' '}
            <Code>forceChatOpen</Code>/<Code>forceGeminiOpen</Code> in <Code>appStore.ts</Code> apply
            these without recording an override, while <Code>setChatOpen</Code>/
            <Code>setGeminiOpen</Code> — the ones every other call site uses — record one whenever a
            multi-pane combo is active). When 2+ panes are open, the Credibility and Cross-Ex buttons
            shrink to icon-only to save room.
          </P>
          <P>
            <strong>"+ compare doc" opens ephemeral, not persisted, state.</strong> Clicking it sets{' '}
            <Code>pendingEmptySlot</Code> (wrapper-local <Code>useState</Code>) rather than writing an
            open-but-empty <Code>''</Code> sentinel into <Code>extraDocPanes</Code> the way an earlier
            version did — that sentinel was exactly the shape session-restore (which persists{' '}
            <Code>extraDocPanes</Code> across app restarts) couldn't tell apart from a real saved pane,
            so clicking + and closing the app before ever dropping a file in could resurrect a phantom
            empty third pane on the next launch, unprompted. The pending slot renders identically (its
            own drop-zone, its own × ) but is invisible to persistence since it's never written to the
            store; an effect clears it the moment a real file lands in that slot, and it counts toward{' '}
            <Code>openPaneCount</Code>/<Code>canAddPane</Code> exactly like a real pane while showing.
          </P>
          <P>
            <strong>Resize panes.</strong> Drag the thin divider between two panes to resize them —
            they start out equal. The divider itself never persists as a standalone preference; it's
            saved as part of the remembered layout for the exact set of docs open together (see
            next).
          </P>
          <P>
            <strong>Layouts remember themselves per doc combination.</strong> Pane widths, which
            pane(s) have their outline open, and any sidebar-expanded override are all saved
            together, keyed to the exact, ordered set of doc paths currently open (
            <Code>utils/docComboLayout.ts</Code>). Opening those same files together again — in the
            same panes — restores exactly how you left it. A different set of docs, or the same docs
            in different panes, starts fresh. Single-pane viewing never uses this (nothing to
            combine).
          </P>
          <P>
            <strong>Compare views in the sidebar.</strong> Every saved combination also surfaces as
            a row right under <strong>Cases</strong>, above your regular docs and folders and set off
            by a thin divider (<Code>CompareViewsGroup</Code> in{' '}
            <Code>Sidebar.tsx</Code>), newest first, so a multi-doc setup is something you return to
            rather than rebuild pane by pane. Clicking a row restores every pane in one go; the
            per-combo widths/outline/sidebar memory is then applied by the viewer as usual. Hovering
            a row reveals an × that forgets the grouping (with an Undo toast) — never the docs
            themselves. Changing a pane's doc updates the view you're in rather than registering
            another near-identical one; a genuinely new side-by-side setup gets its own entry.
            Clicking any doc in the sidebar (or back/forward) leaves compare mode entirely and opens
            that doc alone — <Code>setView</Code>/<Code>goBack</Code>/<Code>goForward</Code> clear{' '}
            <Code>extraDocPanes</Code>, so a compare layout is never a state you get stuck in. Rows are labelled from the live Cases list, so renaming a doc renames it
            here too, and <Code>pruneComboViews</Code> drops any view referencing a deleted doc
            (guarded so an empty or partial recents read can't wipe the list). Double-click a row to
            give the whole view a custom name (<Code>renameComboView</Code>) — an empty name or
            retyping the auto label clears it back to the auto-generated one; the row's tooltip
            always shows the full joined doc names underneath so a renamed view stays identifiable.
          </P>
          <P>
            <strong>Toolbar overflow menu.</strong> With 2+ panes open there isn't room for a full
            toolbar per pane, so Reading time, Send to flow, Credibility, and Cross-Ex collapse into
            a hover-opened <strong>⋯</strong> menu (<Code>ToolbarOverflowMenu</Code>), where they
            keep their text labels. The two AI tools keep their gradient ring on their menu rows;
            the ⋯ button itself doesn't get one, since opening a menu isn't an API call. The
            highlight-readability slider folds into this same menu once compact (via a new{' '}
            <Code>extra?: React.ReactNode</Code> prop, appended after a divider) instead of keeping
            its own separate trigger — the standalone version only renders when{' '}
            <Code>!toolbarCompact</Code>, so a compact pane never shows two <strong>⋯</strong> buttons
            side by side.
          </P>
          <P>
            <strong>Rename a doc.</strong> Double-click the doc's name in the toolbar to rename it
            in place — for an OpenCaseList-imported case this renames the case; for a plain file it
            renames the recents/sidebar entry. The file on disk is never touched.
          </P>
          <P>
            <strong>Outline.</strong> Heading navigation (pockets, hats, blocks, card tags) lives
            behind a slim pull-tab on the left edge of each pane instead of a permanent
            sidebar-style panel — click the tab (or its chevron) to slide the outline open, which
            pushes the doc over rather than covering it; click again (or the panel's own × ) to
            tuck it away. It starts closed every time a doc loads unless{' '}
            <strong>Always open the outline</strong> is on in Settings (see below), in which case
            it opens for every doc.
          </P>
          <P>
            <strong>Outline layout in compare view.</strong> When 2-3 panes are open, opening an
            outline affects the other panes in one of two ways, set in Settings (default{' '}
            <strong>Dedicated space</strong>): <strong>Dedicated space</strong> opens a fixed-width
            column that isn't resizable — the active pane and its reading "partner" (the next pane
            to its right, or the previous one if it's the rightmost pane) share about 85% of the
            view. Every other pane keeps its full width and simply scrolls out of view to the left,
            with a sliver of the nearest one left showing as a hint that the row scrolls — panes are
            never squeezed down to make room. <strong>Squish neighbor</strong> instead borrows the outline's width from
            one neighboring pane — everything stays within the viewport, nothing scrolls, and the
            active pane's own reading width doesn't shrink. Dragging pane dividers is disabled while
            a "Dedicated space" outline is open (that split isn't adjustable); it works normally
            otherwise.
          </P>
          <P>
            <strong>Comments.</strong> Select text in a doc and click the comment bubble that appears
            — or press <Code>⌘⌥M</Code> / <Code>Ctrl+Alt+M</Code>, Google Docs' own "insert comment"
            shortcut, which fires <Code>openComposerFromSelection</Code> against the live selection
            (<Code>selBubble</Code>) and does nothing without one — to leave a note on it,
            Google-Docs style, visible to <strong>Team</strong> by default or <strong>Only me</strong>.
            Hovering a card's tag paragraph instead reveals a small margin comment icon (
            <Code>openComposerFromCard</Code>) that anchors the whole card — tag through cite end,
            via <Code>anchor_kind: 'card'</Code> — without selecting any text first. The highlighted
            span gets a light purple wash (deliberately not cyan/yellow/green, so it never reads as
            the document's own evidence emphasis). A single plain icon-only <strong>Comments</strong>{' '}
            toolbar button — no <Code>ai-glow-ring</Code>, since leaving a comment never calls a
            model — toggles one combined <Code>commentsVisible</Code> boolean that both opens the
            right-side thread panel and shows every highlight; closing it (the button again, or the
            panel's own ×) hides both together. Clicking a comment row calls{' '}
            <Code>scrollToComment</Code>, which scrolls to its anchored text and briefly flashes its
            background so it's easy to spot; a reply resolves to its thread root's anchor first,
            since replies carry no anchor of their own.
          </P>
          <P>
            <strong>Reply threads, resolve/reopen, and mentions.</strong> Reply inline under any
            comment (its own <Code>MentionableTextarea</Code> box, collapsed "N replies" by default)
            — a reply is just another <Code>doc_comments</Code> row with <Code>parent_id</Code> set,
            inheriting its root's anchor. Any team member can mark a thread{' '}
            <strong>resolved</strong> (a checkmark on hover), not only its author — since RLS only
            lets the author edit a row directly, this goes through the{' '}
            <Code>resolve_doc_comment</Code> security-definer RPC instead. Resolved threads dim to
            65% opacity, drop out of the highlighted-text set, and collapse into a "N resolved"
            disclosure at the bottom of the panel; reopening un-resolves them. Type <Code>@</Code> in
            any comment or reply box to bring up the same <Code>MentionPicker</Code> Chat.tsx's
            composer uses, restricted to <Code>types=['member']</Code> — mentions render as a bolded,
            blue-tinted chip (<Code>renderCommentBody</Code>) parsed from the plain{' '}
            <Code>@Name_With_Underscore</Code> text at display time, same convention chat mentions
            already use, just with a visual chip chat doesn't have. Only the author can delete their
            own comment (which cascades to its replies via the schema's{' '}
            <Code>on delete cascade</Code>). All of it requires being signed into a team (the button
            and shortcut are inert without one); team comments, replies, and resolutions sync live to
            teammates viewing the same doc.
          </P>
          <P>
            <strong>Highlight readability slider.</strong> A small <strong>⋯</strong> button in the
            toolbar (next to Share) opens a one-slider popover, <Code>HighlightReadabilityMenu.tsx</Code>{' '}
            — 0–100, default 50, persisted as <Code>warroom-highlight-readability</Code> and broadcast
            via a <Code>HIGHLIGHT_READABILITY_CHANGED</Code> window event so every open pane (and{' '}
            <Code>GoogleDrivePanel.tsx</Code>'s Word viewer) stays in sync with no prop wiring between
            them. At 0 it renders Word's exact highlighter colors; at 100 it fully mutes them toward
            per-color pastel targets, yellow/cyan/green all softening without converging on one
            generic look — pure green in particular reads harsher than the other two at the same
            technical luminance (the luminance formula weights G at 0.587 vs. R/B's 0.299/0.114, and
            pure green sits at the peak of human contrast sensitivity), which is what originally
            motivated this. <Code>docxViewerUtils.ts</Code>: <Code>tagHighlightElements</Code> walks a
            freshly-rendered doc exactly once, classifying each element's <em>computed</em> background
            against Word's three raw colors and stamping the match onto <Code>data-hl-kind</Code> —
            necessary because a recolored highlight no longer reads as "raw" to reinspect later.
            Every subsequent read — dragging the slider, switching dark mode — goes through that tag via{' '}
            <Code>applyHighlightReadability(container, pct)</Code> (interpolates raw → pastel by{' '}
            <Code>pct/100</Code>, cheap enough for every slider input event) or{' '}
            <Code>resetHighlightReadability(container)</Code>, never by re-inspecting computed style.
            Scoped to light-rendered pages only — light theme, or dark mode with "Keep speech docs
            light" on (the default) — since a genuinely dark page already gets its own luminance-based
            dim from <Code>applyDarkModeViewerFixes</Code>; the reset step runs before that dim
            whenever a page goes dark, so it always computes from the true raw color rather than an
            already-softened one.
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
          <P>
            <strong>Stale Times New Roman on deep headings.</strong> Word's built-in Heading5–9
            styles default to Times New Roman, and templates that only customize the shallow
            levels a debate doc actually uses (1–4) leave that stale default on any tag nested
            deep enough to hit it. That font is set inline, so it beats a CSS class selector —{' '}
            <Code>forceHeadingFont()</Code> walks every paragraph after render and forces any
            heading it identifies back to the Calibri stack with <Code>!important</Code>,
            regardless of what the paragraph's own style says. Thumbnails in the Cases grid get
            the same fix.
          </P>
          <P>
            <strong>Focus mode always shows cites in full.</strong> A cite paragraph (right after
            a tag) is treated the same as the tag itself — always visible — unless the debater
            actually highlighted part of it. It used to only keep the paragraph's leading{' '}
            <em>bold</em> run visible on the assumption a cite always bolds its author; plenty of
            cites don't, so that span never existed and the whole cite silently vanished.
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
            first and it estimates just that selection. Highlight detection for the word count goes
            through <Code>isSpanHighlighted</Code> (checks <Code>data-hl-kind</Code> first, the tag{' '}
            <Code>tagHighlightElements</Code> stamps from a doc's pristine color right after render,
            before the highlight-readability slider or dark-mode dimming can recolor it — see below) so
            it stays correct once a highlight's displayed color no longer looks "raw" to a brightness
            heuristic. <strong>Auto-scroll</strong> scrolls the doc at your wpm (a{' '}
            <Code>requestAnimationFrame</Code> loop) via a{' '}
            <Code>docAdaptivePace</Code> Settings toggle (default on): off, a flat{' '}
            <Code>scrollHeight / wordCount</Code> px/ms rate; on, <Code>buildSpeedProfile</Code>{' '}
            attributes each spoken word to its paragraph and the loop paces itself to local
            spoken-word density a bit ahead of the current scroll position — slower through dense
            cards, faster through sparse context — clamped to 0.35×–3× the flat rate and eased with
            per-frame exponential smoothing so pace changes read as a gradient, not a step. Total time
            to the bottom stays the same either way; adaptive pacing only redistributes where that
            time is spent. A floating control lets you pause / resume, change speed live, or stop.
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
            <strong>Click-to-jump pin.</strong> Clicking an entry sets a 500ms deadline (
            <Code>pinnedActiveUntilRef</Code>) before scrolling. Without it, the scroll event the
            jump itself causes re-triggers the "which heading is at the top" tracker above, and a
            short/bare heading (an organizational tag with no body under it — "Case" immediately
            followed by "Procedurals") lands in that tracker's detection window right alongside
            the <em>next</em> heading down, so the tracker silently overrides the just-clicked
            heading with its neighbor a frame later. The pin makes the tracker defer to the click
            until the scroll settles.
          </P>
          <P>
            The outline <strong>auto-shows only on the first document you open each app launch</strong>;
            after that it stays in whatever state you left it. A <strong>layers button</strong> (e.g.
            "2/4") in the header cycles how many heading levels are shown — collapse a long file to just
            pockets / hats for fast high-level navigation, then expand back. <strong>Per-branch
            collapse</strong> works independently, Word-Navigation-Pane style — click a branch's own
            arrow to fold just its taglines/sub-points without touching any sibling branch; the flat
            heading list is reconstructed into a real parent/child tree by the standard "nearest
            preceding item with a smaller level is the parent" algorithm. Cards that are unusually{' '}
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
            The answer is the <strong>likely opponent response only</strong>, in their voice. The
            strategic follow-up is shown separately underneath in its own <strong>Press next</strong>{' '}
            box, so advice meant for you never reads as part of what the opponent said.
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
          <P>
            <PromptLink name="cross_ex_questions_initial">View/edit the question-generation prompt →</PromptLink>
            {' · '}
            <PromptLink name="cross_ex_questions_followup">View/edit the "3 more like this" prompt →</PromptLink>
            {' · '}
            <PromptLink name="cross_ex_traps">View/edit the trap-drill prompt →</PromptLink>
            {' · '}
            <PromptLink name="cross_ex_grade_trap">View/edit the trap-grading prompt →</PromptLink>
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
          <P>
            <PromptLink name="card_credibility_scoring" />
          </P>
        </section>

        {/* ── Impact Calc ────────────────────────────────────────────── */}
        <section id="doc-impact-calc">
          <H2>Impact Calc</H2>
          <P>
            Impact Calc is a full-screen hub for everything impact-weighing. Open it from the{' '}
            <strong>Impact Calc</strong> card on the home screen. It has two areas: <strong>Practice</strong>{' '}
            (the Outweigh game) and <strong>Tools</strong> (the doc-comparison analyzer and the Impact
            Library; Head-to-head Matchups is still coming soon).
          </P>

          <H3>The Outweigh game</H3>
          <P>
            A practice drill where you spar with Warroom AI over impact calculus. It follows your event
            setting: <strong>Policy</strong> (Aff/Neg, plans/DAs — LD currently falls back to this framing
            too) or <strong>Public Forum</strong> (Pro/Con, no plan — weighing framed the way it actually
            happens in Summary and Final Focus). A badge in the header shows which one is active. Pick a
            difficulty — <strong>Novice</strong> (concrete, intuitive impacts, no theory), <strong>JV</strong>{' '}
            (classic impacts — engage scope, probability chains, reversibility), or <strong>Varsity</strong>{' '}
            (extinction matchups and framework wars). Then choose how to start:
          </P>
          <UL>
            <LI><strong>Surprise me</strong> — Warroom AI invents a topic and takes a side against you.</LI>
            <LI><strong>Pick my own topic</strong> — optionally attach one of your imported cases or speech
              docs for your side and/or the opponent's, say which side you want to argue, and add any notes
              for the AI. It grounds the generated scenario in your real material instead of inventing an
              unrelated one. (No cases or speech docs yet? Drag a <Code>.docx</Code> onto the app, or use
              the <strong>Import doc</strong> quick action on the home screen — you can also skip docs
              entirely and just use the side/notes fields.)</LI>
            <LI><strong>Use current topic</strong> — pulls the current resolution for your active event
              straight from the Topics feature and grounds the scenario in that real, live topic. If no
              current topic has been fetched yet, it tells you to open Topics first.</LI>
          </UL>
          <P>The round then runs in three beats:</P>
          <UL>
            <LI><strong>Your impact</strong> — Warroom AI presents its impact (a claim, a warrant, and
              ratings on the four dimensions). You write your own impact and a short calc explaining why
              yours outweighs.</LI>
            <LI><strong>AI rebuttal</strong> — Warroom AI fires back a tight 1–2 minute rebuttal speech,
              defending its impact and attacking yours on a specific dimension. You get a final shot — the
              last word — with a 60-second pressure timer that never blocks you: once it hits zero it just
              starts counting overtime instead, and the result screen notes if you went over.</LI>
            <LI><strong>Decision</strong> — a judge calls the round: who won, a 1–10 score on your calc
              work, a written verdict, dimension-by-dimension feedback, and concrete tips. It also grades
              the opponent's rebuttal independently (its own 1–10 score plus a short critique) — that
              grading call is a separate, fresh request from the one that generated the rebuttal, and the
              prompt never tells the model it wrote that speech, so the score can't be biased by
              self-recognition.</LI>
          </UL>

          <H3>Compare two docs (Tools)</H3>
          <P>
            The original analyzer compares two of your own cases, speech docs, or a flow and produces an
            AI impact-calculus breakdown — every clash, a winner on each standard (magnitude, probability,
            timeframe, reversibility), and an overall verdict suitable for a final rebuttal. Saved
            comparisons are listed underneath for one-click reopening.
          </P>

          <H3>Impact Library (Tools)</H3>
          <P>
            A <strong>shared, community-built</strong> database of impacts — everyone using Warroom reads
            and contributes to the same pool. It's <strong>not team-scoped</strong>; it lives in Supabase
            and uses your chat account, so you sign in through the chat panel to browse or contribute. Each
            entry is an AI-structured impact: the four dimensions broken out separately (each with a
            one-line warrant), a set of standard <strong>answers</strong> (how to beat it), and search
            tags.
          </P>
          <P><strong>Contributing</strong> is a three-step wizard:</P>
          <UL>
            <LI><strong>Source</strong> — pick one of your cases/speech docs and/or paste a card or just
              describe the impact, choose the event, and hit <strong>Draft with AI</strong>.</LI>
            <LI><strong>Edit draft</strong> — the AI returns a structured impact (title, claim, four
              dimensions, answers, tags); you fix anything it got wrong.</LI>
            <LI><strong>Review &amp; submit</strong> — the AI re-runs on your edited version to regenerate
              the answers/tags, <strong>sanity-check your edit against the source</strong> (flags claims
              the source doesn't support), and <strong>flag likely duplicates</strong> already in the
              library. You choose attribution — <strong>anonymous by default</strong>, or opt in to credit
              by your chat display name — then add it.</LI>
          </UL>
          <P>
            <strong>Browsing</strong> supports search (title/claim/tags/answers), an event filter, and
            sort by <strong>Top</strong> (net likes), <strong>Newest</strong>, <strong>Saved</strong>
            {' '}(your bookmarks), or <strong>Mine</strong>. Each entry has <strong>like</strong>,
            {' '}<strong>dislike</strong>, and <strong>save</strong> buttons; likes and dislikes take an
            optional quick reason tag (dislike reasons include “AI error”). You can delete your own
            entries.
          </P>
          <P>
            The game is powered by <Code>ai:outweighScenario</Code>, <Code>ai:outweighRebuttal</Code>, and{' '}
            <Code>ai:outweighJudge</Code>; the comparison tool by <Code>ai:compareImpactsText</Code>; the
            library by <Code>ai:impactLibraryDraft</Code> / <Code>ai:impactLibraryReview</Code> plus the{' '}
            <Code>impactlib:*</Code> Supabase handlers (tables <Code>impact_library</Code>,{' '}
            <Code>impact_library_votes</Code>, <Code>impact_library_saves</Code> — re-run{' '}
            <Code>supabase/schema.sql</Code>). All AI runs on the best model tier.
          </P>
          <P>
            <PromptLink name="outweigh_scenario">View/edit the Outweigh scenario prompt →</PromptLink>
            {' · '}
            <PromptLink name="outweigh_rebuttal">View/edit the Outweigh rebuttal prompt →</PromptLink>
            {' · '}
            <PromptLink name="outweigh_judge">View/edit the Outweigh judge prompt →</PromptLink>
            {' · '}
            <PromptLink name="compare_impacts_text">View/edit the doc-comparison prompt →</PromptLink>
            {' · '}
            <PromptLink name="impact_library_draft">View/edit the Impact Library draft prompt →</PromptLink>
            {' · '}
            <PromptLink name="impact_library_review">View/edit the Impact Library review prompt →</PromptLink>
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
        {/* ── LM Studio ──────────────────────────────────────────────── */}
        <section id="doc-lmstudio">
          <H2>LM Studio <Badge color="blue">local</Badge></H2>
          <P>
            A fifth AI provider alongside Gemini/OpenAI/Anthropic/Grok, selected in
            Settings → AI API key → <strong>LM Studio</strong>. LM Studio runs models on the
            user's own machine and serves an OpenAI-compatible REST API on localhost with
            <strong> no authentication</strong>, which makes it structurally different from every
            hosted provider:
          </P>
          <UL>
            <LI>
              <strong>No API key.</strong> Nothing in <Code>secure_*.json</Code>.{' '}
              <Code>getProviderForTask</Code> returns the sentinel <Code>'local'</Code> as{' '}
              <Code>apiKey</Code> purely so the existing <Code>if (!apiKey) throw 'NO_KEY'</Code>{' '}
              guard stays meaningful for hosted providers without every call site special-casing
              local mode. In the renderer, <Code>providerIsConfigured()</Code> returns true
              unconditionally for <Code>lmstudio</Code>, so the "No API key set" banner never fires.
            </LI>
            <LI>
              <strong>No cost tiers.</strong> <Code>getProviderForTask</Code> returns early and
              ignores <Code>taskTier</Code> — one loaded model serves lite/balanced/best alike, so{' '}
              <Code>MODEL_TIER_IDS</Code> has no <Code>lmstudio</Code> entry.
            </LI>
            <LI>
              <strong>The model id is user-owned free text.</strong> It depends on how the user
              downloaded the model, so Settings offers presets (Gemma 4 12B QAT / Gemma 4 12B, the
              default / Gemma 4 E4B) as <em>shortcuts only</em>, plus a free-text field and a
              "Loaded models" button that lists what the running server actually reports.
            </LI>
            <LI>
              <strong>Local failure modes.</strong> Never quota or auth — instead "server isn't
              running", "model isn't loaded", "too slow for this machine".
            </LI>
          </UL>

          <H3>Code layout</H3>
          <P>
            Pure logic lives in <Code>electron/lmstudio.ts</Code> rather than inline in{' '}
            <Code>main.ts</Code> so it's testable without Electron — the same split as{' '}
            <Code>docxFlowCards.ts</Code>. Exercised by <Code>scripts/test-lmstudio.ts</Code>{' '}
            (<Code>npm run test:lmstudio</Code>), which covers URL normalisation, config resolution,
            body building, error mapping, and response parsing, then runs the real request bodies
            against a mock OpenAI-compatible server on a throwaway port.
          </P>
          <P>
            <Code>app_settings</Code> keys: <Code>lmstudioBaseUrl</Code> (default{' '}
            <Code>http://localhost:1234/v1</Code>), <Code>lmstudioModel</Code> (default{' '}
            <Code>google/gemma-4-12b</Code>), <Code>lmstudioOptions</Code> (a JSON string, stored as
            typed), and <Code>lmstudioTools</Code> (bool, default true). A malformed options blob is{' '}
            <strong>ignored, not fatal</strong> — the user types into that box freely, and a
            half-finished <Code>{'{"temp'}</Code> must never be why an AI call fails. Settings shows
            the JSON error inline instead. User options are spread <em>last</em> into the request
            body so they override Warroom's defaults, which is the whole point of the box.
          </P>

          <H3>Tool calling</H3>
          <P>
            <strong>Tool calling normally just works.</strong> Gemma 4 has native structured
            tool-use support, and — importantly — for models <em>without</em> a tool-capable chat
            template LM Studio does <strong>not</strong> error: it substitutes its own system prompt
            and a standardised tool-call format, converting <Code>tool</Code>-role messages to{' '}
            <Code>user</Code> role for templates that lack the role. So the <Code>tools</Code> field
            is safe to send to any loaded model.
          </P>
          <P>
            The <Code>lmstudio</Code> branch of <Code>chat:geminiAgentTurn</Code> still keeps a
            defensive fallback: on a 400/500 whose body matches{' '}
            <Code>looksLikeToolUnsupported</Code>, it retries once <strong>without</strong> tools so
            the chat degrades to a plain conversation instead of failing outright. Given LM Studio's
            own fallback this should rarely fire — it exists for third-party OpenAI-compatible
            servers pointed at the same setting, and for versions/models that reject the field. The
            match is deliberately narrow so a genuine 400 about something else surfaces as itself
            rather than being retried into a confusing second error. The <Code>lmstudioTools</Code>{' '}
            toggle skips sending tools at all.
          </P>

          <H3>Timeout</H3>
          <P>
            <Code>LMSTUDIO_TIMEOUT_MS = 600_000</Code> (10 minutes) rather than the hosted
            providers' 45s: local inference is far slower, and a 12B model on consumer hardware can
            genuinely spend minutes on a long completion. A hosted call hanging that long means
            something is broken; a local one is just working.
          </P>

          <H3>IPC</H3>
          <UL>
            <LI><Code>lmstudio:listModels(baseUrl?)</Code> — <Code>GET {'{baseUrl}'}/models</Code> → id list. The argument lets Settings probe a URL the user typed but hasn't saved.</LI>
            <LI><Code>lmstudio:test</Code> — saves, then round-trips a one-token prompt through the configured model, returning the id the server actually served, its reply, and elapsed ms.</LI>
          </UL>
          <P>
            Both are exposed as <Code>window.warroom.lmstudio.*</Code> in their own preload
            namespace — deliberately <strong>not</strong> under <Code>api.ai</Code>, whose wrapper
            loop turns every method into a retry-and-toast call. That's wrong for a button the user
            just clicked and is watching: a failure should come straight back, not stall for
            8/30/60s.
          </P>

          <H3>Renderer error copy</H3>
          <P>
            <Code>humanizeGeminiError</Code> (<Code>src/utils/geminiError.ts</Code>) branches early
            for <Code>lmstudio</Code> — the hosted advice about quotas, API keys, and internet
            connectivity is all wrong for a local server, so it maps to local guidance instead
            (start the server / load the model / try a smaller model / raise the context length).
          </P>
        </section>

        <section id="doc-agent">
          <H2>Warroom Agent (AI)</H2>
          <P>
            The Warroom Agent is an AI assistant (Warroom AI) that lives in a resizable right-side
            panel (<Code>GeminiPanel</Code>). It supports multi-turn conversation and tool calls.
          </P>
          <P>
            <PromptLink name="agent_system">View/edit the agent's system prompt →</PromptLink>
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
          <H3>Quote-reply</H3>
          <P>
            Hover any message — yours or Warroom AI's — for a Reply button. It quotes that message
            above your next one and passes the quoted text to the model as context on that turn only
            (it doesn't alter the displayed message or get repeated on later turns). Editing or
            retrying a message that was itself a reply preserves its quote. Click a quoted snippet to
            scroll back to the original message.
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
            <LI><Code>get_skill</Code> / <Code>write_skill</Code> — load or save a skill <Code>.md</Code> file.
              <Code>write_skill</Code> always asks first: a card appears above the composer showing the skill
              name and the exact text to be saved, and the AI waits until you approve or decline. It is the
              only tool that pauses for permission, because a saved skill is loaded into Warroom AI's context
              in <em>future</em> chats — and tools like <Code>fetch_article</Code> pull in web pages the AI
              reads but you may not have. Without the prompt, a page could talk the AI into writing itself
              instructions that persist after the conversation ends. Declining tells the AI not to retry.</LI>
            <LI><Code>search_tabroom_tournament</Code> · <Code>get_tournament_details</Code> · <Code>save_tournament_to_app</Code> · <Code>search_judge</Code> — Tabroom lookups. <Code>search_judge</Code> caches the paradigm to the judge record (creating one if it doesn't exist yet), so repeat lookups of the same judge are instant unless <Code>refresh</Code> is passed.</LI>
            <LI><Code>scout_opponent</Code> — pulls an opponent's disclosed rounds/cites from OpenCaselist (if linked) and calls the same AI scouting pipeline as the opponent profile's "AI Scout" card, returning an AFF/NEG summary with citations. Caches the result to <Code>disclosures.aiScout</Code> so repeat asks are instant unless <Code>refresh</Code> is passed.</LI>
            <LI><Code>navigate_app</Code> — opens any view for the user (top-level, or a case/block/opponent/tournament/flow resolved by name)</LI>
            <LI><Code>list_flows</Code> / <Code>read_flow</Code> / <Code>edit_flow_cell</Code> — list flows, read a flow's columns + cells, and write individual cells. Edits write to <Code>flow_data_&lt;id&gt;</Code> and fire a <Code>warroom-flow-updated</Code> event so an open flow reloads live.</LI>
            <LI><Code>rename_chat</Code> — renames the current chat's title. Off by default (Settings → "Let Warroom AI rename chats") — the tool isn't even offered to the model unless enabled, filtered server-side in <Code>chat:geminiAgentTurn</Code> before the request goes out. The prompt instructs conservative use (genuine topic shift only, never on the first exchange). Blocked entirely once the user manually renames the chat — a <Code>titleSetByUser</Code> flag on the conversation locks the title against any further automatic renames.</LI>
          </UL>
          <P>
            The agent runs a minimum of 3 searches per evidence request using varied query terms. Saved cards always use the complete verbatim card body — never a summary. The save handler validates the body is non-empty before writing to the DB.
          </P>
          <P>
            Click any completed tool-call step (search, skill load, nav/flow action, or save) to expand a transparency panel showing exactly what args were sent and what the tool returned — useful for debugging why the agent did something. Collapsed by default; click again to close.
          </P>
          <H3>Streaming</H3>
          <P>
            Text responses stream in token-by-token across every provider (Gemini, OpenAI, Anthropic, Grok, LM Studio) — <Code>chat:geminiAgentTurn</Code> in <Code>electron/main.ts</Code> parses each provider's own SSE format and forwards deltas to the renderer over a <Code>chat:agentStreamChunk</Code> event scoped by a per-turn <Code>requestId</Code>, while still accumulating the full response server-side for tool-call detection and title extraction (unchanged from the pre-streaming contract). Gemini specifically has a known API quirk — <Code>MALFORMED_FUNCTION_CALL</Code> — where streamed tool-calling occasionally breaks down mid-response; when that happens the handler transparently retries that turn once on the non-streaming endpoint before giving up.
          </P>
          <H3>Chat sessions</H3>
          <P>
            Each conversation has an auto-generated title (generated by Warroom AI after the first
            exchange). Sessions are stored locally. The active session ID is tracked in Zustand
            as <Code>geminiActiveId</Code>. Click a chat's title in the panel header to rename it
            manually — this sets <Code>titleSetByUser</Code> on the conversation, which permanently
            locks it against the first-exchange auto-title and the <Code>rename_chat</Code> tool alike.
          </P>
          <H3>Retrying on errors</H3>
          <P>
            Every AI request Warroom makes — whether to Gemini, OpenAI, Anthropic, or Grok — automatically
            retries up to twice if it hits a rate limit or a momentary server hiccup, with a short
            increasing delay between tries. A bad API key or malformed request won't retry (it can't
            succeed on a second try), but a busy or momentarily overloaded provider usually will.
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
            <LI>Channel messages and direct messages (DMs) between team members, plus group DMs</LI>
            <LI>Message editing and deletion</LI>
            <LI>Quote-reply: hover any message for a Reply button that quotes it above your next message (not a thread — a snapshot of sender name + content, so it stays intact even if the original is later edited or deleted). Clicking a quoted snippet scrolls to the original if still loaded.</LI>
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
          <H3>Composer: send/dictate button, optimistic send, autogrow</H3>
          <P>
            <Code>SendDictateButton.tsx</Code> is one icon-only button shared by team chat, DMs,
            and Warroom AI: a dictation mic when the box is empty, swapping to a send icon once
            there's content. <Code>variant="solid"</Code> (chat) uses <Code>var(--item-selected-bg)</Code>;{' '}
            <Code>variant="gradient"</Code> (Warroom AI) uses the same blue→pink gradient as{' '}
            <Code>.ai-glow-ring</Code> plus a small spark badge. <Code>useAutoGrowTextarea.ts</Code>{' '}
            grows the composer up to 1/3 of the chat panel's own height (measured via a{' '}
            <Code>panelRef</Code> on the root container, not the window), then scrolls internally.
          </P>
          <P>
            Sending a message is optimistic: <Code>sendMessage()</Code>/<Code>send()</Code> push a
            client-generated <Code>tmp-*</Code> id into the message list and clear the composer{' '}
            <em>before</em> the network call resolves. On success the placeholder is dropped and
            the authoritative row arrives via the same realtime subscription that delivers other
            members' messages (it fires for the sender's own inserts too). On failure the
            placeholder is removed and the composer text/attachments/reply are restored, with the
            real error shown inline.
          </P>
          <H3>Dictation</H3>
          <P>
            All three composers call one shared helper, <Code>transcribeRecording()</Code> in{' '}
            <Code>src/utils/dictation.ts</Code>, instead of each duplicating the record/encode/invoke
            logic. It routes by provider: <strong>Gemini</strong> sends the recorded audio inline as
            before; <strong>OpenAI</strong> uploads it as a file to the Whisper transcription endpoint
            (<Code>callOpenAIWhisper()</Code>, multipart/form-data — the one call site in the app
            shaped that way); <strong>Anthropic/Grok</strong> have no transcription API at all, so they
            get a clear error naming the providers that do plus the offline option, rather than a
            confusing "no Gemini key" message.
          </P>
          <P>
            <strong>Offline dictation (Beta)</strong> — Settings → General → "Offline dictation model"
            downloads a small local Whisper model (<Code>electron/offlineWhisper.ts</Code>, via{' '}
            <Code>@huggingface/transformers</Code>, ~75MB, cached under{' '}
            <Code>&lt;userData&gt;/warroom/offline-models</Code>) that transcribes entirely on-device —
            no key, no network, independent of which AI provider is selected. It's slower and less
            accurate than a hosted model, hence Beta. The renderer does the audio decoding (Web Audio
            API's <Code>decodeAudioData</Code> + an <Code>OfflineAudioContext</Code> sized to resample
            to 16kHz mono in one pass) before sending raw PCM over IPC, since MediaRecorder only
            produces compressed webm/opus and the main process has no codec of its own.
          </P>
          <P>
            <strong>Silent fallback</strong> — once the offline model is downloaded, it's also used
            automatically if a Gemini/OpenAI dictation call fails for any reason (bad key, rate limit,
            network error), even while the "use offline" toggle itself is off. The PCM decode only
            happens on that retry, not on every call, since the cloud path succeeds the vast majority
            of the time. This never triggers a download on its own, and there's no UI signal either
            way — consistent with every other dictation failure being swallowed silently rather than
            interrupting the composer.
          </P>
          <H3>Avatars</H3>
          <P>
            <Code>Avatar.tsx</Code> is the shared identity icon for a team room, DM, or group DM,
            used in the all-chats list, Quick Chat, and the pin picker. Team room = rounded square,{' '}
            <Code>var(--accent)</Code> background, team initials. DM = circle, background from{' '}
            <Code>paletteColorFor(userId)</Code> (a small hash over a fixed 6-color palette chosen
            to read on every theme), person's initials. Group DM = circle split into a 2×2 grid,
            one initial per each of the first 4 members in <Code>channel.members</Code> order.
          </P>
          <H3>Team Files</H3>
          <P>
            Team rooms (not DMs — DMs stay chat-only) have a per-team file library, <Code>TeamFiles.tsx</Code>,
            backed by the <Code>team_files</Code> table, kept separate from the message stream.
            Reached via a Chat/Files toggle bar under the room header by default, or a single Files
            icon in the header if Settings → Chat → "Team files display" is set to icon mode (
            <Code>getFilesBarStyle()</Code>/<Code>setFilesBarStyle()</Code> in <Code>chatPrefs.ts</Code>,
            localStorage key <Code>warroom-files-bar-style</Code>). A speech-doc attachment sent
            directly in a team-room chat message (not just via "+ Add file") auto-forwards into{' '}
            <Code>team_files</Code> too, reusing <Code>teamFiles.upload</Code> — see{' '}
            <Code>forwardSpeechdocToTeamFiles()</Code> in Chat.tsx, fired from{' '}
            <Code>sendMessage()</Code> after a successful send, skipped for oversized/summarized
            attachments (nothing to forward).
          </P>
          <P>
            Each row stores <Code>name</Code> and <Code>data_b64</Code> (the raw file
            bytes, base64) encrypted client-side with the team key exactly like message content;
            <Code>uploader_name</Code> stays plaintext, the same tier as a message's sender name.
            The list shows file name, "Modified &lt;relative time&gt;", and uploader. Opening a
            file decrypts <Code>data_b64</Code>, writes it to a temp file via <Code>fs.writeTempFile</Code>,
            and opens it in the Speech Doc Viewer.
          </P>
          <P>
            <strong>Remove vs. delete:</strong> the trash icon (uploader only) calls{' '}
            <Code>chat:removeTeamFileContent</Code>, which clears <Code>data_b64</Code> and sets{' '}
            <Code>removed = true</Code> but keeps the row — name, uploader, and dates stay visible
            as a record. This is distinct from <Code>chat:deleteTeamFile</Code> (a full row delete,
            RLS-scoped to the uploader), which the UI no longer calls but which still exists.
          </P>
          <P>
            <strong>Auto-update</strong> works by having the uploader's own device watch the local
            file on disk with Node's <Code>fs.watch</Code> (electron/main.ts), debounced 1.2s to
            absorb multiple change events per save. On a debounced change, main.ts sends the raw
            (unencrypted, IPC-only) bytes to the renderer via <Code>chat:localTeamFileChanged</Code> —
            encryption must happen in the renderer since <Code>chatCrypto.ts</Code> uses the Web
            Crypto API, not available the same way in the main process. An effect in the top-level{' '}
            <Code>Chat()</Code> component (always mounted, per App.tsx, so it works even when the
            Files panel is closed) re-encrypts and calls <Code>chat:updateTeamFileContent</Code>,
            bumping <Code>updated_at</Code>. Every other team member's client is subscribed to
            Postgres changes on <Code>team_files</Code> (same realtime pattern as chat messages)
            and sees the row update live.
          </P>
          <P>
            The mapping of file id → local path is persisted device-side only, in{' '}
            <Code>team_file_watches.json</Code> — it never syncs anywhere, since it's only
            meaningful on the machine that uploaded each file. Watches are restored from that file
            at every app launch (<Code>restoreTeamFileWatches</Code>), so auto-update survives a
            restart without re-uploading. This means auto-update only works while the uploader's
            own Warroom app is running — teammates just see <Code>updated_at</Code> move and
            re-open the file for the latest version.
          </P>
          <P>
            <strong>"+ Add file" only sources from the app's own library</strong> — a two-step
            picker ("From your speech docs" / "From your flows"), no raw OS file dialog. Speech
            docs use the mechanism above unchanged (a real path on disk, <Code>fs.watch</Code>).
            Flows have no file on disk, so they get a parallel, simpler mechanism: adding one
            calls <Code>flowDataToXlsxBase64()</Code> (<Code>utils/flowImport.ts</Code> — a pure
            serializer shared with <Code>FlowView.tsx</Code>'s own xlsx export, so the two can't
            drift) to build the initial upload, then registers a <Code>fileId → flowId</Code> watch
            in <Code>team_file_flow_watches.json</Code> (same shape/restore story as the docx map,
            different file) via <Code>chat:watchFlowTeamFile</Code>. There's no <Code>fs.watch</Code>{' '}
            for a flow — instead, <Code>FlowView.tsx</Code>'s <Code>persist()</Code> (its autosave)
            calls <Code>pushToWatchedTeamFile()</Code> after every save, debounced 1.5s: it asks
            main.ts (<Code>chat:getWatchedFileIdForFlow</Code>) whether this flow has a linked Team
            File, and if so, serializes + encrypts + calls <Code>chat:updateTeamFileContent</Code>{' '}
            directly from the renderer — no IPC round-trip to read bytes off disk needed, since the
            flow's data is already in memory where it saved. <Code>chat:isWatchingTeamFile</Code>{' '}
            checks both watch maps, so the 🔄 indicator works the same for either source.
          </P>
          <H3>Oversized attachments (2MB cap) and AI summarization</H3>
          <P>
            <Code>fileSizeGate.ts</Code> defines <Code>MAX_ATTACHMENT_BYTES</Code> (2MB). The
            chat composer's speechdoc/flow mention-attach (Chat.tsx <Code>handleMentionSelect</Code>)
            and Team Files' speech-doc source (<Code>TeamFiles.tsx</Code> <Code>addFromSpeechDoc</Code>)
            measure the source before sending, and show <Code>OversizedFilePopup.tsx</Code> when
            it's over the cap. "Send name only" attaches/uploads a placeholder (
            <Code>{'{ oversized: true, sizeBytes }'}</Code> for chat, empty <Code>data_b64</Code>{' '}
            for Team Files) with no real content, permanently — there is no later "upgrade to full
            content" path. "Summarize with Warroom AI" calls the new{' '}
            <Code>speechdoc:summarizeForAttachment</Code> IPC handler with the already-extracted
            doc text (chat/Team Files both call <Code>speechdoc:extract</Code> client-side first,
            so the handler never re-parses the docx itself) and the <Code>cx_debate</Code> skill
            injected into the prompt, wrapped in <Code>withDelayedRetry</Code> per the AI-retry
            convention. The result is stored as <Code>{'{ summarized: true, summary }'}</Code> on a
            chat attachment, or in <Code>team_files.summary_text</Code> (a new nullable column,
            encrypted like <Code>name</Code>/<Code>data_b64</Code>) for a Team Files upload.
            Wherever the attachment is later opened — <Code>ChatMessage.tsx</Code>'s{' '}
            <Code>AttachmentChip</Code>, or <Code>TeamFiles.tsx</Code>'s row — it shows the summary
            (or a "too large, name only" notice) instead of trying to open real content that was
            never sent.
          </P>
          <H3>Quick Chat</H3>
          <P>
            Off by default (<Code>chatPrefs.ts</Code>: <Code>isQuickChatEnabled()</Code>/
            <Code>setQuickChatEnabled()</Code>, localStorage <Code>warroom-quick-chat-enabled</Code>).
            Settings → Chat → "Quick chat" opens <Code>QuickChatPicker.tsx</Code>, which lets the
            user pin the team room and/or any DM/group DM (<Code>warroom-quick-chat-pins</Code>,
            a <Code>QuickChatPin[]</Code>) and optionally assign each pin a keyboard shortcut,
            stored separately in <Code>warroom-quick-chat-bindings</Code> (keyed by{' '}
            <Code>quickchat-&lt;pinId&gt;</Code>, reusing <Code>shortcutPrefs.ts</Code>'s{' '}
            <Code>KeyBinding</Code> shape but not its registry, since pins are dynamic/user-defined
            rather than a fixed app shortcut list). <Code>findQuickChatConflict()</Code> checks a
            candidate binding against every core app shortcut (<Code>DEFAULT_BINDINGS</Code>) and
            every other pin before allowing it — a clash surfaces a rebind-in-place prompt (see the
            CLAUDE.md rule "Keyboard shortcuts must not conflict"), resolvable fully inline when
            both sides are pins, or by opening the full Shortcuts overlay when the clash is with a
            core app shortcut. Pinned icons render in <Code>TitleBar.tsx</Code>'s{' '}
            <Code>QuickChatBar</Code>, just left of the main chat icon; clicking one (or firing its
            shortcut) sets <Code>appStore</Code>'s <Code>pendingChatTarget</Code>, which the
            always-mounted <Code>Chat()</Code> component consumes to jump to that room/DM.
          </P>
          <H3>Pinned messages</H3>
          <P>
            A shared pin board per team room or per DM/group DM, backed by the{' '}
            <Code>pinned_messages</Code> table — exactly one of <Code>team_id</Code>/
            <Code>dm_channel_id</Code> is set. Pinning snapshots <Code>sender_name</Code>/
            <Code>content</Code> (encrypted client-side, same convention as a reply-to quote) so a
            pin survives the original message being edited or deleted; <Code>message_id</Code> is
            kept as a soft link purely for "Jump to message". Reached via a "Pins" tab — a 3-way
            Chat/Files/Pins bar in team rooms (or a Pins icon alongside Files in icon mode), and an
            always-shown 2-way Chat/Pins bar in DMs (DMs ignore the files-bar-style setting since
            they have no Files tab to make a tradeoff against). The pin/unpin toggle lives in each
            message's hover-action row (<Code>PinIcon</Code> in ChatMessage.tsx). Any team/DM member
            can unpin, not just whoever pinned it — a shared board, not a personal one. Realtime
            subscriptions are keyed per scope in a <Code>Map</Code> (<Code>pinsChannels</Code> in
            main.ts) rather than one shared channel variable, since the message list (for the
            pin-icon highlight) and the Pins tab can both be subscribed at once.
          </P>
          <H3>Per-chat desktop notifications</H3>
          <P>
            Each chat (team room = <Code>'team'</Code>, or a dm_channel_id) has an independent
            notification level — All messages / Mentions &amp; replies only / Nothing — set in
            Room/DM Settings (<Code>NotifLevelPicker.tsx</Code>) and stored in localStorage (
            <Code>warroom-chat-notif-levels</Code>, <Code>chatPrefs.ts</Code>). Team-room
            notifications fire from <Code>ChatBody</Code>'s existing always-mounted subscription
            (the background instance that also drives the unread badge). DMs need a separate{' '}
            <Code>chat:subscribeAllDMs</Code> IPC subscription (no column filter — RLS still scopes
            it to the user's own channels) since the per-open-DM subscription only exists while that
            DM is actually open. "Mentions &amp; replies" is decided by{' '}
            <Code>messageMentionsOrReplies()</Code>: the decrypted content contains{' '}
            <Code>@Display_Name</Code>, or the message directly replies to one the user sent
            (checked via <Code>reply_to_sender_name</Code>, not a full thread trace). The renderer
            decides whether to notify (it's the only side with the decrypted content) and calls{' '}
            <Code>chat:showNotification</Code> just to display it — deliberately separate from the
            daemon's category-toggle system (pairings/results/etc.), which gates a different,
            background-polling notification path.
          </P>
          <H3>Presence: online status and typing</H3>
          <P>
            One Supabase presence channel per team (<Code>presence-&lt;teamId&gt;</Code>) covers
            both online status for every member and typing state for the team room and every DM —
            each client tracks <Code>{'{ userId, displayName, typing }'}</Code>, where{' '}
            <Code>typing</Code> is a scope key (<Code>'team'</Code> or a dm_channel_id) or{' '}
            <Code>null</Code>. No message content ever crosses this channel. Deliberately lighter
            weight than the live-flow channel's private+RLS setup — presence here only reveals
            "so-and-so is online/typing", so an unauthenticated but team-scoped channel name is a
            proportionate tradeoff. <Code>useTypingTracker(scopeKey)</Code> (Chat.tsx) re-tracks on
            each composer keystroke and clears itself after 2.5s idle. Raw presence state lives in{' '}
            <Code>appStore</Code>'s <Code>presenceState</Code> (not chat-local) so any component —
            the all-chats list, a message composer — can read it via <Code>chatPrefs.ts</Code>'s{' '}
            <Code>presenceList()</Code>/<Code>isUserOnline()</Code>/<Code>typingDisplayNamesFor()</Code>{' '}
            without prop drilling. <Code>ChatAvatar</Code>'s optional <Code>online</Code> prop draws
            the status dot; currently wired up in the all-chats DM list (1:1 DMs only — a group DM's
            avatar has no single online state to show).
          </P>
          <H3>Instant-open message cache</H3>
          <P>
            <Code>chatCache.ts</Code> keeps the last 50 decrypted messages for each of the last 5
            chats the user opened (team room and/or DMs, LRU by <Code>lastOpened</Code>) in local
            userData JSON (<Code>chat_cache_&lt;chatId&gt;</Code> + a <Code>chat_cache_index</Code>{' '}
            of which chats are cached), via the existing generic <Code>storage:read</Code>/
            <Code>storage:write</Code> IPC. <Code>loadMessages()</Code> in both{' '}
            <Code>ChatBody</Code> and <Code>DMBody</Code> renders the cached list immediately (no
            "Loading messages…" flash for a recently-visited chat) while the real Supabase fetch
            runs in the background and then fully replaces it — the cache is a "show something now,
            reconcile shortly after" layer, never a source of truth, so a stale cached edit/delete
            self-heals within one fetch. The realtime message handlers also update the cache
            incrementally so a quick reopen has the very latest message too. Evicting a chat past
            the 5-chat cap clears its cache file. Stores plaintext (already-decrypted) content, same
            trust tier as every other local userData file — not new exposure since the Supabase
            copy was already reachable by anyone with device access via the app itself.
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
          <P>
            The left outline nav (<Code>SettingsOutline</Code> in <Code>Settings.tsx</Code>) has a
            filter box above the section list — it matches each section's label plus that section's
            actual rendered text (<Code>textContent</Code>), so it's a genuine full-text search over
            whatever's really on the page rather than a hand-maintained keyword list that would drift
            out of sync. A <Code>MutationObserver</Code> on the settings column keeps that search fresh
            as toggles fire and values load in — though a collapsed section's hidden content (like the
            LM Studio Advanced panel while closed) isn't searchable until it's actually open, since it
            isn't in the DOM yet. A handful of sections with genuinely resettable state (Appearance,
            Speech docs & cases, General, Flow, Auto Flow style) show a small "Reset to defaults" link
            once anything in that section differs from its default — sections without a real single
            "default" (API keys, credentials, the debate event picker) don't get one.
          </P>
          <Card>
            <div className="space-y-2.5 text-sm">
              <div>
                <span className="font-semibold text-ink">Debate event</span>
                <span className="ml-2 text-ink/60">HS Policy · HS LD · HS PF · College Policy (NDT/CEDA) · College LD (NFA-LD)</span>
              </div>
              <div>
                <span className="font-semibold text-ink">General — card staleness</span>
                <span className="ml-2 text-ink/60">
                  Years before a card is flagged outdated (default 4). Renderer-only store field
                  (<Code>cardOutdatedYears</Code> in <Code>appStore.ts</Code>), read everywhere a card's age
                  is displayed or set — Library, BlockView, CaseView, MissionBrief, CardCutter, ImportCards,
                  and the Agent's own card-save path.
                </span>
              </div>
              <div>
                <span className="font-semibold text-ink">General — reduce motion</span>
                <span className="ml-2 text-ink/60">
                  Toggles the <Code>reduce-motion</Code> class on <Code>&lt;html&gt;</Code> (see <Code>index.css</Code>),
                  which zeroes transition/animation durations app-wide. The OS-level <Code>prefers-reduced-motion</Code>{' '}
                  media query does the same independent of this toggle.
                </span>
              </div>
              <div>
                <span className="font-semibold text-ink">General — skip delete confirmations</span>
                <span className="ml-2 text-ink/60">
                  Suppresses the <Code>confirm()</Code> prompt on case/block/tournament/round/impact-library
                  deletes. Safe to enable now that all of those show an Undo toast (see the Undo section above)
                  — deleting is never actually final either way.
                </span>
              </div>
              <div>
                <span className="font-semibold text-ink">General — background notifications</span>
                <span className="ml-2 text-ink/60">
                  Five independent toggles (new pairings, round results, new topics, judge paradigm updates,
                  opponent disclosures) gating <Code>fireNotif()</Code> in <Code>electron/main.ts</Code> by
                  category. Stored as <Code>notifyPairings</Code>/<Code>notifyResults</Code>/<Code>notifyTopics</Code>/
                  <Code>notifyJudges</Code>/<Code>notifyOpponents</Code> in <Code>app_settings</Code> — main-process
                  state, not localStorage, since the headless daemon fires these too and reads the same file. All
                  default on; only an explicit <Code>false</Code> turns one off.
                </span>
              </div>
              <div>
                <span className="font-semibold text-ink">General — current-year short cite</span>
                <span className="ml-2 text-ink/60">
                  Whether the Card Cutter's AI "read source" step writes a current-year source's short
                  cite as month-day (<Code>Brady 3-15</Code>, the default) or two-digit year
                  (<Code>Brady 26</Code>, same style as past years). Stored as <Code>citeYearFormat</Code>{' '}
                  ('month-day' | 'year') in <Code>app_settings</Code> — main-process state, since{' '}
                  <Code>citeYearRuleText()</Code> in <Code>main.ts</Code> reads it to build the{' '}
                  <Code>{'{{CITE_YEAR_RULE}}'}</Code> line of the <Code>cutter_read_source</Code> prompt.
                  Past-year sources are unaffected either way.
                </span>
              </div>
              <div>
                <span className="font-semibold text-ink">General — timer warning threshold</span>
                <span className="ml-2 text-ink/60">
                  Seconds remaining when the top-bar speech timer turns amber (default 30). Stored as{' '}
                  <Code>timerWarningSecs</Code> in <Code>appStore.ts</Code> (localStorage{' '}
                  <Code>warroom-timer-warning-secs</Code>), same renderer-only pattern as{' '}
                  <Code>cardOutdatedYears</Code>. The red "overtime" state at 0:00 is fixed, not configurable.
                </span>
              </div>
              <div>
                <span className="font-semibold text-ink">General — offline dictation model</span>
                <span className="ml-2 text-ink/60">
                  Downloads a small local Whisper model for dictation with no API key or internet —
                  Beta. Stored as <Code>dictationUseOffline</Code>/<Code>dictationOfflineModelReady</Code> in{' '}
                  <Code>app_settings</Code>. See the Team Chat section's "Dictation" entry for the full mechanism.
                </span>
              </div>
              <div>
                <span className="font-semibold text-ink">AI provider</span>
                <span className="ml-2 text-ink/60">Gemini (default) · OpenAI · Anthropic · Grok · LM Studio (local). Persisted as <Code>apiProvider</Code>.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Gemini API key</span>
                <span className="ml-2 text-ink/60">Stored encrypted. Powers card extraction, block suggestions, and Warroom AI.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">LM Studio</span>
                <span className="ml-2 text-ink/60">Server URL, model id, and Loaded models. An Advanced section (closed by default) holds request options (JSON), the tool-calling toggle, and a per-tier model override. No API key — see the LM Studio section.</span>
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
                <span className="font-semibold text-ink">Flow</span>
                <span className="ml-2 text-ink/60">Column colors, new-flow defaults, and live editor behavior — one card, see below.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Speech docs & cases</span>
                <span className="ml-2 text-ink/60">Dedicated settings block for the doc viewer — see below.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Setup wizard</span>
                <span className="ml-2 text-ink/60">Re-runs the onboarding flow.</span>
              </div>
            </div>
          </Card>
          <H3>Flow</H3>
          <P>
            One card covering everything about how flows work by default — column colors, defaults
            for a brand-new flow, and live editor behavior. None of this touches a flow you've
            already opened — those keep whatever they were last saved at. A single{' '}
            <strong>Reset to defaults</strong> at the bottom resets all of it, colors included.
          </P>
          <Card>
            <div className="space-y-2.5 text-sm">
              <div>
                <span className="font-semibold text-ink">Column colors</span>
                <span className="ml-2 text-ink/60">Default Aff/Pro and Neg/Con column colors applied to all flows.</span>
              </div>
            </div>
          </Card>
          <P>
            <strong>New-flow defaults</strong> — only affect the plain <Code>+</Code> new-flow
            button. Auto Flow always guesses its own layout, speech order, etc. from the doc, per
            flow.
          </P>
          <Card>
            <div className="space-y-2.5 text-sm">
              <div>
                <span className="font-semibold text-ink">Default layout for a new policy flow</span>
                <span className="ml-2 text-ink/60">Stock issues or Advantage.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Default speech order for a new PF flow</span>
                <span className="ml-2 text-ink/60">Pro first or Con first.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Default zoom</span>
                <span className="ml-2 text-ink/60">50–150%, the zoom a brand-new flow opens at.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Default text size</span>
                <span className="ml-2 text-ink/60">10–20px, the cell text size a brand-new flow opens at.</span>
              </div>
            </div>
          </Card>
          <P><strong>Editor behavior</strong> — live, applies to any open flow.</P>
          <Card>
            <div className="space-y-2.5 text-sm">
              <div>
                <span className="font-semibold text-ink">Auto-fit columns to window</span>
                <span className="ml-2 text-ink/60">On by default — columns continuously stretch/shrink to fill the
                  window as you resize it, collapse the sidebar, or open the AI chat panel. Turn it off to set zoom
                  yourself and have it stay put.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">AI tab summaries on hover</span>
                <span className="ml-2 text-ink/60">On by default. Turn it off and hovering a tab never calls Warroom
                  AI — tabs only ever show the free local tag preview.</span>
              </div>
            </div>
          </Card>
          <H3>Speech docs & cases</H3>
          <P>
            A dedicated settings block for the speech doc viewer, all renderer-only (
            <Code>localStorage</Code>, no IPC) and applied live where possible:
          </P>
          <Card>
            <div className="space-y-2.5 text-sm">
              <div>
                <span className="font-semibold text-ink">Keep speech docs light</span>
                <span className="ml-2 text-ink/60">Dark mode only. On by default — the doc page itself stays light like paper while the rest of the app stays dark.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Speech doc margins</span>
                <span className="ml-2 text-ink/60">0–100% (default 50%) of the doc's real Word page margins to keep. Lower gives the text more width. Rescales an already-open doc live.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Speech doc text size</span>
                <span className="ml-2 text-ink/60">80–150% (default 100%) zoom on the whole rendered page — text, cards, everything. Applies live.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Always open the outline</span>
                <span className="ml-2 text-ink/60">Off by default (never auto-opens). On shows it for every doc opened.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Start docs in Focus mode</span>
                <span className="ml-2 text-ink/60">Off by default. On hides body text and shows only card structure as soon as any doc opens.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Outline layout in compare view</span>
                <span className="ml-2 text-ink/60">Dedicated space (default) or Squish neighbor — see "Outline layout in compare view" above.</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Adaptive reading pace</span>
                <span className="ml-2 text-ink/60">On by default. Auto-scroll varies speed with local spoken-content density instead of one flat rate — see "Reading time & auto-scroll" above.</span>
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
            All team-chat and DM content is encrypted client-side before it leaves your computer.
            Message text and every shared attachment (cases, blocks, flows, opponents, tournaments,
            speech docs) are encrypted with <Code>AES-256-GCM</Code>; the cloud database only ever
            stores ciphertext. Each team has one symmetric key, derived from the team's
            <Code>key_seed</Code> via <Code>PBKDF2</Code> (200k iterations, salted with the team id).
            The seed is a server-generated random value every member receives, so everyone derives
            the identical key with no key exchange, and the derived key itself is never transmitted.
            It is deliberately <em>not</em> the invite code — see "Resetting the invite code" below.
            Team Files uses the same key and
            mechanism for uploaded file names and content. Sender name, timestamps, attachment
            labels, and file uploader names stay readable for display; only the actual content
            (message text, attachment data, file bytes) is encrypted. Warroom AI does not read
            team-chat history, so no plaintext is ever sent to the AI provider.
          </P>
          <P>
            <strong>What this does and doesn't protect.</strong> This is <em>not</em> end-to-end /
            zero-knowledge encryption. The key is derived from a seed that is itself stored
            server-side. So it strongly protects your content if only the message rows leak — an
            over-broad database read or a partial dump that excludes the teams table yields nothing
            but ciphertext — but it does <em>not</em> protect against a full database compromise or a
            malicious operator, who could re-derive the key from the stored seed. Treat it as strong
            defense-in-depth over the database's access controls, not as a guarantee that the
            operator can never read your messages.
          </P>
          <H3>Resetting the invite code</H3>
          <P>
            The chat key used to be derived from the invite code itself, which meant the code could
            never be changed — rotating it would have made every existing message unreadable. That
            left an invite code permanently equivalent to the team's encryption key, so a code
            pasted into a group chat or shared with someone who later left the team could never be
            taken back. The KDF input is now a separate <Code>key_seed</Code>, so a team owner can
            hit <strong>Reset invite code</strong> in Room settings to issue a fresh code: the old
            one immediately stops working for new joins, while current members and the entire
            message history are unaffected. Existing teams were migrated with their seed set to
            their then-current invite code, so nothing sent before the change became unreadable.
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
          <H3>Rate limiting</H3>
          <P>
            Sign-in, sign-up, and password reset are throttled in the app itself (per-email, e.g.
            password reset is capped at 3 requests/hour) to stop a bug or misuse of the app's own UI
            from hammering auth. Since the Supabase anon key ships inside every installer, that app-side
            throttle alone can't stop someone who extracts the key and calls Supabase directly — so
            team/DM messages and Impact Library writes (submissions, edits, votes) are additionally
            rate-limited inside Postgres itself via triggers, which enforce regardless of how the
            request arrives. Looking up a user by email is capped at 30/hour so it can't be used to
            enumerate which addresses have accounts.
          </P>
          <P>
            The function those triggers call, <Code>enforce_rate_limit</Code>, is no longer callable
            on its own. Every function in the database's public schema is automatically exposed as an
            API endpoint, and this one accepted the action, cap, and time window as arguments — so a
            signed-in user could invoke it directly with a zero-length window, which made its own
            cleanup step delete their recorded events and reset the counter, defeating all of the
            limits above. Permission to call it directly has been revoked; the triggers still can,
            because they run as the database owner.
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
            Single global store (<Code>useApp</Code>) holds: DB state, current view, theme,
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
          <H3>AI call retries</H3>
          <P>
            AI calls you <em>can't</em> retry yourself — the handful with no button of their own
            (flow-tab summary tooltips, cross-ex trap generation, chat-session naming) — retry
            automatically before giving up: if a model call fails, it's
            retried after <strong>8 seconds</strong>, then <strong>30 seconds</strong>, then{' '}
            <strong>60 seconds</strong> — 4 attempts total — before the error is surfaced. A small
            toast then appears at the bottom of the screen with the{' '}
            <strong>exact error the AI provider returned</strong> — not a simplified summary — so you
            can see precisely what happened (a rate limit, a rejected key, an overloaded server), in
            addition to whatever that feature already shows inline.
          </P>
          <P>
            Calls that <em>do</em> put a retry in front of you deliberately skip the backoff. That's
            almost everything — Auto Flow, Round Analysis, the card cutter, cross-ex, card scoring,
            scouting, Mission Brief, Impact Calc, the Outweigh game, the Impact Library, flow import
            — because each one either returns you to the step you launched from or shows its error
            right next to the button you pressed. Waiting ~100 seconds in silence before showing an
            error you could fix in one click is worse than failing fast. Only three background jobs
            you never see still retry quietly: flow-tab summaries, cross-ex trap generation, and
            naming a chat session.
          </P>
          <P>
            The same reasoning excludes the <strong>Warroom AI chat/agent panel</strong> — a chat
            turn can trigger real actions (saving a card, opening a panel), and resending the message
            is an obvious retry of your own, so it isn't blindly retried either.
          </P>
          <H3>When something is too long</H3>
          <P>
            <strong>Settings → Work past the length limit</strong> decides what happens when input
            exceeds what Warroom AI can read at once. <strong>Off</strong> (default) trims and asks
            first. <strong>On</strong> picks between two methods, and the point of offering a choice
            is that neither is strictly better:
          </P>
          <UL>
            <LI>
              <strong>Even sampling</strong> — a fair share of every sheet instead of all of the
              first few, with Warroom AI told how many cards it can't see on each one (so it reports
              "I can't tell here" rather than wrongly calling something dropped). Real text, but
              never the whole round.
            </LI>
            <LI>
              <strong>Read everything in passes</strong> — the round is read across several passes
              and analyzed from those readings. Full coverage, but the final answer works from notes
              rather than your flow, so fine detail can smooth away. Costs several calls.
            </LI>
          </UL>
          <P>
            Above the model's real capacity nothing is sent at all — the request is refused with the
            actual token numbers. That's a model limit, so no setting bypasses it. Warroom{' '}
            <em>asks your provider</em> what the limit is rather than assuming one, so switching to a
            model with a larger context window raises the ceiling immediately. Where a provider
            doesn't publish its limits, Warroom doesn't guess — it sends the request and shows you
            the provider's own error, which is always right and always current.
          </P>
          <H3>An empty answer is never dressed up as a real one</H3>
          <P>
            Several features used to turn "the AI didn't answer" into a plausible-looking result:
            the card cutter produced <em>"Untitled card"</em> with no emphasis, card credibility
            scored unreached cards as <strong>0 / Weak</strong>, and source reading produced a blank
            citation with the current year filled in — all reported as success.
          </P>
          <P>
            Each of those now fails loudly instead. Credibility scoring in particular leaves an
            unscored card <em>out</em> of the list rather than rating it, and tells you how many were
            skipped — a fabricated bottom score is indistinguishable from a real one, which made it
            the most misleading of the set.
          </P>
          <H3>Nothing is truncated silently</H3>
          <P>
            Two things used to be cut off invisibly. If the AI's <strong>answer</strong> ran past its
            length limit, the partial reply looked identical to a complete one — so a request too big
            to answer could end in an empty result with no error at all. That's now detected and
            reported, and where the work can be split (Auto Flow) it's automatically retried in
            smaller batches instead.
          </P>
          <P>
            And if something you give Warroom AI is <strong>too long to send in full</strong>, you're
            asked <em>before</em> anything is sent — a dialog says exactly how much would make it
            ("sending 60,000 of 412,000 characters (15%) of your flow") and lets you{' '}
            <strong>Cancel</strong> or <strong>Send shortened anyway</strong>. Cancelling means no
            call is made and nothing is spent. If one action would shorten several things at once,
            they're listed together in a single dialog rather than asking repeatedly. You'll never
            get a confident answer that was quietly based on a fraction of your document.
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
          <P>
            <PromptLink name="topic_brief" />
          </P>
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

        {/* ── AI Prompts ──────────────────────────────────────────────── */}
        <section id="doc-ai-prompts">
          <H2>AI Prompts</H2>
          <P>
            Every prompt Warroom sends to the AI — card extraction, the card cutter, scouting
            reports, mission briefs, cross-ex questions, card credibility scoring, impact calc, the
            Outweigh game, the Impact Library, flow import, topic briefs, and the Warroom Agent's own
            system prompt — lives in its own plain-text file rather than being hardcoded, the same
            way skills do.
          </P>
          <UL>
            <LI>
              <strong>Bundled defaults</strong> ship in <Code>electron/prompts/</Code> (one{' '}
              <Code>.txt</Code> file per prompt, with <Code>{'{{PLACEHOLDER}}'}</Code> tokens marking
              where dynamic content — document text, names, dates, computed context — gets inserted).
            </LI>
            <LI>
              <strong>Your edits</strong> live at <Code>userData/warroom/prompts/</Code>, seeded from
              the matching bundled file the first time you open it. A user-edited prompt always wins
              over the bundled default of the same name — exactly like skills.
            </LI>
            <LI>
              Every <strong>"View/edit this prompt"</strong> link throughout this page (and in the
              User Manual) opens the editable copy directly in your system's default text editor.
            </LI>
            <LI>
              Edits take effect on the <strong>very next AI call</strong> — no restart or rebuild
              needed.
            </LI>
          </UL>
        </section>

        <div className="h-16" />
      </div>
    </div>
  );
}
