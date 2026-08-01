import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useApp, FlowMeta } from '../store/appStore';
import gdriveLogo from '../assets/gdrive-logo.png';
import { importFlowFromXlsx } from '../utils/flowImport';
import { useMenuA11y } from '../hooks/useMenuA11y';
import {
  useCaseFolders, childFolders, resolveItemFolder, moveItem, moveFolder,
  isSelfOrDescendant, flattenFolders, folderTrail, CaseFolder, findFolder,
  renameFolder, deleteFolder, pruneAssignments,
  sortByOrder, ensureOrderSeeded, moveInOrder,
  ITEM_DRAG_MIME, FOLDER_DRAG_MIME,
} from '../utils/caseFolders';
import {
  useFlowFolders, itemKeyForFlow,
  FLOW_ITEM_DRAG_MIME, FLOW_FOLDER_DRAG_MIME,
} from '../utils/flowFolders';
import { buildCaseItems, CaseItem, deleteCaseAndBlocks } from '../utils/caseItems';
import {
  comboKeyFor, saveComboLayout, listComboViews, deleteComboView, pruneComboViews, renameComboView,
  COMBO_LAYOUTS_CHANGED, SavedComboView,
} from '../utils/docComboLayout';

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
  // Multi-pane speech doc state, read only to know (a) whether we're
  // currently in a multi-pane compare view and (b) which exact combo of docs
  // it is, so a manual toggle while multi-pane is active can be remembered
  // as that combo's sidebar override (see docComboLayout.ts / SpeechDocViewer).
  const view = useApp((s) => s.view);
  const extraDocPanes = useApp((s) => s.extraDocPanes);
  const isMultiPane = extraDocPanes.some((p) => p !== undefined);
  const pane0Path = view.kind === 'speech-doc' ? (view as any).docPath as string | undefined : undefined;
  const comboKey = isMultiPane ? comboKeyFor([pane0Path, extraDocPanes[0], extraDocPanes[1]]) : null;

  const toggle = () => setC(v => {
    const next = !v;
    try { localStorage.setItem('warroom-sb-collapsed', String(next)); } catch {}
    if (isMultiPane && comboKey) saveComboLayout(comboKey, { sidebarExpanded: !next });
    return next;
  });
  // The speech doc viewer force-collapses the sidebar while 2-3 doc panes are
  // open side by side (there's no room for it), and force-expands it again
  // once back to a single pane — see the dispatch in SpeechDocViewer.tsx.
  useEffect(() => {
    function onForce(e: Event) {
      const collapsed = (e as CustomEvent).detail?.collapsed;
      if (typeof collapsed !== 'boolean') return;
      setC(collapsed);
      try { localStorage.setItem('warroom-sb-collapsed', String(collapsed)); } catch {}
    }
    window.addEventListener('warroom-force-sidebar-collapse', onForce);
    return () => window.removeEventListener('warroom-force-sidebar-collapse', onForce);
  }, []);
  return [c, toggle];
}

// ── Icon system ───────────────────────────────────────────────────────────────
// All: 16×16 viewBox · stroke only · 1.5 weight · round caps + joins

function Ico({ children, size = 20 }: { children: React.ReactNode; size?: number }) {
  // Stroke width is expressed in user units but compensated for `size`, so the
  // RENDERED stroke is always ~1.5 CSS px no matter what size the icon is drawn
  // at. Without this, a 20-unit viewBox drawn at 14px rendered its 1.6 stroke at
  // 1.12px — thin and washed out next to its 20px siblings, which is a big part
  // of why the icon set read as "blurry" rather than merely small.
  const strokeWidth = (1.5 * 20) / size;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      shapeRendering="geometricPrecision"
      style={{ flexShrink: 0, display: 'block' }}>
      {children}
    </svg>
  );
}

/**
 * Pixel-grid icon — a 16-unit viewBox rendered at exactly 16 CSS px, so ONE USER
 * UNIT IS ONE PIXEL. The regular `Ico` above draws on a 20-unit viewBox, and the
 * sidebar's header action buttons render it at 16px (`.sb-ico-16`): 1 unit then
 * lands on 0.8px, so every axis-aligned stroke straddles two pixel columns and
 * gets anti-aliased into a soft grey smear. That is what made this toolbar look
 * blurry — not the artwork.
 *
 * On this grid, an axis-aligned line at a `.5` coordinate with a 1px stroke fills
 * exactly one pixel column, edge to edge, with no anti-aliasing at all. Use it
 * for small, boxy icons (grids, sheets, arrows) that live in the 16px header row.
 *
 * `strokeWidth` is set via inline STYLE, not the attribute, because
 * `.sb-ico-16 > svg` sets `stroke-width` in CSS and a CSS rule beats a
 * presentation attribute — the inline style is what actually wins.
 */
