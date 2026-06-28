import React, { useState, useRef, useEffect } from 'react';
import { useApp, FlowMeta } from '../store/appStore';
import gdriveLogo from '../assets/gdrive-logo.png';
import { importFlowFromXlsx } from '../utils/flowImport';

const RECENTS_KEY = 'warroom-speech-doc-recents';
interface RecentDoc { path: string; name: string; cardCount?: number }
function getSpeechDocs(): RecentDoc[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]'); } catch { return []; }
}
function removeFromRecents(path: string) {
  const next = getSpeechDocs().filter(r => r.path !== path);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  window.dispatchEvent(new StorageEvent('storage', { key: RECENTS_KEY, newValue: JSON.stringify(next) }));
}
function renameInRecents(path: string, displayName: string) {
  const next = getSpeechDocs().map(r => r.path === path ? { ...r, name: displayName } : r);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  window.dispatchEvent(new StorageEvent('storage', { key: RECENTS_KEY, newValue: JSON.stringify(next) }));
}

// ── Sidebar widths ────────────────────────────────────────────────────────────
const EXPANDED = 210;
const COLLAPSED = 52;

// ── Collapse state (persisted across sessions) ────────────────────────────────
function useCollapsed(): [boolean, () => void] {
  const [c, setC] = useState(() => {
    try { return localStorage.getItem('warroom-sb-collapsed') === 'true'; } catch { return false; }
  });
  const toggle = () => setC(v => {
    const next = !v;
    try { localStorage.setItem('warroom-sb-collapsed', String(next)); } catch {}
    return next;
  });
  return [c, toggle];
}

// ── Icon system ───────────────────────────────────────────────────────────────
// All: 16×16 viewBox · stroke only · 1.5 weight · round caps + joins

function Ico({ children, size = 20 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      shapeRendering="geometricPrecision"
      style={{ flexShrink: 0, display: 'block' }}>
      {children}
    </svg>
  );
}

// All icons below use a 20×20 viewBox with 1.6px stroke.

export function IcoHome() {
  return (
    <Ico>
      <path d="M3 11L10 3L17 11"/>
      <path d="M5 9.5V17H8.5V13H11.5V17H15V9.5"/>
    </Ico>
  );
}
export function IcoCases() {
  return (
    <Ico>
      <path d="M2 7v9a1 1 0 001 1h14a1 1 0 001-1V9a1 1 0 00-1-1H9.5L7.5 6H3a1 1 0 00-1 1z"/>
    </Ico>
  );
}
export function IcoLibrary() {
  return (
    <Ico>
      <rect x="3.5" y="5" width="11" height="12" rx="1"/>
      <path d="M7 3h8.5a1 1 0 011 1v11"/>
      <path d="M7 9h5M7 12h4"/>
    </Ico>
  );
}
export function IcoSearch() {
  return (
    <Ico>
      <circle cx="8.5" cy="8.5" r="5"/>
      <path d="M12.5 12.5L17 17"/>
    </Ico>
  );
}
export function IcoImport() {
  return (
    <Ico>
      <path d="M10 3v9"/>
      <path d="M6.5 8.5L10 12l3.5-3.5"/>
      <path d="M4 16h12"/>
    </Ico>
  );
}
export function IcoOpponents() {
  // Person (opponent) + gavel head (judge)
  return (
    <Ico>
      {/* person */}
      <circle cx="7" cy="6" r="2.8"/>
      <path d="M1.5 17.5v-1A5.2 5.2 0 016.7 11h.8"/>
      {/* gavel */}
      <rect x="11" y="4" width="6.5" height="3" rx="1" transform="rotate(45 14.25 5.5)"/>
      <line x1="11.5" y1="10.5" x2="16.5" y2="15.5" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="10" y1="16" x2="13" y2="19" strokeWidth="2.8" strokeLinecap="round"/>
    </Ico>
  );
}
export function IcoTournament() {
  return (
    <Ico>
      <path d="M6.5 2.5H13.5V9C13.5 11.5 11.93 13.5 10 13.5S6.5 11.5 6.5 9V2.5Z"/>
      <path d="M6.5 5.5H3.5V7C3.5 8.66 4.84 10 6.5 10"/>
      <path d="M13.5 5.5H16.5V7C16.5 8.66 15.16 10 13.5 10"/>
      <path d="M10 13.5V16"/>
      <path d="M7 16h6"/>
    </Ico>
  );
}
export function IcoFlow() {
  return (
    <Ico>
      <circle cx="10" cy="3.5" r="2"/>
      <circle cx="4.5" cy="16" r="2"/>
      <circle cx="15.5" cy="16" r="2"/>
      <path d="M10 5.5V11M10 11L4.5 14M10 11L15.5 14"/>
    </Ico>
  );
}
export function IcoSpeechDoc() {
  return (
    <Ico>
      <path d="M11.5 2.5H5a1 1 0 00-1 1v13a1 1 0 001 1h10a1 1 0 001-1V7.5L11.5 2.5Z"/>
      <path d="M11.5 2.5V7.5H16.5"/>
      <path d="M7 11h6M7 13.5h4.5"/>
    </Ico>
  );
}
export function IcoChat() {
  return (
    <Ico>
      <path d="M17 2.5H3a1 1 0 00-1 1v9a1 1 0 001 1h4L10 17.5l3-4H17a1 1 0 001-1v-9a1 1 0 00-1-1Z"/>
    </Ico>
  );
}
export function IcoDrive() {
  return <img src={gdriveLogo} width="20" height="20" alt="Google Drive" style={{ display: 'block', flexShrink: 0 }} />;
}
export function IcoTopics() {
  return (
    <Ico>
      <circle cx="10" cy="10" r="7.5"/>
      <path d="M10 6.5v7M7 9l3-3 3 3"/>
      <path d="M7 14h6"/>
    </Ico>
  );
}
/** Settings: three horizontal tracks with offset slider handles */
export function IcoSettings() {
  return (
    <Ico>
      <line x1="3" y1="6"  x2="17" y2="6"/>
      <line x1="3" y1="10" x2="17" y2="10"/>
      <line x1="3" y1="14" x2="17" y2="14"/>
      <circle cx="7"  cy="6"  r="2"/>
      <circle cx="13" cy="10" r="2"/>
      <circle cx="8"  cy="14" r="2"/>
    </Ico>
  );
}