function IcoPx({ children }: { children: React.ReactNode }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
      shapeRendering="geometricPrecision"
      style={{ flexShrink: 0, display: 'block', strokeWidth: 1 }}>
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
/** Folder in the Cases tree — a smaller, plainer sibling of IcoCases. */
export function IcoFolder() {
  return (
    <Ico size={14}>
      <path d="M2 6.5v9a1 1 0 001 1h14a1 1 0 001-1V8.5a1 1 0 00-1-1H9.5l-2-2H3a1 1 0 00-1 1z"/>
    </Ico>
  );
}
export function IcoLibrary() {
  return (
    <Ico>
      <rect x="3.5" y="5" width="11" height="12" rx="1"/>
      <path d="M7 3h8.5a1 1 0 011 1v11"/>
      <path d="M7 9h5M7 12h4" strokeWidth="2"/>
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
  // Pixel-grid (see IcoPx): the tray line sits at y=13.5 and the shaft at x=8,
  // so both render as single crisp pixel runs at 16px.
  return (
    <IcoPx>
      <path d="M8.5 2.5v7.5"/>
      <path d="M5.5 7.5L8.5 10.5l3-3"/>
      <path d="M2.5 13.5h12"/>
    </IcoPx>
  );
}
export function IcoAutoFlow() {
  // A flow sheet (header row + column divider) with a sparkle — "Warroom AI
  // fills this in for you". Drawn on the pixel grid (see IcoPx): every edge of
  // the sheet and both inner rules sit on `.5` coordinates, so at 16px they are
  // exact one-pixel lines rather than the 0.8px-per-unit smear the 20-unit
  // viewBox produced here. The sparkle is a filled path, so it needs no
  // alignment and stays smooth.
  return (
    <IcoPx>
      <rect x="1.5" y="4.5" width="9" height="10" rx="1" />
      <path d="M1.5 7.5h9" />
      <path d="M6.5 7.5v7" />
      <path d="M12.6 1.7l.72 1.73 1.73.72-1.73.72-.72 1.73-.72-1.73L10.15 4.15l1.73-.72z"
        fill="currentColor" stroke="none" />
    </IcoPx>
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
      <path d="M7 16h6" strokeWidth="2"/>
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
      <path d="M7 11h6M7 14h4.5" strokeWidth="2"/>
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
      <path d="M7 14h6" strokeWidth="2"/>
    </Ico>
  );
}
/**
 * Settings: two slider tracks with filled handles.
 *
 * Sized so it stays pixel-crisp at BOTH places it's used — 16px in the expanded
 * sidebar row and 20px in the collapsed rail. The trick is that the track
 * centres sit at y=5 and y=15, which are whole pixels at every scale we render
 * (×1.0 → 5/15, ×0.8 → 4/12), and `strokeWidth` is derived as `2 / scale` so the
 * RENDERED track is always exactly 2px. A 2px stroke centred on a whole pixel
 * fills two whole rows — no antialiasing at 1x or 2x.
 *
 * Handles are FILLED, not outlined: at this size an outlined ring is mostly hole
 * and reads as a smudge, while a solid disc gives the icon a focal point and,
 * being a fill, has no stroke-alignment problem. They sit at opposite ends so
 * the icon reads as "adjustable" rather than as a stack of lines.
 */
export function IcoSettings({ size = 20 }: { size?: number }) {
  const scale = size / 20;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeLinecap="round" shapeRendering="geometricPrecision"
      style={{ flexShrink: 0, display: 'block' }}>
      <line x1="3" y1="5"  x2="17" y2="5"  strokeWidth={2 / scale} />
      <line x1="3" y1="15" x2="17" y2="15" strokeWidth={2 / scale} />
      <circle cx="12.5" cy="5"  r="2.75" fill="currentColor" stroke="none" />
      <circle cx="7.5"  cy="15" r="2.75" fill="currentColor" stroke="none" />
    </svg>
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
  const { db, view, setView, event, flowsIndex, setFlowsIndex, pushUndoToast } = useApp();
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
    const meta: FlowMeta = { id, name: `Flow ${flowsIndex.length + 1}`, event, createdAt: new Date().toISOString() };
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
      const meta: FlowMeta = { id, name: baseName || `Flow ${flowsIndex.length + 1}`, event: data.event, createdAt: new Date().toISOString() };
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
    const removed = flowsIndex.find((f) => f.id === id);
    const dataSnapshot = await window.warroom?.storage.read(`flow_data_${id}`);
    const indexSnapshot = flowsIndex;
    const newIndex = flowsIndex.filter((f) => f.id !== id);
    setFlowsIndex(newIndex);
    await window.warroom?.storage.write('flows_index', newIndex);
    window.warroom?.storage.write(`flow_data_${id}`, null as any);
    if (view.kind === 'flow' && (view as any).flowId === id) setView({ kind: 'home' });
    if (!removed) return;
    pushUndoToast(`Deleted "${removed.name}"`, async () => {
      await window.warroom?.storage.write(`flow_data_${id}`, dataSnapshot as any);
      setFlowsIndex(indexSnapshot);
      await window.warroom?.storage.write('flows_index', indexSnapshot);
    });
  }

  async function renameFlow(id: string, name: string) {
    const newIndex = flowsIndex.map((f) => (f.id === id ? { ...f, name } : f));
    setFlowsIndex(newIndex);
    await window.warroom?.storage.write('flows_index', newIndex);
  }

  return (
    <aside
      className="glass-sidebar shrink-0 flex flex-col select-none"
      style={{
        width: collapsed ? COLLAPSED : EXPANDED,
        transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1)',
        minWidth: collapsed ? COLLAPSED : EXPANDED,
        borderRight: '1px solid var(--border-side)',
        overflow: 'hidden',
      }}
    >
      {collapsed ? (
        <CollapsedNav
          view={view} setView={setView}
          flowsIndex={flowsIndex} createFlow={createFlow}
          toggleCollapsed={toggleCollapsed} driveConfigured={driveConfigured}
        />
      ) : (
        <ExpandedNav
          view={view} setView={setView}
          tournaments={tournaments} opponents={opponents}
          flowsIndex={flowsIndex}
          createFlow={createFlow} deleteFlow={deleteFlow} renameFlow={renameFlow}
          importFlow={importFlow} importing={importing}
          db={db} toggleCollapsed={toggleCollapsed} driveConfigured={driveConfigured}
        />
      )}
    </aside>
  );
}

// ── Collapsed navigation (icons only) ────────────────────────────────────────

function CollapsedNav({ view, setView, flowsIndex, createFlow, toggleCollapsed, driveConfigured }: any) {
  const { setSearchOpen } = useApp();
  const isHome       = view.kind === 'home';
  // Speech docs live under Cases (the recents list IS the sidebar's Cases list),
  // so an open speech doc lights Cases — not Cards, which is the card library.
  const isCases      = view.kind === 'case' || view.kind === 'block' || view.kind === 'cases-grid' || view.kind === 'speech-doc';
  const isLibrary    = view.kind === 'library' || view.kind === 'find-cards' || view.kind === 'google-scholar';
  const isOpponents  = view.kind === 'opponents' || view.kind === 'opponent' || view.kind === 'judge';
  const isTournament = view.kind === 'tournaments' || view.kind === 'tournament' || view.kind === 'round';
  const isFlow       = view.kind === 'flow' || view.kind === 'flows-grid';
  const isDrive      = view.kind === 'gdrive';
  const isSettings   = view.kind === 'settings';
  const isTopics     = view.kind === 'topics';

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

        <CIcon label="Cases" active={isCases} onClick={() => setView({ kind: 'cases-grid' })}
          onContextMenu={() => setView({ kind: 'speech-doc' })} contextLabel="new case">
          <IcoCases />
        </CIcon>

        <CIcon label="Cards" active={isLibrary} onClick={() => setView({ kind: 'library' })}>
          <IcoLibrary />
        </CIcon>
        <CIcon label="Scouting" active={isOpponents} onClick={() => setView({ kind: 'opponents' })}>
          <IcoOpponents />
        </CIcon>
        <CIcon label="Tournaments" active={isTournament} onClick={() => setView({ kind: 'tournaments' })}>
          <IcoTournament />
        </CIcon>

        <CIcon label="Flow" active={isFlow} onClick={() => setView({ kind: 'flows-grid' })}
          onContextMenu={createFlow} contextLabel="new flow">
          <IcoFlow />
        </CIcon>

        {driveConfigured && (
          <CIcon label="Google Drive" active={isDrive} onClick={() => setView({ kind: 'gdrive' })}>
            <IcoDrive />
          </CIcon>
        )}
        <CIcon label="Topics" active={isTopics} onClick={() => setView({ kind: 'topics' })}>
          <IcoTopics />
        </CIcon>
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
function CIcon({ label, active, onClick, onContextMenu, contextLabel, children }: {
  label: string; active: boolean; onClick: () => void; onContextMenu?: () => void; contextLabel?: string; children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      title={onContextMenu ? `${label} (right-click: ${contextLabel ?? 'new'})` : label}
      onClick={onClick}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(); } : undefined}
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
  view, setView, tournaments, opponents,
  flowsIndex,
  createFlow, deleteFlow, renameFlow, importFlow, importing, db, toggleCollapsed, driveConfigured,
}: any) {
  const judges = Object.values(db.judges ?? {});
  const { setSearchOpen, event, openCardCutter, setAutoFlowOpen } = useApp();

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const eventTopicTab: 'policy' | 'pf' | 'ld' = event === 'pf' || event === 'ld' ? event : 'policy';
  const eventTopicLabel = eventTopicTab === 'pf' ? 'Public Forum' : eventTopicTab === 'ld' ? 'Lincoln-Douglas' : 'Policy';

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: app wordmark + collapse button */}
      <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid var(--border-subtle)', minHeight: 36 }}>
        <button
          onClick={() => setView({ kind: 'home' })}
          title="Home"
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
      <div className="px-2 pt-1.5">
        <button
          onClick={() => setSearchOpen(true)}
          title="Search everything"
          className="w-full flex items-center gap-2 px-2.5 py-1 rounded-lg transition"
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

      <nav className="flex-1 overflow-y-auto sidebar-scroll py-1.5 px-2">

        {/* Cases — nested folder tree; the section title opens the full grid */}
        <CasesSection view={view} setView={setView} db={db} />

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
        <Section title="Cards" icon={<IcoLibrary />}
          action={openCardCutter} actionLabel="+">
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

        {/* Flow — nested folder tree, same system as Cases */}
        <FlowsSection
          view={view} setView={setView} flowsIndex={flowsIndex}
          createFlow={createFlow} deleteFlow={deleteFlow} renameFlow={renameFlow}
          importFlow={importFlow} importing={importing} setAutoFlowOpen={setAutoFlowOpen}
        />

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
      <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '4px 8px' }}>
        <NavRowPrimary
          active={view.kind === 'settings'}
          onClick={() => setView({ kind: 'settings' })}
          icon={<IcoSettings size={16} />}
          label="Settings"
        />
      </div>
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
      title={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full text-left px-2.5 py-1 text-xs flex items-center gap-2 transition rounded-lg font-medium"
      style={{
        background: active ? 'var(--nav-active-bg)' : hovered ? 'var(--nav-hover-bg)' : 'transparent',
        color: active ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
        boxShadow: active ? 'var(--nav-active-shadow)' : 'none',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', flexShrink: 0, opacity: active ? 0.9 : 0.55 }}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

// ── Cases folder tree ─────────────────────────────────────────────────────────

/**
 * A folder is only a label layered over documents that already exist (see
 * utils/caseFolders.ts) — filing something never moves or deletes the underlying
 * file, so a drag here is always safe to undo by dragging back. Folder state is
 * shared with the Cases grid, so a change in either place shows up in both.
 */

const FOLDERS_OPEN_KEY = 'sidebar-cases-folders-open';
const FLOW_FOLDERS_OPEN_KEY = 'sidebar-flow-folders-open';

/** Which folders are expanded, persisted like the section collapse state above. */
function useOpenFolders(storageKey: string = FOLDERS_OPEN_KEY) {
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      return new Set<string>(Array.isArray(raw) ? raw : []);
    } catch { return new Set<string>(); }
  });
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch {}
    return next;
  });
  // Open-only variant (never closes) — safe to call from a delayed timer where
  // the folder's state may have changed since the timer was armed.
  const openOnly = (id: string) => setOpen((prev) => {
    if (prev.has(id)) return prev;
    const next = new Set(prev);
    next.add(id);
    try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch {}
    return next;
  });
  return [open, toggle, openOnly] as const;
}

// Auto-expand a collapsed folder after hovering a drag over it for a moment,
// so items can be dropped into nested folders without a separate expand step.
const DRAG_EXPAND_DELAY_MS = 600;
function useDragHoverExpand(openFolder: (id: string) => void) {
  const ref = useRef<{ id: string; timer: number } | null>(null);
  const cancel = () => {
    if (ref.current) { window.clearTimeout(ref.current.timer); ref.current = null; }
  };
  const hover = (target: string | null) => {
    if (ref.current?.id === target) return;
    cancel();
    if (!target) return;
    ref.current = {
      id: target,
      timer: window.setTimeout(() => { ref.current = null; openFolder(target); }, DRAG_EXPAND_DELAY_MS),
    };
  };
  return { hover, cancel };
}

/** Sentinel drop target for "no folder" — distinct from `null` meaning "nothing hovered". */
const TOP_LEVEL_DROP = '__top__';

const INDENT_PX = 11;

type DragPayload = { kind: 'item' | 'folder'; id: string };

function FolderRow({ folder, depth, open, active, dropping, onToggle, onNavigate,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, onRename, onDelete }: {
  folder: CaseFolder; depth: number; open: boolean; active: boolean; dropping: boolean;
  onToggle: () => void; onNavigate: () => void;
  onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void;
  /**
   * Rename/delete for trees with no grid page behind them (the Flow tree).
   * Cases folders leave these unset — their management UI lives in the Cases
   * grid — and the row renders exactly as before. When set: hover shows a ⋯
   * menu (also on right-click) with Rename/Delete, and double-click renames
   * inline, mirroring NavItem's behavior for regular items.
   */
  onRename?: (name: string) => void; onDelete?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasMenu = !!(onRename || onDelete);
  const lit = active || dropping;

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);
  useMenuA11y(menuOpen, menuRef, () => setMenuOpen(false));

  useEffect(() => {
    if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [renaming]);

  function startRename() {
    if (!onRename) return;
    setMenuOpen(false); setRenameValue(folder.name); setRenaming(true);
  }
  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== folder.name) onRename?.(trimmed);
    setRenaming(false);
  }

  return (
    <div
      className="relative mb-px"
      style={{ paddingLeft: depth * INDENT_PX }}
      draggable={!renaming}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {renaming ? (
        <input
          ref={inputRef} value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
          className="w-full px-2.5 py-1 text-xs rounded-lg font-medium outline-none"
          style={{ background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', border: '1px solid var(--border-subtle)' }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          onClick={onNavigate}
          title={folder.name}
          onDoubleClick={(e) => { e.stopPropagation(); startRename(); }}
          onContextMenu={(e) => { if (hasMenu) { e.preventDefault(); e.stopPropagation(); setMenuOpen(true); } }}
          className="w-full text-left px-2.5 py-1 text-xs flex items-center gap-1.5 transition rounded-lg font-medium"
          style={{
            background: lit ? 'var(--nav-active-bg)' : hovered ? 'var(--nav-hover-bg)' : 'transparent',
            color: lit ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
            boxShadow: dropping
              ? 'inset 0 0 0 1.5px rgb(var(--ink-rgb) / 0.5)'
              : active ? 'var(--nav-active-shadow)' : 'none',
          }}
        >
          <span
            role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onToggle(); } }}
            className="shrink-0 flex items-center justify-center rounded transition"
            style={{ width: 18, height: 18, margin: '0 -4.5px' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <svg width="7" height="7" viewBox="0 0 8 8" fill="none"
              className="transition-transform duration-150"
              style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              <path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <span className="shrink-0 flex items-center" style={{ opacity: lit ? 0.9 : 0.5 }}>
            <IcoFolder />
          </span>
          <span className="truncate flex-1">{folder.name}</span>
          {hasMenu && (hovered || menuOpen) && (
            <span role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setMenuOpen((v) => !v); } }}
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
        <div ref={menuRef} className="glass-popover absolute left-2 z-50 rounded-lg py-1 text-xs shadow-xl"
          style={{ top: '100%', minWidth: '150px', border: '1px solid var(--border-subtle)' }}>
          {onRename && (
            <button onClick={(e) => { e.stopPropagation(); startRename(); }}
              title="Rename folder"
              className="w-full text-left px-3 py-1.5 transition"
              style={{ color: 'var(--nav-active-color)' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
              Rename
            </button>
          )}
          {onDelete && (
            <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
              title="Delete folder"
              className="w-full text-left px-3 py-1.5 transition"
              style={{ color: 'var(--danger, #ef4444)' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
              Delete folder
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CasesSection({ view, setView, db }: {
  view: any; setView: (v: any) => void; db: any;
}) {
  const { folders, update } = useCaseFolders();
  const [openIds, toggleOpen, openFolderOnly] = useOpenFolders();
  const dragExpand = useDragHoverExpand(openFolderOnly);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  // Full breadcrumb per folder (e.g. "Districts / Neg") rather than indentation —
  // this list renders flat inside a context menu, where indentation alone reads
  // as accidental whitespace once the menu is only ~200px wide.
  const folderChoices = useMemo(
    () => flattenFolders(folders).map((f) => ({
      id: f.id,
      label: folderTrail(folders, f.id).map((t) => t.name).join(' / '),
    })),
    [folders],
  );

  /**
   * "Move to folder" menu entries for one item — the fallback for when the
   * correct folder isn't a visible drop target (collapsed, or nested under a
   * collapsed ancestor). Excludes the item's current folder; includes "Top
   * level" only when the item is actually filed somewhere.
   */
  function moveOptionsFor(item: CaseItem) {
    const currentFolderId = resolveItemFolder(folders, item.key);
    const opts: { key: string; label: string; onClick: () => void }[] = [];
    if (currentFolderId !== null) {
      opts.push({ key: '__top__', label: 'Top level (no folder)', onClick: () => update((d) => moveItem(d, item.key, null)) });
    }
    for (const f of folderChoices) {
      if (f.id === currentFolderId) continue;
      opts.push({ key: f.id, label: f.label, onClick: () => update((d) => moveItem(d, item.key, f.id)) });
    }
    return opts;
  }

  // buildCaseItems reads the speech-doc recents out of localStorage, which React
  // can't see change. Bumping this tick is what re-reads them.
  const [docsTick, setDocsTick] = useState(0);
  const bumpDocs = () => setDocsTick((t) => t + 1);

  useEffect(() => {
    function onStorage(e: StorageEvent) { if (e.key === RECENTS_KEY) bumpDocs(); }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Also re-read on navigation — the user may have saved a doc and come back.
  useEffect(() => { bumpDocs(); }, [view]);

  const items = useMemo(
    // docsTick is a dependency, not a value: it forces the localStorage re-read above.
    () => buildCaseItems(db).filter((i) => i.kind === 'speech-doc' || !i.id.startsWith('__')),
    [db, docsTick],
  );

  // Display order = date added, until the user drags something (then that
  // sticks). New items (not yet in folders.order) get seeded in on mount/change
  // rather than during render — this is a write, so it belongs in an effect.
  useEffect(() => {
    const seeded = ensureOrderSeeded(folders, items.map((i) => ({ key: i.key, addedAt: i.addedAt })));
    if (seeded !== folders) update(() => seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, folders]);
  const orderedItems = useMemo(() => sortByOrder(folders, items), [folders, items]);

  // ── Drag-to-reorder (item onto item) ────────────────────────────────────
  const [reorderTarget, setReorderTarget] = useState<{ key: string; edge: 'before' | 'after' } | null>(null);
  function onItemDragOver(e: React.DragEvent, item: CaseItem) {
    const isItemDrag = dragging?.kind === 'item' || e.dataTransfer.types.includes(ITEM_DRAG_MIME);
    if (!isItemDrag || dragging?.id === item.key) return;
    e.preventDefault();
    e.stopPropagation();
    dragExpand.cancel();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const edge: 'before' | 'after' = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after';
    setReorderTarget({ key: item.key, edge });
  }
  function onItemDrop(e: React.DragEvent, item: CaseItem) {
    const edge = reorderTarget?.key === item.key ? reorderTarget.edge : 'before';
    setReorderTarget(null);
    const draggedKey = dragging?.kind === 'item' ? dragging.id : e.dataTransfer.getData(ITEM_DRAG_MIME);
    setDragging(null);
    if (!draggedKey || draggedKey === item.key) return;
    e.preventDefault();
    e.stopPropagation();
    const targetFolder = resolveItemFolder(folders, item.key);
    update((d) => moveInOrder(moveItem(d, draggedKey, targetFolder), draggedKey, item.key, edge));
  }

  function isItemActive(item: CaseItem): boolean {
    if (item.kind === 'speech-doc') return view.kind === 'speech-doc' && view.docPath === item.path;
    return (view.kind === 'case' && view.caseId === item.id) ||
      (view.kind === 'block' && db.blocks[view.blockId]?.caseId === item.id);
  }

  /** A folder can't be filed into itself or its own subtree — that would orphan it. */
  function canDrop(target: string | null): boolean {
    if (!dragging) return false;
    if (dragging.kind === 'item' || target === null) return true;
    return !isSelfOrDescendant(folders, dragging.id, target);
  }

  function onDropInto(e: React.DragEvent, target: string | null) {
    e.preventDefault();
    e.stopPropagation();
    setDropId(null);
    dragExpand.cancel();
    const d = dragging;
    setDragging(null);
    if (d) {
      if (!canDrop(target)) return;
      if (d.kind === 'item') update((data) => moveItem(data, d.id, target));
      else update((data) => moveFolder(data, d.id, target));
      return;
    }
    // No local drag state — this drop came from the Cases grid (a separate React
    // tree, so it never touched `dragging` here). Read the real payload off
    // dataTransfer instead, the one thing both trees can see.
    const itemKey = e.dataTransfer.getData(ITEM_DRAG_MIME);
    if (itemKey) { update((data) => moveItem(data, itemKey, target)); return; }
    const folderId = e.dataTransfer.getData(FOLDER_DRAG_MIME);
    if (folderId && (target === null || !isSelfOrDescendant(folders, folderId, target))) {
      update((data) => moveFolder(data, folderId, target));
    }
  }

  function onDragOverTarget(e: React.DragEvent, target: string | null) {
    if (dragging) {
      if (!canDrop(target)) return;
    } else {
      // No local drag — likely a cross-tree drag from the grid. dataTransfer's
      // actual values aren't readable until drop, but `.types` already lists
      // which MIME types are present, which is enough to decide whether to
      // accept the hover. (A folder-onto-its-own-descendant drag from the grid
      // can't be caught here — only at drop, once the id is readable.)
      const types = e.dataTransfer.types;
      if (!types.includes(ITEM_DRAG_MIME) && !types.includes(FOLDER_DRAG_MIME)) return;
    }
    e.preventDefault(); // without this the drop event never fires
    e.stopPropagation();
    setDropId(target ?? TOP_LEVEL_DROP);
    if (target && !openIds.has(target)) dragExpand.hover(target);
    else dragExpand.hover(null);
  }

  function startDrag(e: React.DragEvent, payload: DragPayload) {
    e.stopPropagation();
    setDragging(payload); // drives this tree's own hover/opacity feedback
    e.dataTransfer.effectAllowed = 'move';
    // The real payload goes on dataTransfer (not just React state) so a drop
    // handler in the Cases grid — a separate tree — can read it too.
    e.dataTransfer.setData(payload.kind === 'item' ? ITEM_DRAG_MIME : FOLDER_DRAG_MIME, payload.id);
  }

  // ── Multi-select ─────────────────────────────────────────────────────────
  // Cmd/Ctrl+click toggles an item in/out of the selection without navigating,
  // so the sidebar keeps its normal "single click opens it" behavior for the
  // common case. Selection drives a small bulk-action bar (delete / move to).
  const { update: updateDb } = useApp();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function clearSelection() { setSelected(new Set()); }

  function bulkDelete() {
    const keys = new Set(selected);
    const docPaths = items.filter((i) => keys.has(i.key) && i.kind === 'speech-doc').map((i) => i.path!);
    const caseIds = items.filter((i) => keys.has(i.key) && i.kind !== 'speech-doc').map((i) => i.id);
    for (const p of docPaths) removeFromRecents(p);
    if (docPaths.length) bumpDocs();
    if (caseIds.length) {
      updateDb((d) => caseIds.reduce((acc, id) => deleteCaseAndBlocks(acc, id), d));
    }
    if (view.kind === 'speech-doc' && docPaths.includes((view as any).docPath)) setView({ kind: 'home' });
    if (view.kind === 'case' && caseIds.includes((view as any).caseId)) setView({ kind: 'home' });
    clearSelection();
  }

  function bulkMoveTo(folderId: string | null) {
    const keys = selected;
    update((d) => {
      let next = d;
      for (const key of keys) next = moveItem(next, key, folderId);
      return next;
    });
    clearSelection();
  }

  function renderItem(item: CaseItem, depth: number) {
    const isDoc = item.kind === 'speech-doc';
    const isSelected = selected.has(item.key);
    const showTarget = reorderTarget?.key === item.key ? reorderTarget.edge : null;
    return (
      <div
        key={item.key}
        style={{
          paddingLeft: depth * INDENT_PX,
          opacity: dragging?.id === item.key ? 0.45 : 1,
          background: isSelected ? 'var(--nav-hover-bg)' : undefined,
          borderRadius: 8,
          borderTop: showTarget === 'before' ? '2px solid var(--nav-active-color, #4285F4)' : '2px solid transparent',
          borderBottom: showTarget === 'after' ? '2px solid var(--nav-active-color, #4285F4)' : '2px solid transparent',
        }}
        draggable
        onDragStart={(e) => startDrag(e, { kind: 'item', id: item.key })}
        onDragEnd={() => { setDragging(null); setDropId(null); setReorderTarget(null); }}
        onDragOver={(e) => onItemDragOver(e, item)}
        onDragLeave={() => setReorderTarget((cur) => (cur?.key === item.key ? null : cur))}
        onDrop={(e) => onItemDrop(e, item)}
        // Cmd/Ctrl+click toggles selection instead of navigating. Capture phase so
        // this runs before NavItem's own button onClick and can swallow the event.
        onClickCapture={(e) => {
          if (!e.metaKey && !e.ctrlKey) return;
          e.preventDefault();
          e.stopPropagation();
          toggleSelect(item.key);
        }}
      >
        <NavItem
          active={isItemActive(item) || isSelected}
          onClick={() => setView(isDoc
            ? { kind: 'speech-doc', docPath: item.path }
            : { kind: 'case', caseId: item.id })}
          itemId={item.id}
          itemType={isDoc ? 'speech-doc' : 'case'}
          itemName={item.name}
          onDeleteOverride={isDoc ? () => {
            removeFromRecents(item.path!);
            bumpDocs();
            if (view.kind === 'speech-doc' && view.docPath === item.path) setView({ kind: 'home' });
          } : undefined}
          onRenameOverride={isDoc ? (name: string) => {
            renameInRecents(item.path!, name);
            bumpDocs();
          } : undefined}
          moveOptions={moveOptionsFor(item)}
        >
          <span className="truncate">{item.name}</span>
        </NavItem>
      </div>
    );
  }

  function renderFolders(parentId: string | null, depth: number): React.ReactNode {
    return childFolders(folders, parentId).map((f) => {
      const open = openIds.has(f.id);
      return (
        <React.Fragment key={f.id}>
          <FolderRow
            folder={f}
            depth={depth}
            open={open}
            active={view.kind === 'cases-grid' && view.folderId === f.id}
            dropping={dropId === f.id}
            onToggle={() => toggleOpen(f.id)}
            onNavigate={() => setView({ kind: 'cases-grid', folderId: f.id })}
            onDragStart={(e) => startDrag(e, { kind: 'folder', id: f.id })}
            onDragEnd={() => { setDragging(null); setDropId(null); }}
            onDragOver={(e) => onDragOverTarget(e, f.id)}
            onDragLeave={() => { setDropId((cur) => (cur === f.id ? null : cur)); dragExpand.cancel(); }}
            onDrop={(e) => onDropInto(e, f.id)}
          />
          {open && (
            <>
              {renderFolders(f.id, depth + 1)}
              {orderedItems.filter((i) => resolveItemFolder(folders, i.key) === f.id)
                .map((i) => renderItem(i, depth + 1))}
            </>
          )}
        </React.Fragment>
      );
    });
  }

  const topFolders = childFolders(folders, null);
  const looseItems = orderedItems.filter((i) => resolveItemFolder(folders, i.key) === null);
  const topLit = dropId === TOP_LEVEL_DROP;

  return (
    <Section
      title="Cases" icon={<IcoCases />}
      onTitleClick={() => setView({ kind: 'cases-grid' })}
      action={() => setView({ kind: 'speech-doc' })} actionLabel="+"
    >
      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          folderChoices={folderChoices}
          onMove={bulkMoveTo}
          onDelete={bulkDelete}
          onClear={clearSelection}
        />
      )}
      {/* Anything not dropped on a folder row falls through to here = top level. */}
      <div
        onDragOver={(e) => onDragOverTarget(e, null)}
        onDragLeave={() => setDropId((cur) => (cur === TOP_LEVEL_DROP ? null : cur))}
        onDrop={(e) => onDropInto(e, null)}
        style={{
          borderRadius: 8,
          outline: topLit ? '1.5px dashed rgb(var(--ink-rgb) / 0.4)' : '1.5px dashed transparent',
          outlineOffset: -1,
        }}
      >
        {topFolders.length === 0 && items.length === 0 && <Empty>No cases yet</Empty>}
        <CompareViewsGroup items={items} />
        {renderFolders(null, 0)}
        {looseItems.map((i) => renderItem(i, 0))}
      </div>
    </Section>
  );
}

// ── Flow folder tree ──────────────────────────────────────────────────────────

/**
 * The Flow section's nested folder tree — the same folder system as Cases
 * (utils/flowFolders.ts stores the same shape under its own key), so flows can
 * be grouped by tournament, round, or practice set. A folder is only a label:
 * filing a flow never touches its stored data, and deleting a folder moves its
 * contents up a level rather than deleting any flow. Unlike Cases there is no
 * grid page behind this tree, so folder create/rename/delete live here — the
 * folder-plus header button creates one, and each folder row has a ⋯ menu.
 */
function FlowsSection({ view, setView, flowsIndex, createFlow, deleteFlow, renameFlow, importFlow, importing, setAutoFlowOpen }: {
  view: any; setView: (v: any) => void; flowsIndex: FlowMeta[];
  createFlow: () => void; deleteFlow: (id: string) => void; renameFlow: (id: string, name: string) => void;
  importFlow: () => void; importing: boolean; setAutoFlowOpen: (open: boolean) => void;
}) {
  const { folders, ready, update } = useFlowFolders();
  const pushUndoToast = useApp((s) => s.pushUndoToast);
  const [openIds, toggleOpen, openFolderOnly] = useOpenFolders(FLOW_FOLDERS_OPEN_KEY);
  const dragExpand = useDragHoverExpand(openFolderOnly);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  // Full breadcrumb per folder for the flat "Move to" context menu, same as CasesSection.
  const folderChoices = useMemo(
    () => flattenFolders(folders).map((f) => ({
      id: f.id,
      label: folderTrail(folders, f.id).map((t) => t.name).join(' / '),
    })),
    [folders],
  );

  // Drop assignments for flows that no longer exist. Only once folder state is
  // actually loaded — pruning against an empty snapshot would wipe everything.
  useEffect(() => {
    if (!ready) return;
    const liveKeys = new Set(flowsIndex.map((f) => itemKeyForFlow(f.id)));
    const next = pruneAssignments(folders, liveKeys);
    if (Object.keys(next.assignments).length !== Object.keys(folders.assignments).length) {
      update(() => next);
    }
  }, [ready, flowsIndex, folders, update]);

  // Display order = newest created first, until a drag in the Flows grid (which
  // shares this same folders.order) reorders it — mirrors CasesSection below.
  useEffect(() => {
    if (!ready) return;
    const seeded = ensureOrderSeeded(folders, flowsIndex.map((f, i) => ({
      key: itemKeyForFlow(f.id),
      addedAt: f.createdAt ?? String(i).padStart(8, '0'),
    })));
    if (seeded !== folders) update(() => seeded);
  }, [ready, flowsIndex, folders, update]);
  const orderedFlows = useMemo(() => sortByOrder(folders, flowsIndex.map((f) => ({ ...f, key: itemKeyForFlow(f.id) }))), [folders, flowsIndex]);

  function moveOptionsFor(flowId: string) {
    const key = itemKeyForFlow(flowId);
    const currentFolderId = resolveItemFolder(folders, key);
    const opts: { key: string; label: string; onClick: () => void }[] = [];
    if (currentFolderId !== null) {
      opts.push({ key: '__top__', label: 'Top level (no folder)', onClick: () => update((d) => moveItem(d, key, null)) });
    }
    for (const f of folderChoices) {
      if (f.id === currentFolderId) continue;
      opts.push({ key: f.id, label: f.label, onClick: () => update((d) => moveItem(d, key, f.id)) });
    }
    return opts;
  }

  /** A folder can't be filed into itself or its own subtree — that would orphan it. */
  function canDrop(target: string | null): boolean {
    if (!dragging) return false;
    if (dragging.kind === 'item' || target === null) return true;
    return !isSelfOrDescendant(folders, dragging.id, target);
  }

  function onDropInto(e: React.DragEvent, target: string | null) {
    e.preventDefault();
    e.stopPropagation();
    setDropId(null);
    dragExpand.cancel();
    const d = dragging;
    setDragging(null);
    if (!d || !canDrop(target)) return;
    if (d.kind === 'item') update((data) => moveItem(data, d.id, target));
    else update((data) => moveFolder(data, d.id, target));
  }

  function onDragOverTarget(e: React.DragEvent, target: string | null) {
    if (dragging) {
      if (!canDrop(target)) return;
    } else {
      // Not our drag — accept only flow-flavored payloads, so a case/doc dragged
      // from the Cases tree can't be filed into a flow folder.
      const types = e.dataTransfer.types;
      if (!types.includes(FLOW_ITEM_DRAG_MIME) && !types.includes(FLOW_FOLDER_DRAG_MIME)) return;
    }
    e.preventDefault(); // without this the drop event never fires
    e.stopPropagation();
    setDropId(target ?? TOP_LEVEL_DROP);
    if (target && !openIds.has(target)) dragExpand.hover(target);
    else dragExpand.hover(null);
  }

  function startDrag(e: React.DragEvent, payload: DragPayload) {
    e.stopPropagation();
    setDragging(payload);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(payload.kind === 'item' ? FLOW_ITEM_DRAG_MIME : FLOW_FOLDER_DRAG_MIME, payload.id);
  }

  function doDeleteFolder(id: string) {
    // Contents move up to the parent (see caseFolders.deleteFolder) — no flow is deleted.
    const folder = findFolder(folders, id);
    const snapshot = folders;
    update((d) => deleteFolder(d, id));
    if (folder) pushUndoToast(`Deleted folder "${folder.name}"`, () => update(() => snapshot));
  }

  function renderFlow(f: FlowMeta, depth: number) {
    const key = itemKeyForFlow(f.id);
    return (
      <div
        key={f.id}
        style={{ paddingLeft: depth * INDENT_PX, opacity: dragging?.id === key ? 0.45 : 1 }}
        draggable
        onDragStart={(e) => startDrag(e, { kind: 'item', id: key })}
        onDragEnd={() => { setDragging(null); setDropId(null); }}
      >
        <NavItem
          active={view.kind === 'flow' && (view as any).flowId === f.id}
          onClick={() => setView({ kind: 'flow', flowId: f.id })}
          itemId={f.id} itemType="flow" itemName={f.name}
          onDeleteOverride={() => deleteFlow(f.id)}
          onRenameOverride={(name: string) => renameFlow(f.id, name)}
          moveOptions={moveOptionsFor(f.id)}
        >
          <span className="truncate flex-1">{f.name}</span>
          {(f as any).shared && (
            <span title="Shared" className="shrink-0 ml-1 opacity-60 inline-flex" style={{ color: '#0077ed' }}>
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
                <path d="M12 10a2 2 0 0 0-1.6.8L5.9 8.4A2 2 0 0 0 6 8a2 2 0 0 0-.1-.4l4.5-2.3A2 2 0 1 0 9.9 3.4L5.4 5.7A2 2 0 1 0 5.4 10.3l4.5 2.3A2 2 0 1 0 12 10z"/>
              </svg>
            </span>
          )}
        </NavItem>
      </div>
    );
  }

  function renderFolders(parentId: string | null, depth: number): React.ReactNode {
    return childFolders(folders, parentId).map((f) => {
      const open = openIds.has(f.id);
      return (
        <React.Fragment key={f.id}>
          <FolderRow
            folder={f}
            depth={depth}
            open={open}
            active={false}
            dropping={dropId === f.id}
            onToggle={() => toggleOpen(f.id)}
            // No grid page behind flow folders — clicking the name just expands it.
            onNavigate={() => toggleOpen(f.id)}
            onDragStart={(e) => startDrag(e, { kind: 'folder', id: f.id })}
            onDragEnd={() => { setDragging(null); setDropId(null); }}
            onDragOver={(e) => onDragOverTarget(e, f.id)}
            onDragLeave={() => setDropId((cur) => (cur === f.id ? null : cur))}
            onDrop={(e) => onDropInto(e, f.id)}
            onRename={(name) => update((d) => renameFolder(d, f.id, name))}
            onDelete={() => doDeleteFolder(f.id)}
          />
          {open && (
            <>
              {renderFolders(f.id, depth + 1)}
              {orderedFlows
                .filter((fl) => resolveItemFolder(folders, itemKeyForFlow(fl.id)) === f.id)
                .map((fl) => renderFlow(fl, depth + 1))}
            </>
          )}
        </React.Fragment>
      );
    });
  }

  const topFolders = childFolders(folders, null);
  const looseFlows = orderedFlows.filter((f) => resolveItemFolder(folders, itemKeyForFlow(f.id)) === null);
  const topLit = dropId === TOP_LEVEL_DROP;

  return (
    <Section
      title="Flow" icon={<IcoFlow />} action={createFlow} actionLabel="+"
      actionTitle="New flow"
      onTitleClick={() => setView({ kind: 'flows-grid' })}
      extraAction={importFlow} extraBusy={importing}
      extraTitle="Import flow from .xlsx" extraIcon={<IcoImport />}
      extraActions={[
        { onClick: () => setAutoFlowOpen(true), icon: <IcoAutoFlow />, title: 'Auto Flow', className: 'ai-glow-ring' },
      ]}
    >
      {/* Anything not dropped on a folder row falls through to here = top level. */}
      <div
        onDragOver={(e) => onDragOverTarget(e, null)}
        onDragLeave={() => setDropId((cur) => (cur === TOP_LEVEL_DROP ? null : cur))}
        onDrop={(e) => onDropInto(e, null)}
        style={{
          borderRadius: 8,
          outline: topLit ? '1.5px dashed rgb(var(--ink-rgb) / 0.4)' : '1.5px dashed transparent',
          outlineOffset: -1,
        }}
      >
        {topFolders.length === 0 && flowsIndex.length === 0 && <Empty>No flows yet</Empty>}
        {renderFolders(null, 0)}
        {looseFlows.map((f) => renderFlow(f, 0))}
      </div>
    </Section>
  );
}

/** Bulk-action bar shown above the tree while a multi-selection (Cmd/Ctrl+click) is active. */
function SelectionBar({ count, folderChoices, onMove, onDelete, onClear }: {
  count: number;
  folderChoices: { id: string; label: string }[];
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);
  useMenuA11y(menuOpen, menuRef, () => setMenuOpen(false));

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 mb-1 rounded-lg text-[11px]"
      style={{ background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)' }}>
      <span className="font-semibold pl-0.5">{count} selected</span>
      <div className="flex-1" />
      <div className="relative" ref={menuRef}>
        <button onClick={() => setMenuOpen((v) => !v)}
          title="Move to folder"
          className="px-2 py-1 rounded-md transition font-medium"
          style={{ background: 'var(--bg-elevated)', color: 'rgb(var(--ink-rgb))' }}>
          Move to
        </button>
        {menuOpen && (
          <div className="glass-popover absolute right-0 top-full mt-1 z-50 rounded-lg py-1 text-xs shadow-xl"
            style={{ minWidth: 170, maxWidth: 260, border: '1px solid var(--border-subtle)' }}>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              <button onClick={() => { onMove(null); setMenuOpen(false); }}
                title="Move to top level"
                className="w-full text-left px-3 py-1.5 transition block"
                style={{ color: 'var(--nav-active-color)' }}
                onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
                onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                Top level (no folder)
              </button>
              {folderChoices.map((f) => (
                <button key={f.id} onClick={() => { onMove(f.id); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 transition truncate block" title={f.label}
                  style={{ color: 'var(--nav-active-color)' }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <button onClick={onDelete} title="Delete selected" className="px-2 py-1 rounded-md transition font-medium" style={{ color: 'rgb(var(--danger-rgb))' }}
        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgb(var(--danger-rgb) / 0.15)'}
        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
        Delete
      </button>
      <button onClick={onClear} title="Clear selection"
        className="w-5 h-5 flex items-center justify-center rounded-md transition"
        style={{ color: 'var(--nav-active-color)' }}
        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
        ✕
      </button>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

interface SectionExtraAction { onClick: () => void; icon: React.ReactNode; title?: string; busy?: boolean; className?: string }

function Section({ title, children, action, actionLabel, actionTitle, icon, defaultOpen = true,
  extraAction, extraIcon, extraTitle, extraBusy, extraActions, onTitleClick }: {
  title: string; children?: React.ReactNode; action?: () => void;
  actionLabel?: string; actionTitle?: string; icon?: React.ReactNode; defaultOpen?: boolean;
  extraAction?: () => void; extraIcon?: React.ReactNode; extraTitle?: string; extraBusy?: boolean;
  /** For a second (or third) icon button beyond the single extraAction slot above — e.g. Flow's Import + Auto Flow buttons. Rendered after extraAction, before the "+" action. */
  extraActions?: SectionExtraAction[];
  /** When set, the title text navigates somewhere instead of toggling; the chevron still collapses. */
  onTitleClick?: () => void;
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
    <div className="mb-1.5">
      <div
        className="w-full px-2 mb-0.5 flex items-center justify-between group"
        style={{ cursor: 'pointer' }}
      >
        <button
          onClick={toggle}
          title={open ? 'Collapse section' : 'Expand section'}
          className="flex items-center gap-1.5 flex-1 min-w-0"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {icon && (
            <span className="sb-ico-14" style={{ color: 'var(--nav-section-color)', display: 'flex' }}>
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
          {onTitleClick ? (
            <span
              role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onTitleClick(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onTitleClick(); } }}
              className="text-[9px] uppercase tracking-[0.2em] font-bold transition"
              style={{ color: 'var(--nav-section-color)' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--nav-active-color)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--nav-section-color)')}
            >
              {title}
            </span>
          ) : (
            <span className="text-[9px] uppercase tracking-[0.2em] font-bold" style={{ color: 'var(--nav-section-color)' }}>
              {title}
            </span>
          )}
        </button>
        {/* gap 5, not 2 — `ai-glow-ring` draws its donut at inset -2px, i.e. 2px
            OUTSIDE the button box, so a 2px gap let the ring butt right up
            against the neighbouring icon and read as misaligned. */}
        <div className="flex items-center" style={{ gap: 5 }}>
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
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 10 10" fill="none">
                  <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 20" strokeLinecap="round" opacity="0.7" />
                </svg>
              ) : <span className="sb-ico-16" style={{ display: 'flex' }}>{extraIcon}</span>}
            </button>
          )}
          {extraActions?.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              disabled={a.busy}
              title={a.title}
              className={`flex items-center justify-center transition rounded${a.className ? ` ${a.className}` : ''}`}
              style={{
                width: 22, height: 22, flexShrink: 0,
                background: 'transparent', border: 'none', cursor: a.busy ? 'default' : 'pointer',
                color: 'var(--nav-section-color)',
              }}
              onMouseEnter={(e) => { if (!a.busy) (e.currentTarget as HTMLElement).style.color = 'var(--nav-active-color)'; }}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.color = 'var(--nav-section-color)'}
            >
              {a.busy ? (
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 10 10" fill="none">
                  <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 20" strokeLinecap="round" opacity="0.7" />
                </svg>
              ) : <span className="sb-ico-16" style={{ display: 'flex' }}>{a.icon}</span>}
            </button>
          ))}
          {action && (
            <button
              onClick={action}
              title={actionTitle}
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
  onDeleteOverride, onRenameOverride, iconEl, moveOptions,
}: {
  active?: boolean; onClick?: () => void; children?: React.ReactNode;
  itemId?: string; itemType?: string; itemName?: string; busyLabel?: string;
  onDeleteOverride?: () => void; onRenameOverride?: (name: string) => void;
  iconEl?: React.ReactNode;
  /**
   * "Move to folder" entries in the item's context menu — a click-driven,
   * always-reachable alternative to dragging. Filing an item into a folder that's
   * currently collapsed (or a folder that's itself buried under a collapsed
   * ancestor) has no drag target to drop on, so drag alone can strand an item
   * with no way to re-file it. This menu works regardless of what's expanded.
   */
  moveOptions?: { key: string; label: string; onClick: () => void }[];
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
  useMenuA11y(menuOpen, menuRef, () => setMenuOpen(false));

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
    <div className="relative mb-px" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {renaming ? (
        <input
          ref={inputRef} value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
          className="w-full px-2.5 py-1 text-xs rounded-lg font-medium outline-none"
          style={{ background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', border: '1px solid var(--border-subtle)' }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          onClick={onClick}
          onDoubleClick={(e) => { e.stopPropagation(); startRenameInline(); }}
          onContextMenu={handleContextMenu}
          className="w-full text-left px-2.5 py-1 text-xs flex items-center gap-2 transition rounded-lg font-medium"
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
        <div ref={menuRef} className="glass-popover absolute left-2 z-50 rounded-lg py-1 text-xs shadow-xl"
          style={{ top: '100%', minWidth: '160px', maxWidth: '240px', border: '1px solid var(--border-subtle)' }}>
          {moveOptions && moveOptions.length > 0 && (
            <>
              <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--nav-inactive-color)', opacity: 0.7 }}>
                Move to
              </div>
              <div style={{ maxHeight: 176, overflowY: 'auto' }}>
                {moveOptions.map((opt) => (
                  <button key={opt.key}
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); opt.onClick(); }}
                    className="w-full text-left px-3 py-1.5 transition truncate block"
                    title={opt.label}
                    style={{ color: 'var(--nav-active-color)' }}
                    onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
                    onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '4px 0' }} />
            </>
          )}
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

// ── Saved compare views ───────────────────────────────────────────────────────

/** Two overlapping pages — a multi-doc compare view. */
function IcoCompareView() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3" width="6" height="10" rx="1.2" />
      <rect x="8.5" y="3" width="6" height="10" rx="1.2" />
    </svg>
  );
}

/**
 * The compare views a user has built (2-3 docs open side by side), listed at
 * the top of Cases so a multi-doc setup is a thing you can return to, not
 * something you have to rebuild pane by pane. Clicking one restores every pane
 * at once; the per-combo layout memory (widths, outline state, sidebar) is
 * restored separately by SpeechDocViewer once the panes are set.
 */
function CompareViewsGroup({ items }: { items: CaseItem[] }) {
  const setView = useApp((s) => s.setView);
  const setExtraDocPane = useApp((s) => s.setExtraDocPane);
  const setFocusedPane = useApp((s) => s.setFocusedPane);
  const view = useApp((s) => s.view);
  const extraDocPanes = useApp((s) => s.extraDocPanes);
  const pushUndoToast = useApp((s) => s.pushUndoToast);

  const [views, setViews] = useState<SavedComboView[]>(() => listComboViews());
  useEffect(() => {
    const reload = () => setViews(listComboViews());
    window.addEventListener(COMBO_LAYOUTS_CHANGED, reload);
    return () => window.removeEventListener(COMBO_LAYOUTS_CHANGED, reload);
  }, []);

  // Display names come from the live Cases list, so a doc renamed in the
  // sidebar or the viewer shows its new name here too. Views referencing a
  // deleted doc are pruned rather than shown as dangling paths.
  const nameFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) if (i.kind === 'speech-doc' && i.path) m.set(i.path, i.name);
    return m;
  }, [items]);

  // Prune views whose docs are gone. Guarded on nameFor being non-empty: this
  // DELETES saved views, and an empty/partial recents read would otherwise wipe
  // every compare view the user has. Only run once we can see real docs.
  useEffect(() => {
    if (nameFor.size > 0) pruneComboViews(new Set(nameFor.keys()));
  }, [nameFor]);

  if (views.length === 0) return null;

  const currentPaths = [
    view.kind === 'speech-doc' ? (view as any).docPath : undefined,
    extraDocPanes[0], extraDocPanes[1],
  ].filter(Boolean).join('␟');

  // Order matters: setView deliberately clears the compare panes (navigating
  // anywhere leaves compare mode), so the extra panes must be set AFTER it to
  // survive. Both run in the same tick, so there's no flash of a single pane.
  function openCombo(paths: string[]) {
    setView({ kind: 'speech-doc', docPath: paths[0] });
    setExtraDocPane(0, paths[1]);
    setExtraDocPane(1, paths[2]);
    setFocusedPane(0);
  }

  return (
    <div className="mb-1 pb-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {views.map((v) => {
        const names = v.paths.map((p) => (nameFor.get(p) ?? p.split(/[/\\]/).pop() ?? p).replace(/\.docx$/i, ''));
        const autoLabel = names.join('  ·  ');
        const label = v.customName || autoLabel;
        const active = currentPaths === v.key;
        return (
          <CompareViewRow
            key={v.key} view={v} label={label} autoLabel={autoLabel} fullNames={names.join('  ·  ')}
            active={active}
            onOpen={() => openCombo(v.paths)}
            onDelete={() => {
              const { key, ...snapshot } = v; // `key` is the map key, not part of the value
              deleteComboView(key);
              pushUndoToast(`Deleted compare view '${label}'`, () => saveComboLayout(key, snapshot));
            }}
          />
        );
      })}
    </div>
  );
}

function CompareViewRow({ view, label, autoLabel, fullNames, active, onOpen, onDelete }: {
  view: SavedComboView; label: string; autoLabel: string; fullNames: string; active: boolean;
  onOpen: () => void; onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [renaming]);

  function startRename() {
    setRenameValue(label);
    setRenaming(true);
  }
  function commitRename() {
    renameComboView(view.key, renameValue === autoLabel ? '' : renameValue);
    setRenaming(false);
  }

  if (renaming) {
    return (
      <div className="relative flex items-center px-2 py-1">
        <input
          ref={inputRef} value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
          className="w-full text-[12.5px] rounded-md px-1.5 py-0.5 outline-none"
          style={{ background: 'var(--nav-active-bg)', color: 'rgb(var(--ink-rgb))', border: '1px solid var(--border-subtle)' }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    );
  }

  return (
    <div className="group relative flex items-center">
      <button
        onClick={onOpen}
        onDoubleClick={(e) => { e.stopPropagation(); startRename(); }}
        title={label === autoLabel ? fullNames : `${label}\n${fullNames}`}
        className="flex-1 flex items-center gap-1.5 min-w-0 text-left text-[12.5px] rounded-md px-2 py-1 transition"
        style={{
          background: active ? 'var(--nav-active-bg)' : 'transparent',
          color: active ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
          border: 'none', cursor: 'pointer',
        }}
        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span className="shrink-0 opacity-70"><IcoCompareView /></span>
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-[10px] tabular-nums opacity-60">{view.paths.length}</span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Remove compare view"
        className="absolute right-1 flex items-center justify-center w-5 h-5 rounded opacity-0 group-hover:opacity-100 transition"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}
      >
        <svg width="11" height="11" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 4l10 10M14 4L4 14" />
        </svg>
      </button>
    </div>
  );
}