/** Collapse sidebar: vertical bar right + two left chevrons */
function IcoSidebarCollapse() {
  return (
    <Ico>
      <path d="M15 3V17"/>
      <path d="M11 6.5L7 10l4 3.5"/>
      <path d="M7 6.5L3 10l4 3.5"/>
    </Ico>
  );
}

/** Expand sidebar: vertical bar left + two right chevrons */
function IcoSidebarExpand() {
  return (
    <Ico>
      <path d="M5 3V17"/>
      <path d="M9 6.5L13 10l-4 3.5"/>
      <path d="M13 6.5L17 10l-4 3.5"/>
    </Ico>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────

export default function Sidebar() {
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [importing, setImporting] = useState(false);
  const { db, view, setView, mode, busyViews, event, flowsIndex, setFlowsIndex, chatOpen, setChatOpen, unreadCount } = useApp();
  const cases = Object.values(db.cases);
  const tournaments = Object.values(db.tournaments);
  const opponents = Object.values(db.opponents);
  const judges = Object.values(db.judges ?? {});

  useEffect(() => {
    Promise.all([
      window.warroom?.secure.get('gdrive_client_id'),
      window.warroom?.secure.get('gdrive_client_secret'),
    ]).then(([id, secret]) => {
      setDriveConfigured(!!id && !!secret);
    });
  }, []);

  async function createFlow() {
    const id = crypto.randomUUID();
    const meta: FlowMeta = { id, name: `Flow ${flowsIndex.length + 1}`, event };
    const newIndex = [...flowsIndex, meta];
    setFlowsIndex(newIndex);
    await window.warroom?.storage.write('flows_index', newIndex);
    setView({ kind: 'flow', flowId: id });
  }

  async function importFlow() {
    if (importing) return;
    const path = await window.warroom?.dialog.openFile(['xlsx']);
    if (!path) return;
    setImporting(true);
    try {
      const res = await window.warroom?.fs.readFileBytes(path);
      if (!res?.ok || !res.base64) throw new Error(res?.error || 'Could not read the file.');
      const data = await importFlowFromXlsx(res.base64);
      const id = crypto.randomUUID();
      const baseName = (path.split(/[\\/]/).pop() ?? 'Imported flow').replace(/\.xlsx$/i, '');
      const meta: FlowMeta = { id, name: baseName || `Flow ${flowsIndex.length + 1}`, event: data.event };
      const newIndex = [...flowsIndex, meta];
      await window.warroom?.storage.write(`flow_data_${id}`, data);
      setFlowsIndex(newIndex);
      await window.warroom?.storage.write('flows_index', newIndex);
      setView({ kind: 'flow', flowId: id });
    } catch (e: any) {
      console.error('Flow import failed:', e);
      window.alert(`Import failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      setImporting(false);
    }
  }

  async function deleteFlow(id: string) {
    const newIndex = flowsIndex.filter((f) => f.id !== id);
    setFlowsIndex(newIndex);
    await window.warroom?.storage.write('flows_index', newIndex);
    window.warroom?.storage.write(`flow_data_${id}`, null as any);
    if (view.kind === 'flow' && (view as any).flowId === id) setView({ kind: 'home' });
  }

  async function renameFlow(id: string, name: string) {
    const newIndex = flowsIndex.map((f) => (f.id === id ? { ...f, name } : f));
    setFlowsIndex(newIndex);
    await window.warroom?.storage.write('flows_index', newIndex);
  }

  return (
    <aside
      className="shrink-0 flex flex-col select-none"
      style={{
        width: collapsed ? COLLAPSED : EXPANDED,
        transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1)',
        minWidth: collapsed ? COLLAPSED : EXPANDED,
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-side)',
        overflow: 'hidden',
      }}
    >
      {collapsed ? (
        <CollapsedNav
          view={view} mode={mode} setView={setView}
          chatOpen={chatOpen} setChatOpen={setChatOpen} unreadCount={unreadCount}
          flowsIndex={flowsIndex} createFlow={createFlow}
          toggleCollapsed={toggleCollapsed} driveConfigured={driveConfigured}
        />
      ) : (
        <ExpandedNav
          view={view} mode={mode} setView={setView}
          cases={cases} tournaments={tournaments} opponents={opponents}
          flowsIndex={flowsIndex} busyViews={busyViews}
          chatOpen={chatOpen} setChatOpen={setChatOpen} unreadCount={unreadCount}
          createFlow={createFlow} deleteFlow={deleteFlow} renameFlow={renameFlow}
          importFlow={importFlow} importing={importing}
          db={db} toggleCollapsed={toggleCollapsed} driveConfigured={driveConfigured}
        />
      )}
    </aside>
  );
}

// ── Collapsed navigation (icons only) ────────────────────────────────────────

function CollapsedNav({ view, mode, setView, chatOpen, setChatOpen, unreadCount, flowsIndex, createFlow, toggleCollapsed, driveConfigured }: any) {
  const { setSearchOpen } = useApp();
  const isHome       = view.kind === 'home';
  const isCases      = view.kind === 'case' || view.kind === 'block';
  const isLibrary    = view.kind === 'library' || view.kind === 'find-cards' || view.kind === 'speech-doc' || view.kind === 'google-scholar';
  const isOpponents  = view.kind === 'opponents' || view.kind === 'opponent' || view.kind === 'judge';
  const isTournament = view.kind === 'tournaments' || view.kind === 'tournament' || view.kind === 'round';
  const isFlow       = view.kind === 'flow';
  const isDrive      = view.kind === 'gdrive';
  const isSpeech     = view.kind === 'block' && (view as any).blockId === '__speech__';
  const isSettings   = view.kind === 'settings';
  const isTopics     = view.kind === 'topics';

  function goFlow() {
    if (flowsIndex.length > 0) setView({ kind: 'flow', flowId: flowsIndex[0].id });
    else createFlow();
  }

  return (
    <div className="flex flex-col h-full">
      {/* Expand toggle at top */}
      <div className="flex items-center justify-center py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <CIcon label="Expand sidebar" active={false} onClick={toggleCollapsed}>
          <IcoSidebarExpand />
        </CIcon>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-0.5">
        <CIcon label="Search (⌘K)" active={false} onClick={() => setSearchOpen(true)}>
          <IcoSearch />
        </CIcon>

        <div className="w-6 my-0.5" style={{ borderTop: '1px solid var(--border-subtle)' }} />

        <CIcon label="Home" active={isHome} onClick={() => setView({ kind: 'home' })}>
          <IcoHome />
        </CIcon>

        <div className="w-6 my-1" style={{ borderTop: '1px solid var(--border-subtle)' }} />

        <CIcon label="Cases" active={isCases} onClick={() => setView({ kind: 'home' })}>
          <IcoCases />
        </CIcon>

        {mode === 'prep' && (
          <>
            <CIcon label="Cards" active={isLibrary} onClick={() => setView({ kind: 'library' })}>
              <IcoLibrary />
            </CIcon>
            <CIcon label="Scouting" active={isOpponents} onClick={() => setView({ kind: 'opponents' })}>
              <IcoOpponents />
            </CIcon>
            <CIcon label="Tournaments" active={isTournament} onClick={() => setView({ kind: 'tournaments' })}>
              <IcoTournament />
            </CIcon>
          </>
        )}

        <CIcon label="Flow" active={isFlow} onClick={goFlow}>
          <IcoFlow />
        </CIcon>

        {mode === 'prep' && (
          <>
            {driveConfigured && (
              <CIcon label="Google Drive" active={isDrive} onClick={() => setView({ kind: 'gdrive' })}>
                <IcoDrive />
              </CIcon>
            )}
            <CIcon label="Topics" active={isTopics} onClick={() => setView({ kind: 'topics' })}>
              <IcoTopics />
            </CIcon>
          </>
        )}

        {mode === 'round' && (
          <>
            <CIcon label="Speech doc" active={isSpeech} onClick={() => setView({ kind: 'block', blockId: '__speech__' } as any)}>
              <IcoSpeechDoc />
            </CIcon>
            <CIcon label={chatOpen ? 'Close chat' : 'Chat'} active={chatOpen} onClick={() => setChatOpen(true)}>
              <span className="relative inline-flex">
                <IcoChat />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full text-[8px] font-bold text-white flex items-center justify-center"
                    style={{ background: '#b3261e' }}>
                    {unreadCount > 9 ? '9' : unreadCount}
                  </span>
                )}
              </span>
            </CIcon>
          </>
        )}
      </nav>

      {/* Settings at bottom */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingBottom: 4, display: 'flex', justifyContent: 'center' }}>
        <CIcon label="Settings" active={isSettings} onClick={() => setView({ kind: 'settings' })}>
          <IcoSettings />
        </CIcon>
      </div>
    </div>
  );
}

/** Single icon button for collapsed sidebar */
function CIcon({ label, active, onClick, children }: {
  label: string; active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      title={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center justify-center transition rounded-lg"
      style={{
        height: 36,
        width: 36,
        background: active ? 'var(--nav-active-bg)' : hovered ? 'var(--nav-hover-bg)' : 'transparent',
        color: active ? 'var(--nav-active-color)' : hovered ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
        boxShadow: active ? 'var(--nav-active-shadow)' : 'none',
        border: 'none',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

// ── Expanded navigation (icons + text) ────────────────────────────────────────

function ExpandedNav({
  view, mode, setView, cases, tournaments, opponents,
  flowsIndex, busyViews, chatOpen, setChatOpen, unreadCount,
  createFlow, deleteFlow, renameFlow, importFlow, importing, db, toggleCollapsed, driveConfigured,
}: any) {
  const judges = Object.values(db.judges ?? {});
  const { setSearchOpen, event } = useApp();
  const [speechDocs, setSpeechDocs] = useState<RecentDoc[]>(getSpeechDocs);

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const eventTopicTab: 'policy' | 'pf' | 'ld' = event === 'pf' || event === 'ld' ? event : 'policy';
  const eventTopicLabel = eventTopicTab === 'pf' ? 'Public Forum' : eventTopicTab === 'ld' ? 'Lincoln-Douglas' : 'Policy';

  // Refresh when localStorage changes (e.g. after saving in SpeechDocViewer)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === RECENTS_KEY) setSpeechDocs(getSpeechDocs());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Also refresh when view changes back to cases (user saved and returned)
  useEffect(() => { setSpeechDocs(getSpeechDocs()); }, [view]);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: app wordmark + collapse button */}
      <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)', minHeight: 44 }}>
        <button
          onClick={() => setView({ kind: 'home' })}
          className="flex items-center gap-1.5 rounded-lg transition"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--nav-section-color)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-active-color)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-section-color)'; }}
        >
          <IcoHome />
          <span className="text-xs font-bold tracking-[0.15em] uppercase" style={{ letterSpacing: '0.18em' }}>Home</span>
        </button>
        <button
          onClick={toggleCollapsed}
          title="Collapse sidebar"
          className="flex items-center justify-center rounded-lg transition"
          style={{
            width: 28, height: 28,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--nav-inactive-color)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)';
            (e.currentTarget as HTMLElement).style.color = 'var(--nav-active-color)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)';
          }}
        >
          <IcoSidebarCollapse />
        </button>
      </div>

      {/* Global search — opens the command palette */}
      <div className="px-2 pt-2">
        <button
          onClick={() => setSearchOpen(true)}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition"
          style={{
            background: 'var(--nav-hover-bg)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--nav-inactive-color)',
            cursor: 'text',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-med)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'; }}
        >
          <span style={{ display: 'flex', flexShrink: 0, opacity: 0.7 }}><IcoSearch /></span>
          <span className="text-xs flex-1 text-left">Search</span>
          <span className="text-[10px] font-semibold px-1 py-0.5 rounded shrink-0"
            style={{ background: 'var(--bg-main)', color: 'var(--nav-section-color)', border: '1px solid var(--border-subtle)' }}>
            {isMac ? '⌘K' : 'Ctrl K'}
          </span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto sidebar-scroll py-2 px-2">

        {/* Cases */}
        <Section title="Cases" icon={<IcoCases />}
          action={mode === 'prep' ? () => setView({ kind: 'speech-doc' }) : undefined} actionLabel="+">
          {cases.length === 0 && speechDocs.length === 0 && <Empty>No cases yet</Empty>}
          {cases.map((c: any) => (
            <NavItem key={c.id}
              active={(view.kind === 'case' && (view as any).caseId === c.id) ||
                (view.kind === 'block' && db.blocks[(view as any).blockId]?.caseId === c.id)}
              onClick={() => setView({ kind: 'case', caseId: c.id })}
              itemId={c.id} itemType="case" itemName={c.name}>
              <span className="truncate">{c.name}</span>
            </NavItem>
          ))}
          {speechDocs.map((d) => (
            <NavItem key={d.path}
              active={view.kind === 'speech-doc' && (view as any).docPath === d.path}
              onClick={() => setView({ kind: 'speech-doc', docPath: d.path })}
              itemId={d.path} itemType="speech-doc" itemName={d.name.replace(/\.docx$/i, '')}
              onDeleteOverride={() => {
                removeFromRecents(d.path);
                setSpeechDocs(getSpeechDocs());
                if (view.kind === 'speech-doc' && (view as any).docPath === d.path) setView({ kind: 'home' });
              }}
              onRenameOverride={(name) => {
                renameInRecents(d.path, name);
                setSpeechDocs(getSpeechDocs());
              }}>
              <span className="truncate">{d.name.replace(/\.docx$/i, '')}</span>
            </NavItem>
          ))}
        </Section>

        {mode === 'prep' && (
          <>
            {/* Tournament */}
            <Section title="Tournament" icon={<IcoTournament />}>
              <NavItem active={view.kind === 'tournaments'} onClick={() => setView({ kind: 'tournaments' })}>
                All tournaments
              </NavItem>
              {tournaments.map((t: any) => (
                <NavItem key={t.id}
                  active={view.kind === 'tournament' && (view as any).tournamentId === t.id}
                  onClick={() => setView({ kind: 'tournament', tournamentId: t.id })}
                  itemId={t.id} itemType="tournament" itemName={t.name}>
                  <span className="truncate">{t.name}</span>
                </NavItem>
              ))}
            </Section>

            {/* Scouting */}
            <Section title="Scouting" icon={<IcoOpponents />}>
              <NavItem active={view.kind === 'opponents'} onClick={() => setView({ kind: 'opponents' })}>
                Search / all
              </NavItem>
              {opponents.slice(0, 5).map((o: any) => (
                <NavItem key={o.id}
                  active={view.kind === 'opponent' && (view as any).opponentId === o.id}
                  onClick={() => setView({ kind: 'opponent', opponentId: o.id })}
                  itemId={o.id} itemType="opponent" itemName={o.teamName}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{o.teamName}</span>
                    <span className="shrink-0 text-[8px] font-semibold uppercase tracking-wide px-[3px] rounded" style={{ lineHeight: '13px', background: 'rgba(59,130,246,0.12)', color: 'rgba(96,165,250,0.9)', border: '1px solid rgba(59,130,246,0.2)' }}>Team</span>
                  </span>
                </NavItem>
              ))}
              {judges.slice(0, 4).map((j: any) => (
                <NavItem key={j.id}
                  active={view.kind === 'judge' && (view as any).judgeId === j.id}
                  onClick={() => setView({ kind: 'judge', judgeId: j.id })}
                  itemId={j.id} itemType="judge" itemName={j.name}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{j.name}</span>
                    <span className="shrink-0 text-[8px] font-semibold uppercase tracking-wide px-[3px] rounded" style={{ lineHeight: '13px', background: 'rgba(168,85,247,0.12)', color: 'rgba(192,132,252,0.9)', border: '1px solid rgba(168,85,247,0.2)' }}>Judge</span>
                  </span>
                </NavItem>
              ))}
            </Section>

            {/* Cards */}
            <Section title="Cards" icon={<IcoLibrary />}>
              <NavItem active={view.kind === 'library'} onClick={() => setView({ kind: 'library' })}>All cards</NavItem>
              <NavItem active={view.kind === 'logos'} onClick={() => setView({ kind: 'logos' })}>Logos</NavItem>
              <NavItem active={view.kind === 'open-ev'} onClick={() => setView({ kind: 'open-ev' })}>Open Ev</NavItem>
              <NavItem active={view.kind === 'google-scholar'} onClick={() => setView({ kind: 'google-scholar' })}>Google Scholar</NavItem>
            </Section>

            {/* Google Drive */}
            {driveConfigured && (
              <Section title="Drive" icon={<IcoDrive />}>
                <NavItem active={view.kind === 'gdrive'} onClick={() => setView({ kind: 'gdrive' })}>
                  My files
                </NavItem>
              </Section>
            )}

          </>
        )}

        {/* Flow — both modes */}
        <Section
          title="Flow" icon={<IcoFlow />} action={createFlow} actionLabel="+"
          extraAction={importFlow} extraBusy={importing}
          extraTitle="Import flow from .xlsx" extraIcon={<IcoImport />}
        >
          {flowsIndex.length === 0 && <Empty>No flows yet</Empty>}
          {flowsIndex.map((f: any) => (
            <NavItem key={f.id}
              active={view.kind === 'flow' && (view as any).flowId === f.id}
              onClick={() => setView({ kind: 'flow', flowId: f.id })}
              itemId={f.id} itemType="flow" itemName={f.name}
              onDeleteOverride={() => deleteFlow(f.id)}
              onRenameOverride={(name: string) => renameFlow(f.id, name)}>
              <span className="truncate flex-1">{f.name}</span>
              {f.shared && (
                <span title="Shared" className="shrink-0 ml-1 opacity-60 inline-flex" style={{ color: '#0077ed' }}>
                  <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M12 10a2 2 0 0 0-1.6.8L5.9 8.4A2 2 0 0 0 6 8a2 2 0 0 0-.1-.4l4.5-2.3A2 2 0 1 0 9.9 3.4L5.4 5.7A2 2 0 1 0 5.4 10.3l4.5 2.3A2 2 0 1 0 12 10z"/>
                  </svg>
                </span>
              )}
            </NavItem>
          ))}
        </Section>

        {mode === 'round' && (
          <Section title="Speech doc" icon={<IcoSpeechDoc />}>
            <NavItem
              active={view.kind === 'block' && (view as any).blockId === '__speech__'}
              onClick={() => setView({ kind: 'block', blockId: '__speech__' } as any)}
              busyLabel={busyViews['speech-doc']}>Open speech doc</NavItem>
          </Section>
        )}

        {mode === 'round' && (
          <Section title="Chat" icon={<IcoChat />}>
            <NavItem active={chatOpen} onClick={() => setChatOpen(!chatOpen)}>
              <span className="truncate">{chatOpen ? 'Close chat' : 'Open chat'}</span>
              {unreadCount > 0 && (
                <span className="ml-auto min-w-[16px] h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white px-1"
                  style={{ background: '#b3261e' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </NavItem>
          </Section>
        )}

        {/* NSDA Topics — at the bottom of the nav */}
        <Section title="Topics" icon={<IcoTopics />}>
          <NavItem active={view.kind === 'topics' && !(view as any).tab} onClick={() => setView({ kind: 'topics' })}>
            All events
          </NavItem>
          <NavItem active={view.kind === 'topics' && (view as any).tab === eventTopicTab} onClick={() => setView({ kind: 'topics', tab: eventTopicTab })}>
            {eventTopicLabel}
          </NavItem>
        </Section>
      </nav>

      {/* Bottom bar: Settings */}
      {mode === 'prep' && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '4px 8px' }}>
          <NavRowPrimary
            active={view.kind === 'settings'}
            onClick={() => setView({ kind: 'settings' })}
            icon={<IcoSettings />}
            label="Settings"
          />
        </div>
      )}
    </div>
  );
}

/** Primary-level nav row: icon + label, used for Home and Settings */
function NavRowPrimary({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full text-left px-2.5 py-2 text-xs flex items-center gap-2.5 transition rounded-lg font-semibold"
      style={{
        background: active ? 'var(--nav-active-bg)' : hovered ? 'var(--nav-hover-bg)' : 'transparent',
        color: active ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
        boxShadow: active ? 'var(--nav-active-shadow)' : 'none',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', flexShrink: 0, opacity: active ? 1 : 0.7 }}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({ title, children, action, actionLabel, icon, defaultOpen = true,
  extraAction, extraIcon, extraTitle, extraBusy }: {
  title: string; children?: React.ReactNode; action?: () => void;
  actionLabel?: string; icon?: React.ReactNode; defaultOpen?: boolean;
  extraAction?: () => void; extraIcon?: React.ReactNode; extraTitle?: string; extraBusy?: boolean;
}) {
  const key = `sidebar-collapsed-${title.toLowerCase()}`;
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== 'false'; } catch { return defaultOpen; }
  });

  function toggle() {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(key, String(next)); } catch {}
  }

  return (
    <div className="mb-3">
      <div
        className="w-full px-2 mb-1 flex items-center justify-between group"
        style={{ cursor: 'pointer' }}
      >
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 flex-1 min-w-0"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {icon && (
            <span style={{ color: 'var(--nav-section-color)', display: 'flex', transform: 'scale(0.72)', transformOrigin: 'center' }}>
              {icon}
            </span>
          )}
          <svg
            width="7" height="7" viewBox="0 0 8 8" fill="none"
            className="shrink-0 transition-transform duration-150"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', color: 'var(--nav-section-color)' }}
          >
            <path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-[9px] uppercase tracking-[0.2em] font-bold" style={{ color: 'var(--nav-section-color)' }}>
            {title}
          </span>
        </button>
        <div className="flex items-center" style={{ gap: 2 }}>
          {extraAction && (
            <button
              onClick={extraAction}
              disabled={extraBusy}
              title={extraTitle}
              className="flex items-center justify-center transition rounded"
              style={{
                width: 22, height: 22, flexShrink: 0,
                background: 'transparent', border: 'none', cursor: extraBusy ? 'default' : 'pointer',
                color: 'var(--nav-section-color)',
              }}
              onMouseEnter={(e) => { if (!extraBusy) (e.currentTarget as HTMLElement).style.color = 'var(--nav-active-color)'; }}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.color = 'var(--nav-section-color)'}
            >
              {extraBusy ? (
                <svg className="animate-spin" width="11" height="11" viewBox="0 0 10 10" fill="none">
                  <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 20" strokeLinecap="round" opacity="0.7" />
                </svg>
              ) : extraIcon}
            </button>
          )}
          {action && (
            <button
              onClick={action}
              className="flex items-center justify-center transition rounded"
              style={{
                width: 22, height: 22, flexShrink: 0,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--nav-section-color)', fontSize: 16, lineHeight: 1, fontWeight: 500,
              }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.color = 'var(--nav-active-color)'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.color = 'var(--nav-section-color)'}
            >{actionLabel}</button>
          )}
        </div>
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── NavItem ───────────────────────────────────────────────────────────────────

function NavItem({
  active, onClick, children, itemId, itemType, itemName, busyLabel,
  onDeleteOverride, onRenameOverride, iconEl,
}: {
  active?: boolean; onClick?: () => void; children?: React.ReactNode;
  itemId?: string; itemType?: string; itemName?: string; busyLabel?: string;
  onDeleteOverride?: () => void; onRenameOverride?: (name: string) => void;
  iconEl?: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { update, view, setView } = useApp();

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [renaming]);

  function handleDotsClick(e: React.MouseEvent) { e.stopPropagation(); setMenuOpen((v) => !v); }
  function handleContextMenu(e: React.MouseEvent) {
    if (!hasMenu) return; e.preventDefault(); e.stopPropagation(); setMenuOpen(true);
  }

  function startRenameInline() {
    if (!hasMenu) return;
    setMenuOpen(false); setRenameValue(itemName ?? ''); setRenaming(true);
  }
  function startRename(e: React.MouseEvent) { e.stopPropagation(); startRenameInline(); }

  function commitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === itemName) { setRenaming(false); return; }
    if (onRenameOverride) {
      onRenameOverride(trimmed);
    } else {
      update((db) => {
        const next = { ...db };
        if (itemType === 'case') next.cases = { ...db.cases, [itemId!]: { ...db.cases[itemId!], name: trimmed } };
        else if (itemType === 'opponent') next.opponents = { ...db.opponents, [itemId!]: { ...db.opponents[itemId!], teamName: trimmed } };
        else if (itemType === 'tournament') next.tournaments = { ...db.tournaments, [itemId!]: { ...db.tournaments[itemId!], name: trimmed } };
        else if (itemType === 'judge') next.judges = { ...(db.judges ?? {}), [itemId!]: { ...(db.judges ?? {})[itemId!], name: trimmed } };
        return next;
      });
    }
    setRenaming(false);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation(); setMenuOpen(false);
    if (onDeleteOverride) {
      onDeleteOverride();
    } else {
      update((db) => {
        const next = { ...db };
        if (itemType === 'case') {
          const { [itemId!]: _r, ...rest } = db.cases; next.cases = rest;
          const blocksToRemove = Object.values(db.blocks).filter((b) => b.caseId === itemId).map((b) => b.id);
          const { ...blocks } = db.blocks; blocksToRemove.forEach((bid) => { delete blocks[bid]; }); next.blocks = blocks;
        } else if (itemType === 'opponent') {
          const { [itemId!]: _r, ...rest } = db.opponents; next.opponents = rest;
        } else if (itemType === 'judge') {
          const { [itemId!]: _r, ...rest } = db.judges ?? {}; next.judges = rest;
        } else if (itemType === 'tournament') {
          const t = db.tournaments[itemId!];
          const { [itemId!]: _r, ...rest } = db.tournaments; next.tournaments = rest;
          if (t) { const { ...rounds } = db.rounds; t.rounds.forEach((rid) => { delete rounds[rid]; }); next.rounds = rounds; }
        }
        return next;
      });
      if (itemType === 'case' && view.kind === 'case' && (view as any).caseId === itemId) setView({ kind: 'home' });
      else if (itemType === 'opponent' && view.kind === 'opponent' && (view as any).opponentId === itemId) setView({ kind: 'opponents' });
      else if (itemType === 'judge' && view.kind === 'judge' && (view as any).judgeId === itemId) setView({ kind: 'opponents' });
      else if (itemType === 'tournament' && view.kind === 'tournament' && (view as any).tournamentId === itemId) setView({ kind: 'tournaments' });
    }
  }

  const hasMenu = !!itemId && !!itemType;

  return (
    <div className="relative mb-0.5" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {renaming ? (
        <input
          ref={inputRef} value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
          className="w-full px-2.5 py-1.5 text-xs rounded-lg font-medium outline-none"
          style={{ background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', border: '1px solid var(--border-subtle)' }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          onClick={onClick}
          onDoubleClick={(e) => { e.stopPropagation(); startRenameInline(); }}
          onContextMenu={handleContextMenu}
          className="w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 transition rounded-lg font-medium"
          style={{
            background: active ? 'var(--nav-active-bg)' : (hovered ? 'var(--nav-hover-bg)' : 'transparent'),
            color: active ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
            boxShadow: active ? 'var(--nav-active-shadow)' : 'none',
          }}
        >
          {iconEl && (
            <span className="shrink-0 flex items-center" style={{ opacity: active ? 0.9 : 0.5 }}>
              {iconEl}
            </span>
          )}
          <span className="flex-1 min-w-0 flex items-center">{children}</span>
          {busyLabel && !(hasMenu && (hovered || menuOpen)) && (
            <span className="ml-1 shrink-0" title={busyLabel}>
              <svg className="animate-spin" width="10" height="10" viewBox="0 0 10 10" fill="none">
                <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 20" strokeLinecap="round" opacity="0.7" />
              </svg>
            </span>
          )}
          {hasMenu && (hovered || menuOpen) && (
            <span role="button" tabIndex={0}
              onClick={handleDotsClick}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDotsClick(e as any); }}
              className="ml-1 shrink-0 flex items-center justify-center w-4 h-4 rounded transition"
              style={{ color: 'var(--nav-inactive-color)', opacity: 0.7 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="2" cy="6" r="1.1"/><circle cx="6" cy="6" r="1.1"/><circle cx="10" cy="6" r="1.1"/>
              </svg>
            </span>
          )}
        </button>
      )}

      {menuOpen && (
        <div ref={menuRef} className="absolute left-2 z-50 rounded-lg py-1 text-xs shadow-xl"
          style={{ top: '100%', minWidth: '120px', background: 'var(--bg-popover, var(--bg-sidebar))', border: '1px solid var(--border-subtle)' }}>
          <button onClick={startRename} className="w-full text-left px-3 py-1.5 transition"
            style={{ color: 'var(--nav-active-color)' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            Rename
          </button>
          <button onClick={handleDelete} className="w-full text-left px-3 py-1.5 transition"
            style={{ color: 'var(--danger, #ef4444)' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1 text-[11px] italic" style={{ color: 'var(--placeholder)' }}>{children}</div>;
}
