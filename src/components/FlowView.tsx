import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import * as Y from 'yjs';
import { useApp, FlowMeta } from '../store/appStore';
import SharePanel from './SharePanel';
import AnalyzeRound from './AnalyzeRound';
import { createFlowSync, FlowSyncHandle, RemoteCursor, PresenceUser } from '../lib/flowSync';
import { isShortcutDisabled, matchesShortcut } from '../lib/shortcutPrefs';
import {
  seedDoc, docToData, cellText, setYText, metaMap, sheetsArr, sheetCells, findSheet,
  u8ToB64, LOCAL_ORIGIN, REMOTE_ORIGIN, FlowDocData,
} from '../lib/flowDoc';
import { HILITE, HILITE_RGB, cellToHtml, htmlToText, cleanPastedHtml, sanitizeCellHtml, matchRangesIn } from '../lib/cellHtml';

// Highlight-registry names for find hits (see the ::highlight() rules in index.css).
const FIND_HL = 'flow-find';
const FIND_HL_CURRENT = 'flow-find-current';

// Stable per-user cursor color (hash the user id into a fixed palette).
const PRESENCE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#0d9488'];
function colorForUser(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PRESENCE_COLORS[Math.abs(h) % PRESENCE_COLORS.length];
}

// ─── Column definitions ───────────────────────────────────────────────────────

export const POLICY_COLS = ['1AC', '1NC', '2AC', '2NC/1NR', '1AR', '2NR', '2AR'];
export const PF_PRO_FIRST_COLS = ['Pro Case', 'Con Case', 'Con Rebuttal', 'Pro Rebuttal', 'Pro Summary', 'Con Summary', 'Pro FF', 'Con FF'];
export const PF_CON_FIRST_COLS = ['Con Case', 'Pro Case', 'Pro Rebuttal', 'Con Rebuttal', 'Con Summary', 'Pro Summary', 'Con FF', 'Pro FF'];

// Blue = aff/pro, green = neg/con
const POLICY_BLUE = new Set([0, 2, 4, 6]);
const PF_PRO_FIRST_BLUE = new Set([0, 3, 4, 6]);
const PF_CON_FIRST_BLUE = new Set([1, 2, 5, 7]);

// ─── Default sheet names ──────────────────────────────────────────────────────

export const SHEETS_STOCK_ISSUES = ['Inherency', 'Harms', 'Solvency', 'Off 1', 'Off 2', 'Off 3', 'Off 4', 'RFD/Notes'];
export const SHEETS_ADVANTAGE = ['Adv 1', 'Adv 2', 'Adv 3', 'Off 1', 'Off 2', 'Off 3', 'Off 4', 'RFD/Notes'];
export const SHEETS_PF = ['Contention 1', 'Contention 2', 'Turns', 'Off 1', 'Off 2', 'RFD/Notes'];

export const NUM_ROWS = 60;
const DEFAULT_COL_WIDTH = 185;
const DEFAULT_FONT_SIZE = 13;

// ─── Types ────────────────────────────────────────────────────────────────────

export type PolicyVariant = 'stock-issues' | 'advantage';
export type PFOrder = 'pro-first' | 'con-first';

export interface FlowArrow {
  id: string;
  from: string; // "ri-ci"
  to: string;   // "ri-ci"
}

export interface SheetData {
  id: string;
  name: string;
  cells: Record<string, string>;
  arrows?: FlowArrow[];
  // Cell keys ("ri-ci") whose content is an AI-generated summary (Auto Flow's
  // opt-in summary mode). Rendered with the blue→pink AI ring until the user
  // edits the cell, at which point the key is dropped (the content is now theirs).
  aiCells?: string[];
  // A short AI-generated blurb of what's on this tab — built from Auto Flow's
  // opt-in per-card AI summaries (never a fresh API call on its own; see
  // commitWrite in AutoFlow.tsx). Shown in the tab's hover tooltip when present.
  aiSummary?: string;
}

// Exported so features that write into a flow from outside the editor (Auto
// Flow) can build/read this shape without redefining it. Cell keys are
// "ri-ci" (row index-col index); values are HTML strings (see lib/cellHtml.ts
// for what's allowed in them — plain text is also accepted and upgraded).
export interface StoredFlowData {
  event: 'policy' | 'pf';
  variant: PolicyVariant;
  pfOrder: PFOrder;
  sheets: SheetData[];
  columnWidths: number[];
  customColumns: string[] | null;
  columnColors?: (string | null)[];
  fontSize: number;
  zoom: number;
}

// An undo step. Deliberately holds no active-sheet index: which tab is open is
// navigation, not part of the document, and restoring it would move the user.
interface FlowSnapshot {
  sheets: SheetData[];
  columnColors: (string | null)[];
  customColumns: string[] | null;
  columnWidths: number[];
  variant: PolicyVariant;
  pfOrder: PFOrder;
  event: 'policy' | 'pf';
}

const AFF_COLOR_KEY = 'warroom-flow-aff-color';
const NEG_COLOR_KEY = 'warroom-flow-neg-color';
const DEFAULT_AFF_COLOR = '#2563eb';
const DEFAULT_NEG_COLOR = '#16a34a';
const COLOR_SWATCHES = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#9333ea', '#0891b2', '#db2777', '#475569'];

// Cell values are stored as HTML (to support bold/italic/underline/strikethrough
// and highlight). Legacy plain-text values (and AI-written plain text) are
// upgraded on render. The sanitizer and clipboard cleaning live in lib/cellHtml.

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = (hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h || '000000', 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSheets(event: 'policy' | 'pf', variant: PolicyVariant): SheetData[] {
  const names = event === 'pf' ? SHEETS_PF : (variant === 'advantage' ? SHEETS_ADVANTAGE : SHEETS_STOCK_ISSUES);
  return names.map((name) => ({ id: crypto.randomUUID(), name, cells: {} }));
}

export function makeDefaultData(event: 'policy' | 'pf', variant: PolicyVariant, pfOrder: PFOrder): StoredFlowData {
  const cols = event === 'policy' ? POLICY_COLS : (pfOrder === 'pro-first' ? PF_PRO_FIRST_COLS : PF_CON_FIRST_COLS);
  return {
    event, variant, pfOrder,
    sheets: makeSheets(event, variant),
    columnWidths: cols.map(() => DEFAULT_COL_WIDTH),
    customColumns: null,
    fontSize: DEFAULT_FONT_SIZE,
    zoom: 100,
  };
}

function useDarkMode() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function colBg(color: string, isDark: boolean, isHeader: boolean): string {
  const { r, g, b } = hexToRgb(color);
  if (isDark) {
    return `rgba(${r},${g},${b},${isHeader ? 0.34 : 0.12})`;
  }
  return `rgba(${r},${g},${b},${isHeader ? 0.30 : 0.12})`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FlowView() {
  const { view, event, setEvent, flowsIndex, setFlowsIndex, chatOpen, currentUser, currentTeam } = useApp();
  const flowId = view.kind === 'flow' ? (view as any).flowId : undefined;
  const flowMeta: FlowMeta | undefined = flowsIndex.find((f) => f.id === flowId);
  const dark = useDarkMode();

  // ── Core state ────────────────────────────────────────────────────────────

  const [loaded, setLoaded] = useState(false);
  // Bumped to force a full reload from storage (e.g. after Warroom AI edits a cell)
  const [reloadNonce, setReloadNonce] = useState(0);
  // Bumped to remount cell DOM from cellsRef WITHOUT re-reading storage (undo/redo)
  const [cellNonce, setCellNonce] = useState(0);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);

  // Cancel an in-progress arrow draw whenever the active sheet changes. Cell
  // keys are plain "row-col" with no sheet in them, and arrow endpoints are
  // resolved against whatever is currently mounted (see recomputeArrows) — so a
  // source cell armed with ⌘L on one tab, finished on another after switching,
  // silently links to whatever cell happens to sit at that same grid position on
  // the new tab instead of the one the user actually pointed at.
  useEffect(() => { setDrawMode(false); setArrowFrom(null); }, [activeSheetIdx]);
  const [columnWidths, setColumnWidths] = useState<number[]>([]);
  const [customColumns, setCustomColumns] = useState<string[] | null>(null);
  const [columnColors, setColumnColors] = useState<(string | null)[]>([]);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [zoom, setZoom] = useState(100);
  const [variant, setVariant] = useState<PolicyVariant>('stock-issues');
  const [pfOrder, setPfOrder] = useState<PFOrder>('pro-first');

  // Default side colors (set in Settings) — re-read on the colors-changed event.
  const [affColor, setAffColor] = useState(() => localStorage.getItem(AFF_COLOR_KEY) || DEFAULT_AFF_COLOR);
  const [negColor, setNegColor] = useState(() => localStorage.getItem(NEG_COLOR_KEY) || DEFAULT_NEG_COLOR);

  // Find
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findMatches, setFindMatches] = useState<{ sheetIdx: number; key: string }[]>([]);
  const [findIdx, setFindIdx] = useState(0);

  // Arrow draw mode
  const [drawMode, setDrawMode] = useState(false);
  const [arrowFrom, setArrowFrom] = useState<string | null>(null);
  const [arrowGeo, setArrowGeo] = useState<{ id: string; d: string; mx: number; my: number }[]>([]);
  const [hoveredArrow, setHoveredArrow] = useState<string | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────

  const [renamingCol, setRenamingCol] = useState<number | null>(null);
  const [renamingSheet, setRenamingSheet] = useState<number | null>(null);
  const [renamingFlow, setRenamingFlow] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [colMenu, setColMenu] = useState<number | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ ri: number; ci: number } | null>(null);
  const [hoveredGap, setHoveredGap] = useState<{ ri: number; ci: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);

  // ── Live collaboration ──────────────────────────────────────────────────────
  const [live, setLive] = useState(false);              // is this flow live-synced?
  const [liveReady, setLiveReady] = useState(false);    // sync handle attached
  const [liveStarting, setLiveStarting] = useState(false);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const syncRef = useRef<FlowSyncHandle | null>(null);
  const liveRef = useRef(false);                          // mirror for callbacks
  const applyingRemote = useRef(false);                   // guard structural echo

  // ── Refs ──────────────────────────────────────────────────────────────────

  const cellsRef = useRef<Record<string, string>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cellEls = useRef<Record<string, HTMLDivElement | null>>({});
  const resizing = useRef<{ idx: number; startX: number; startW: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Scroll offset per sheet, keyed by sheet id (not index, so deleting or
  // reordering a sheet can't hand one tab another's position). Sheets share one
  // scroll container, so without this, switching tabs keeps wherever you were —
  // scroll to the middle of the Politics DA and the Case sheet opens mid-page.
  const sheetScroll = useRef<Record<string, { top: number; left: number }>>({});
  const gridContentRef = useRef<HTMLDivElement>(null);
  const flowNameInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const focusedCell = useRef<string | null>(null);

  // Undo / redo — snapshots of editable flow state
  const history = useRef<FlowSnapshot[]>([]);
  const histIdx = useRef(-1);
  const restoring = useRef(false);
  // Mirrored to state so the Undo/Redo toolbar buttons can grey out when there's
  // nothing to undo/redo (the underlying counters are refs, which don't re-render).
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  function syncHistButtons() {
    setCanUndo(histIdx.current > 0);
    setCanRedo(histIdx.current < history.current.length - 1);
  }

  // Always-current snapshot for use in async/event callbacks
  const snap = useRef({ sheets, columnWidths, customColumns, columnColors, fontSize, zoom, variant, pfOrder, activeSheetIdx, event: 'policy' as 'policy' | 'pf' });
  useEffect(() => { snap.current = { sheets, columnWidths, customColumns, columnColors, fontSize, zoom, variant, pfOrder, activeSheetIdx, event: flowEvent }; });

  // ── Derived ───────────────────────────────────────────────────────────────

  // Normalize 'ld' to 'policy' — there's no LD-specific flow layout.
  const flowEvent: 'policy' | 'pf' = (flowMeta?.event ?? event) === 'pf' ? 'pf' : 'policy';
  const baseCols = flowEvent === 'policy'
    ? POLICY_COLS
    : (pfOrder === 'pro-first' ? PF_PRO_FIRST_COLS : PF_CON_FIRST_COLS);
  const blueCols = flowEvent === 'policy'
    ? POLICY_BLUE
    : (pfOrder === 'pro-first' ? PF_PRO_FIRST_BLUE : PF_CON_FIRST_BLUE);
  const columns = customColumns ?? baseCols;
  const activeSheet = sheets[activeSheetIdx] ?? sheets[0];

  // Effective base color for a column: explicit override, else the side default.
  function colColor(ci: number): string {
    const override = columnColors[ci];
    if (override) return override;
    return blueCols.has(ci) ? affColor : negColor;
  }

  // Zoom-adjusted display widths (stored widths are logical, unscaled)
  const effectiveWidths = columnWidths.map((w) => Math.round(w * zoom / 100));
  const effectiveFontSize = Math.max(8, Math.round(fontSize * zoom / 100));
  const totalWidth = effectiveWidths.reduce((a, b) => a + b, 0);
  const gridTemplate = effectiveWidths.map((w) => `${w}px`).join(' ');

  // Which cell (in the active sheet) each remote teammate is currently editing.
  const remoteCursorMap = new Map<string, RemoteCursor>();
  remoteCursors.forEach((c) => { if (c.cell) remoteCursorMap.set(c.cell, c); });

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!flowId) return;
    setLoaded(false);
    cellsRef.current = {};
    window.warroom?.storage.read(`flow_data_${flowId}`).then((data: StoredFlowData | null) => {
      // If live sync already took over, don't let this (possibly stale) local
      // mirror clobber the merged doc state.
      if (liveRef.current) { setLoaded(true); return; }
      if (data?.sheets?.length) {
        const ev = data.event ?? flowMeta?.event ?? 'policy';
        const v: PolicyVariant = data.variant ?? 'stock-issues';
        const pfo: PFOrder = data.pfOrder ?? 'pro-first';
        const cols = ev === 'policy' ? POLICY_COLS : (pfo === 'pro-first' ? PF_PRO_FIRST_COLS : PF_CON_FIRST_COLS);
        const custCols = data.customColumns ?? null;
        const colCount = (custCols ?? cols).length;

        setVariant(v);
        setPfOrder(pfo);
        setSheets(data.sheets);
        setColumnWidths(
          data.columnWidths?.length === colCount
            ? data.columnWidths
            : (custCols ?? cols).map(() => DEFAULT_COL_WIDTH)
        );
        setCustomColumns(custCols);
        setColumnColors(
          data.columnColors?.length === colCount ? data.columnColors : (custCols ?? cols).map(() => null)
        );
        setFontSize(data.fontSize ?? DEFAULT_FONT_SIZE);
        setZoom(data.zoom ?? 100);
        cellsRef.current = data.sheets[0]?.cells ?? {};
      } else {
        const rawEv = flowMeta?.event ?? event;
        const ev: 'policy' | 'pf' = rawEv === 'pf' ? 'pf' : 'policy';
        const def = makeDefaultData(ev, 'stock-issues', 'pro-first');
        setVariant('stock-issues');
        setPfOrder('pro-first');
        setSheets(def.sheets);
        setColumnWidths(def.columnWidths);
        setCustomColumns(null);
        setColumnColors(def.columnWidths.map(() => null));
        setFontSize(DEFAULT_FONT_SIZE);
        setZoom(100);
        cellsRef.current = {};
      }
      setActiveSheetIdx(0);
      setLoaded(true);
      history.current = []; histIdx.current = -1;
      requestAnimationFrame(recordHistory);
    }).catch(() => {
      const rawEv = flowMeta?.event ?? event;
      const ev: 'policy' | 'pf' = rawEv === 'pf' ? 'pf' : 'policy';
      const def = makeDefaultData(ev, 'stock-issues', 'pro-first');
      setVariant('stock-issues');
      setPfOrder('pro-first');
      setSheets(def.sheets);
      setColumnWidths(def.columnWidths);
      setCustomColumns(null);
      setColumnColors(def.columnWidths.map(() => null));
      setFontSize(DEFAULT_FONT_SIZE);
      setZoom(100);
      cellsRef.current = {};
      setActiveSheetIdx(0);
      setLoaded(true);
      history.current = []; histIdx.current = -1;
      requestAnimationFrame(recordHistory);
    });
  }, [flowId, reloadNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live reload when Warroom AI (or another writer) edits this flow ─────────
  useEffect(() => {
    if (!flowId) return;
    function onExternalEdit(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.flowId !== flowId) return;
      // Drop any pending local save so it can't clobber the freshly-written data,
      // then force a clean reload from storage (re-mounts cells via reloadNonce).
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      setReloadNonce((n) => n + 1);
    }
    window.addEventListener('warroom-flow-updated', onExternalEdit as EventListener);
    return () => window.removeEventListener('warroom-flow-updated', onExternalEdit as EventListener);
  }, [flowId]);

  // ── Live-update default side colors when changed in Settings ────────────────
  useEffect(() => {
    function onColors() {
      setAffColor(localStorage.getItem(AFF_COLOR_KEY) || DEFAULT_AFF_COLOR);
      setNegColor(localStorage.getItem(NEG_COLOR_KEY) || DEFAULT_NEG_COLOR);
    }
    window.addEventListener('warroom-flow-colors-changed', onColors);
    return () => window.removeEventListener('warroom-flow-colors-changed', onColors);
  }, []);

  // ── Global shortcuts: find (⌘F), undo (⌘Z), redo (⌘⇧Z) ─────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!flowId) return;
      if (e.key === 'Escape') {
        if (drawMode) { setDrawMode(false); setArrowFrom(null); }
        else if (findOpen) closeFind();
        return;
      }
      if (matchesShortcut(e, 'find-page')) {
        e.preventDefault();
        setFindOpen(true);
        setTimeout(() => findInputRef.current?.focus(), 0);
      } else if (matchesShortcut(e, 'flow-undo')) {
        e.preventDefault(); undo();
      } else if (matchesShortcut(e, 'flow-redo')) {
        e.preventDefault(); redo();
      } else if (matchesShortcut(e, 'flow-sheet-new')) {
        e.preventDefault(); addSheet();
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        // ⌘1–8 pick a sheet by position; ⌘9 jumps to the last one (browser-tab
        // convention), so it still lands somewhere useful with >9 sheets. Not
        // individually rebindable — it's a range, not one combo — but still
        // respects the disable toggle.
        if (isShortcutDisabled('flow-sheet-switch')) return;
        const all = snap.current.sheets;
        const n = Number(e.key);
        const idx = n === 9 ? all.length - 1 : n - 1;
        if (idx < 0 || idx >= all.length) return;
        e.preventDefault();
        switchSheet(idx);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flowId, drawMode, findOpen, sheets, activeSheetIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist ───────────────────────────────────────────────────────────────

  function persist(overrides: Partial<StoredFlowData> = {}) {
    if (!flowId) return;
    const s = snap.current;
    const flushedSheets = s.sheets.map((sh, i) =>
      i === s.activeSheetIdx ? { ...sh, cells: { ...cellsRef.current } } : sh
    );
    const payload = {
      event: flowMeta?.event ?? event,
      variant: s.variant,
      pfOrder: s.pfOrder,
      sheets: flushedSheets,
      columnWidths: s.columnWidths,
      customColumns: s.customColumns,
      columnColors: s.columnColors,
      fontSize: s.fontSize,
      zoom: s.zoom,
      ...overrides,
    } as StoredFlowData;
    // Local mirror — keeps the flow in the sidebar and working offline even when live.
    window.warroom?.storage.write(`flow_data_${flowId}`, payload);
    // When live, mirror layout/structure into the Y.Doc so the shared snapshot
    // carries it and teammates re-render. Cell *text* is synced separately, per
    // keystroke, so we deliberately don't push cells here (would clobber merges).
    if (liveRef.current && !applyingRemote.current) syncStructureToDoc(payload);
  }

  // ── Live: structure ↔ Y.Doc ────────────────────────────────────────────────
  // Mirror meta + sheet identity/names into the doc (not cell text). Reconciles
  // the sheets Y.Array by stable id so renames/adds/removes propagate.
  function syncStructureToDoc(data: StoredFlowData) {
    const handle = syncRef.current;
    if (!handle) return;
    const doc = handle.doc;
    doc.transact(() => {
      const meta = metaMap(doc);
      meta.set('event', data.event);
      meta.set('variant', data.variant);
      meta.set('pfOrder', data.pfOrder);
      meta.set('fontSize', data.fontSize);
      meta.set('zoom', data.zoom);
      meta.set('customColumns', data.customColumns ?? null);
      meta.set('columnWidths', data.columnWidths);
      meta.set('columnColors', data.columnColors ?? []);

      const arr = sheetsArr(doc);
      const haveIds = new Set<string>();
      for (let i = 0; i < arr.length; i++) haveIds.add(arr.get(i).get('id'));
      // add / rename
      data.sheets.forEach((sh) => {
        let sm: Y.Map<any> | null = null;
        for (let i = 0; i < arr.length; i++) { const m = arr.get(i); if (m.get('id') === sh.id) { sm = m; break; } }
        if (!sm) {
          sm = new Y.Map();
          sm.set('id', sh.id);
          sm.set('name', sh.name);
          sm.set('cells', new Y.Map<Y.Text>());
          sm.set('arrows', new Y.Array());
          arr.push([sm]);
        } else if (sm.get('name') !== sh.name) {
          sm.set('name', sh.name);
        }
        haveIds.delete(sh.id);
      });
      // remove sheets that no longer exist locally
      if (haveIds.size) {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (haveIds.has(arr.get(i).get('id'))) arr.delete(i, 1);
        }
      }
    }, LOCAL_ORIGIN);
  }

  // Push one cell's HTML into its Y.Text (realtime, per keystroke).
  function pushLiveCell(key: string, html: string) {
    const handle = syncRef.current;
    if (!liveRef.current || !handle || applyingRemote.current) return;
    const sheetId = snap.current.sheets[snap.current.activeSheetIdx]?.id;
    if (!sheetId) return;
    const t = cellText(handle.doc, sheetId, key);
    if (t) setYText(t, html, LOCAL_ORIGIN);
  }

  // Build the current flow's plain data (for seeding a fresh live doc).
  function currentDataForDoc(): FlowDocData {
    const s = snap.current;
    const sheets = s.sheets.map((sh, i) => ({
      id: sh.id, name: sh.name,
      cells: i === s.activeSheetIdx ? { ...cellsRef.current } : { ...sh.cells },
      arrows: [...(sh.arrows ?? [])],
    }));
    return {
      event: (flowMeta?.event === 'pf' ? 'pf' : 'policy'),
      variant: s.variant, pfOrder: s.pfOrder, sheets,
      columnWidths: [...s.columnWidths], customColumns: s.customColumns ? [...s.customColumns] : null,
      columnColors: [...s.columnColors], fontSize: s.fontSize, zoom: s.zoom,
    };
  }

  // Replace local React state + cell DOM from the Y.Doc (initial hydrate on join,
  // and a coarse rebuild when a remote *structural* change lands).
  function hydrateFromDoc(doc: Y.Doc, opts: { remountCells: boolean } = { remountCells: true }) {
    const data = docToData(doc);
    if (!data) return;
    applyingRemote.current = true;
    try {
      const cols = data.event === 'policy' ? POLICY_COLS : (data.pfOrder === 'pro-first' ? PF_PRO_FIRST_COLS : PF_CON_FIRST_COLS);
      const colCount = (data.customColumns ?? cols).length;
      setVariant(data.variant);
      setPfOrder(data.pfOrder);
      setSheets(data.sheets as any);
      setColumnWidths(data.columnWidths?.length === colCount ? data.columnWidths : (data.customColumns ?? cols).map(() => DEFAULT_COL_WIDTH));
      setCustomColumns(data.customColumns);
      setColumnColors(data.columnColors?.length === colCount ? data.columnColors : (data.customColumns ?? cols).map(() => null));
      setFontSize(data.fontSize); setZoom(data.zoom);
      const idx = Math.min(snap.current.activeSheetIdx, data.sheets.length - 1);
      cellsRef.current = { ...(data.sheets[idx]?.cells ?? {}) };
      if (opts.remountCells) setCellNonce((n) => n + 1);
    } finally {
      // release on the next tick so setState-driven persists don't echo back
      requestAnimationFrame(() => { applyingRemote.current = false; });
    }
  }

  // Apply a single remote cell-text change straight to the DOM (no remount, so
  // neither user loses their caret). We never overwrite the cell *this* user is
  // focused in — same-cell concurrent edits reconcile on blur instead.
  function patchRemoteCell(key: string, html: string) {
    // Remote HTML is untrusted (any teammate — or anyone who reached the live
    // broadcast channel — can send it), so sanitize before it touches the DOM
    // or our local mirror.
    const clean = sanitizeCellHtml(html || '');
    cellsRef.current[key] = clean;
    if (focusedCell.current === key) return;
    const el = cellEls.current[key];
    if (el) { el.innerHTML = clean; el.dataset.init = '1'; }
  }

  // ── Live lifecycle: attach / detach the sync handle ─────────────────────────
  useEffect(() => {
    if (!flowId || !live || !currentUser || !currentTeam) return;
    let cancelled = false;
    let handle: FlowSyncHandle | null = null;
    setLiveStarting(true);
    (async () => {
      const me: PresenceUser = { id: currentUser.id, name: currentUser.displayName, color: colorForUser(currentUser.id) };
      try {
        handle = await createFlowSync(flowId, currentTeam.id, flowMeta?.name ?? 'Flow', me);
      } catch {
        if (!cancelled) { setLiveStarting(false); setLive(false); }
        return;
      }
      if (cancelled) { handle.destroy(); return; }
      syncRef.current = handle;
      liveRef.current = true;
      // If the doc already has content (snapshot or a peer), adopt it. Otherwise
      // we're the first writer — seed it from what we already have on screen.
      if (!docToData(handle.doc)) seedDoc(handle.doc, currentDataForDoc(), cellToHtml);
      else hydrateFromDoc(handle.doc, { remountCells: true });
      handle.onCursors((c) => { if (!cancelled) setRemoteCursors(c); });
      setLiveReady(true);
      setLiveStarting(false);
    })();
    return () => {
      cancelled = true;
      liveRef.current = false;
      setLiveReady(false);
      setRemoteCursors([]);
      syncRef.current = null;
      handle?.destroy();
    };
  }, [flowId, live, currentUser?.id, currentTeam?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-enter live mode for a flow already marked live.
  useEffect(() => { setLive(!!flowMeta?.live); }, [flowId, flowMeta?.live]);

  // ── Live observers: meta/sheets (structural) + active-sheet cells (text) ─────
  useEffect(() => {
    const handle = syncRef.current;
    if (!liveReady || !handle) return;
    const doc = handle.doc;
    const onMeta = (_e: any, tr: Y.Transaction) => { if (tr.origin === REMOTE_ORIGIN) hydrateFromDoc(doc, { remountCells: false }); };
    const onSheets = (_e: any, tr: Y.Transaction) => { if (tr.origin === REMOTE_ORIGIN) hydrateFromDoc(doc, { remountCells: true }); };
    metaMap(doc).observe(onMeta);
    sheetsArr(doc).observe(onSheets);
    return () => { metaMap(doc).unobserve(onMeta); sheetsArr(doc).unobserve(onSheets); };
  }, [liveReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Observe the *active* sheet's cells; patch remote text edits into the DOM.
  useEffect(() => {
    const handle = syncRef.current;
    const sheetId = activeSheet?.id;
    if (!liveReady || !handle || !sheetId) return;
    const sheet = findSheet(handle.doc, sheetId);
    if (!sheet) return;
    const cells = sheetCells(sheet);
    const onCells = (events: any[], tr: Y.Transaction) => {
      if (tr.origin !== REMOTE_ORIGIN) return;
      applyingRemote.current = true;
      try {
        events.forEach((ev: any) => {
          if (ev.target instanceof Y.Text && ev.path.length >= 1) {
            patchRemoteCell(String(ev.path[ev.path.length - 1]), ev.target.toString());
          } else if (ev.target === cells && ev.changes?.keys) {
            ev.changes.keys.forEach((_chg: any, key: string) => {
              const t = cells.get(key); patchRemoteCell(key, t ? t.toString() : '');
            });
          }
        });
      } finally { requestAnimationFrame(() => { applyingRemote.current = false; }); }
    };
    cells.observeDeep(onCells);
    return () => cells.unobserveDeep(onCells);
  }, [liveReady, activeSheet?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Go live / leave ─────────────────────────────────────────────────────────
  async function startLiveCollab(): Promise<boolean> {
    if (!flowId || !currentTeam || !currentUser) return false;
    setLiveStarting(true);
    const data = currentDataForDoc();
    const seed = new Y.Doc();
    seedDoc(seed, data, cellToHtml);
    const res = await window.warroom.flowSync.promote(flowId, currentTeam.id, flowMeta?.name ?? 'Flow', u8ToB64(Y.encodeStateAsUpdate(seed)));
    seed.destroy();
    if (!res.ok) { setLiveStarting(false); return false; }
    updateFlowMeta({ live: true, teamId: currentTeam.id });
    setLive(true); // the lifecycle effect picks it up
    return true;
  }
  function stopLiveCollab() {
    updateFlowMeta({ live: false });
    setLive(false);
  }

  // ── Undo / redo ──────────────────────────────────────────────────────────
  function takeSnapshot(): FlowSnapshot {
    const s = snap.current;
    const sheets = s.sheets.map((sh, i) => ({
      ...sh,
      cells: i === s.activeSheetIdx ? { ...cellsRef.current } : { ...sh.cells },
      arrows: [...(sh.arrows ?? [])],
    }));
    return {
      sheets,
      columnColors: [...s.columnColors],
      customColumns: s.customColumns ? [...s.customColumns] : null,
      columnWidths: [...s.columnWidths],
      variant: s.variant,
      pfOrder: s.pfOrder,
      event: s.event,
    };
  }

  function recordHistory() {
    if (restoring.current) return;
    const snapshot = takeSnapshot();
    history.current = history.current.slice(0, histIdx.current + 1);
    history.current.push(snapshot);
    if (history.current.length > 120) history.current.shift();
    histIdx.current = history.current.length - 1;
    syncHistButtons();
  }

  function restoreSnapshot(s: FlowSnapshot) {
    restoring.current = true;
    // Stay on the tab the user is looking at. Undo is for edits, not navigation:
    // switching tabs records no snapshot, so an older one still carries whatever
    // tab happened to be open when it was taken — restoring that index yanked you
    // back to tab 1 for undoing an edit you made on tab 2. Clamp, because undoing
    // an "add sheet" can delete the tab we're standing on.
    const idx = Math.max(0, Math.min(snap.current.activeSheetIdx, s.sheets.length - 1));
    setCustomColumns(s.customColumns);
    setColumnWidths(s.columnWidths);
    setColumnColors(s.columnColors);
    setVariant(s.variant);
    setPfOrder(s.pfOrder);
    setSheets(s.sheets);
    setActiveSheetIdx(idx);
    // Event lives in the flow index (global store) — restore it if it changed.
    if ((flowMeta?.event === 'pf' ? 'pf' : 'policy') !== s.event) {
      setEvent(s.event);
      updateFlowMeta({ event: s.event });
    }
    cellsRef.current = { ...(s.sheets[idx]?.cells ?? {}) };
    snap.current = { ...snap.current, sheets: s.sheets, columnColors: s.columnColors, customColumns: s.customColumns, columnWidths: s.columnWidths, activeSheetIdx: idx, variant: s.variant, pfOrder: s.pfOrder };
    persist({ sheets: s.sheets, columnColors: s.columnColors, customColumns: s.customColumns, columnWidths: s.columnWidths, variant: s.variant, pfOrder: s.pfOrder, event: s.event });
    setCellNonce((n) => n + 1);
    requestAnimationFrame(recomputeArrows);
    setTimeout(() => { restoring.current = false; }, 0);
  }

  function undo() {
    if (histIdx.current > 0) { histIdx.current -= 1; restoreSnapshot(history.current[histIdx.current]); syncHistButtons(); }
  }
  function redo() {
    if (histIdx.current < history.current.length - 1) { histIdx.current += 1; restoreSnapshot(history.current[histIdx.current]); syncHistButtons(); }
  }

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const s = snap.current;
      const updated = s.sheets.map((sh, i) =>
        i === s.activeSheetIdx ? { ...sh, cells: { ...cellsRef.current } } : sh
      );
      setSheets(updated);
      snap.current = { ...snap.current, sheets: updated };
      persist({ sheets: updated });
      recordHistory();
    }, 600);
  }

  // ── Cell input / keyboard ─────────────────────────────────────────────────

  // Drop a cell from the active sheet's AI-summary set (removes its ring) — once
  // the user edits an AI-written cell, the content is theirs, not the AI's.
  function clearAiCell(key: string) {
    const s = snap.current;
    const sh = s.sheets[s.activeSheetIdx];
    if (!sh?.aiCells?.includes(key)) return;
    const updated = s.sheets.map((x, i) =>
      i === s.activeSheetIdx ? { ...x, aiCells: (x.aiCells ?? []).filter((k) => k !== key) } : x
    );
    setSheets(updated);
    snap.current = { ...snap.current, sheets: updated };
  }

  function handleInput(ri: number, ci: number, e: React.FormEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const key = `${ri}-${ci}`;
    cellsRef.current[key] = el.innerHTML;
    clearAiCell(key);
    pushLiveCell(key, el.innerHTML);
    scheduleSave();
  }

  // Word and Google Docs put fully-styled HTML on the clipboard — font family,
  // point size, and an explicit ink color. Pasting that natively drags all of it
  // into the cell, so a tag copied out of a speech doc lands in the wrong font at
  // the wrong size, and (from a dark-themed doc) in white-on-white. Intercept the
  // paste and insert a cleaned copy: emphasis survives, everything else inherits
  // the cell's own styling.
  function handlePaste(ri: number, ci: number, e: React.ClipboardEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (!html && !text) return;
    e.preventDefault();
    const insert = cleanPastedHtml(html, text);
    if (!insert) return;
    document.execCommand('insertHTML', false, insert);
    const key = `${ri}-${ci}`;
    cellsRef.current[key] = el.innerHTML;
    pushLiveCell(key, el.innerHTML);
    scheduleSave();
  }

  // Apply rich-text emphasis to the focused cell (toolbar buttons).
  // Buttons call this from onMouseDown(preventDefault) so the cell keeps focus
  // and its selection, letting execCommand act on the selected text.
  function applyFormat(cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'highlight') {
    const key = focusedCell.current;
    const el = key ? cellEls.current[key] : null;
    if (!key || !el) return;
    el.focus();
    if (cmd === 'highlight') toggleHighlight();
    else document.execCommand(cmd);
    cellsRef.current[key] = el.innerHTML;
    pushLiveCell(key, el.innerHTML);
    scheduleSave();
  }

  // Highlight is a background-color span rather than an execCommand flag, so it
  // has no built-in toggle — read the caret's current background and clear it if
  // it is already ours. styleWithCSS keeps this as an inline style the cell
  // sanitizer allows (background-color) instead of a legacy <font> attribute.
  function toggleHighlight() {
    document.execCommand('styleWithCSS', false, 'true');
    const cur = (document.queryCommandValue('backColor') || '').replace(/\s/g, '').toLowerCase();
    const on = cur === HILITE_RGB || cur === HILITE;
    document.execCommand('hiliteColor', false, on ? 'transparent' : HILITE);
    document.execCommand('styleWithCSS', false, 'false');
  }

  // Screen rect of a collapsed range. Chromium gives a zero-width rect at the
  // caret; an empty cell yields an all-zero rect, so fall back to the cell box.
  function rectOf(range: Range, el: HTMLElement): DOMRect {
    const r = range.getBoundingClientRect();
    if (!r.top && !r.bottom && !r.left) return el.getBoundingClientRect();
    return r;
  }

  // Is the caret on the cell's first / last *visual* line? Compared by y against
  // a caret placed at the very start / end of the cell, because wrapped lines
  // have no node boundary to test — only a position on screen.
  function caretOnEdgeLine(el: HTMLDivElement, edge: 'first' | 'last'): boolean {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return true;
    const cur = rectOf(sel.getRangeAt(0), el);
    const probe = document.createRange();
    probe.selectNodeContents(el);
    probe.collapse(edge === 'first');
    const target = rectOf(probe, el);
    // Half a line of tolerance: same line ⇒ same top, next line ⇒ a full line away.
    return Math.abs(cur.top - target.top) < Math.max(4, cur.height * 0.5);
  }

  // Focus a cell and place the caret at its start or end.
  function focusCell(key: string, place: 'start' | 'end' = 'end') {
    const el = cellEls.current[key];
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(place === 'start');
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function handleKeyDown(ri: number, ci: number, e: React.KeyboardEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;

    // Rich-text emphasis — ⌘B / ⌘I / ⌘U
    if (matchesShortcut(e, 'flow-bold') || matchesShortcut(e, 'flow-italic') || matchesShortcut(e, 'flow-underline')) {
      e.preventDefault();
      const cmd = matchesShortcut(e, 'flow-bold') ? 'bold' : matchesShortcut(e, 'flow-italic') ? 'italic' : 'underline';
      document.execCommand(cmd);
      cellsRef.current[`${ri}-${ci}`] = el.innerHTML; pushLiveCell(`${ri}-${ci}`, el.innerHTML); scheduleSave();
      return;
    }
    if (matchesShortcut(e, 'flow-strike')) {
      e.preventDefault();
      document.execCommand('strikeThrough');
      cellsRef.current[`${ri}-${ci}`] = el.innerHTML; pushLiveCell(`${ri}-${ci}`, el.innerHTML); scheduleSave();
      return;
    }
    if (matchesShortcut(e, 'flow-highlight')) {
      e.preventDefault();
      toggleHighlight();
      cellsRef.current[`${ri}-${ci}`] = el.innerHTML; pushLiveCell(`${ri}-${ci}`, el.innerHTML); scheduleSave();
      return;
    }
    // Arrow line — ⌘L from the source cell, then ⌘L (or click) on the target
    if (matchesShortcut(e, 'flow-link')) {
      e.preventDefault();
      linkCell(`${ri}-${ci}`);
      return;
    }
    // Move this cell's content up/down a row (swaps with its neighbour). Not
    // individually rebindable — it's a pair (up + down), not one combo — but
    // still respects the disable toggle.
    if (mod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (isShortcutDisabled('flow-move-row')) return;
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 'down' : 'up';
      const t = dir === 'down' ? ri + 1 : ri - 1;
      if (t < 0 || t >= NUM_ROWS) return;
      moveCell(ri, ci, dir);
      focusCell(`${t}-${ci}`);
      return;
    }
    if (mod) return; // let ⌘Z/⌘F/⌘A etc. bubble to global handlers

    if (e.key === 'Tab') {
      e.preventDefault();
      const next = e.shiftKey ? ci - 1 : ci + 1;
      if (next >= 0 && next < columns.length) focusCell(`${ri}-${next}`);
      else if (!e.shiftKey && ri < NUM_ROWS - 1) focusCell(`${ri + 1}-0`);
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      cellsRef.current[`${ri}-${ci}`] = el.innerHTML; pushLiveCell(`${ri}-${ci}`, el.innerHTML); scheduleSave();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (ri < NUM_ROWS - 1) focusCell(`${ri + 1}-${ci}`, 'start');
    // Up / Down move a line within the cell, and only leave it once there is no
    // line left to go to. Left / Right are never intercepted — they always just
    // move the caret through the text (Tab moves between columns).
    } else if (e.key === 'ArrowUp') {
      if (ri > 0 && caretOnEdgeLine(el, 'first')) { e.preventDefault(); focusCell(`${ri - 1}-${ci}`); }
    } else if (e.key === 'ArrowDown') {
      if (ri < NUM_ROWS - 1 && caretOnEdgeLine(el, 'last')) { e.preventDefault(); focusCell(`${ri + 1}-${ci}`, 'start'); }
    }
  }

  // ── Cell move ─────────────────────────────────────────────────────────────

  function moveCell(ri: number, ci: number, dir: 'up' | 'down') {
    const targetRi = dir === 'up' ? ri - 1 : ri + 1;
    if (targetRi < 0 || targetRi >= NUM_ROWS) return;
    const key = `${ri}-${ci}`;
    const targetKey = `${targetRi}-${ci}`;
    const a = cellsRef.current[key] ?? '';
    const b = cellsRef.current[targetKey] ?? '';
    cellsRef.current[key] = b;
    cellsRef.current[targetKey] = a;
    // Update DOM without re-render
    const el = cellEls.current[key];
    const targetEl = cellEls.current[targetKey];
    if (el) el.innerHTML = cellToHtml(b);
    if (targetEl) targetEl.innerHTML = cellToHtml(a);
    pushLiveCell(key, cellToHtml(b));
    pushLiveCell(targetKey, cellToHtml(a));
    // Swap the AI-ring membership so it follows the moved content.
    const sh = snap.current.sheets[snap.current.activeSheetIdx];
    const ai = sh?.aiCells ?? [];
    const keyAi = ai.includes(key), targetAi = ai.includes(targetKey);
    if (keyAi !== targetAi) {
      const next = ai.filter((k) => k !== key && k !== targetKey);
      if (keyAi) next.push(targetKey);
      if (targetAi) next.push(key);
      const updated = snap.current.sheets.map((x, i) => i === snap.current.activeSheetIdx ? { ...x, aiCells: next } : x);
      setSheets(updated);
      snap.current = { ...snap.current, sheets: updated };
    }
    scheduleSave();
  }

  // Insert a blank cell between rows `afterRi` and `afterRi+1` in a single column,
  // pushing that column's cells (and any arrow endpoints in it) down one. Single
  // column, not a full row — matches the hover "+" between two stacked cells: you
  // slot a missed argument into one speech's column without disturbing the others.
  function insertRowBetween(afterRi: number, ci: number) {
    const insertAt = afterRi + 1;
    if (insertAt >= NUM_ROWS) return;
    // Shift bottom-up so we never overwrite a source before copying it.
    const cells = { ...cellsRef.current };
    for (let r = NUM_ROWS - 1; r > insertAt; r--) {
      const src = cells[`${r - 1}-${ci}`];
      if (src !== undefined) cells[`${r}-${ci}`] = src; else delete cells[`${r}-${ci}`];
    }
    delete cells[`${insertAt}-${ci}`]; // the new blank
    cellsRef.current = cells;

    // Move arrow endpoints in this column at/below the insert point down with it.
    const bump = (key: string) => {
      const [rs, cs] = key.split('-'); const r = Number(rs), c = Number(cs);
      if (c === ci && r >= insertAt && r < NUM_ROWS - 1) return `${r + 1}-${c}`;
      return key;
    };
    const s = snap.current;
    const updated = s.sheets.map((sh, i) =>
      i === s.activeSheetIdx
        ? {
            ...sh, cells: { ...cells },
            arrows: (sh.arrows ?? []).map((a) => ({ ...a, from: bump(a.from), to: bump(a.to) })),
            aiCells: sh.aiCells?.map(bump),
          }
        : sh
    );
    setSheets(updated);
    snap.current = { ...snap.current, sheets: updated };
    persist({ sheets: updated });
    recordHistory();
    if (liveRef.current) {
      for (let r = insertAt; r < NUM_ROWS; r++) pushLiveCell(`${r}-${ci}`, cellToHtml(cells[`${r}-${ci}`] ?? ''));
    }
    setCellNonce((n) => n + 1);
    requestAnimationFrame(recomputeArrows);
  }

  // ── Column resize ─────────────────────────────────────────────────────────

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizing.current) return;
      const { idx, startX, startW } = resizing.current;
      // delta in screen px → logical px (divide by zoom factor)
      const logicalDelta = (e.clientX - startX) * 100 / snap.current.zoom;
      const newW = Math.max(60, Math.round(startW + logicalDelta));
      setColumnWidths((prev) => { const n = [...prev]; n[idx] = newW; return n; });
    }
    function onUp() {
      if (!resizing.current) return;
      resizing.current = null;
      persist();
      requestAnimationFrame(recomputeArrows);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Restore each sheet's own scroll offset when it becomes active ──────────
  // Layout effect, so the jump happens before paint rather than as a visible
  // flick. A sheet never visited lands at the top, which is what you want when
  // an off-case tab opens for the first time.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !loaded) return;
    const id = sheets[activeSheetIdx]?.id;
    const pos = id ? sheetScroll.current[id] : null;
    el.scrollTop = pos?.top ?? 0;
    el.scrollLeft = pos?.left ?? 0;
  }, [activeSheetIdx, loaded, reloadNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Recompute arrow geometry when layout/content changes ──────────────────
  useLayoutEffect(() => {
    recomputeArrows();
  }, [loaded, reloadNonce, cellNonce, activeSheetIdx, zoom, fontSize, customColumns, columnWidths, sheets, findOpen, drawMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Col menu close on outside click ──────────────────────────────────────

  useEffect(() => {
    if (colMenu === null) return;
    function h(e: MouseEvent) { if (!(e.target as HTMLElement).closest('[data-col-menu]')) setColMenu(null); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [colMenu]);

  // ── Column ops ────────────────────────────────────────────────────────────

  function startRenameCol(ci: number) { setColMenu(null); setRenamingCol(ci); setRenameValue(columns[ci]); }
  function commitRenameCol() {
    if (renamingCol === null) return;
    const next = [...columns]; next[renamingCol] = renameValue.trim() || columns[renamingCol];
    setCustomColumns(next); setRenamingCol(null); persist({ customColumns: next }); recordHistory();
  }
  function colorsForCount(n: number): (string | null)[] {
    const cur = snap.current.columnColors;
    return Array.from({ length: n }, (_, i) => cur[i] ?? null);
  }
  function insertColumn(at: number) {
    setColMenu(null);
    const next = [...columns]; next.splice(at, 0, `Col ${next.length + 1}`);
    const newW = [...snap.current.columnWidths]; newW.splice(at, 0, DEFAULT_COL_WIDTH);
    const newC = [...snap.current.columnColors]; newC.splice(at, 0, null);
    setCustomColumns(next); setColumnWidths(newW); setColumnColors(newC);
    persist({ customColumns: next, columnWidths: newW, columnColors: newC }); recordHistory();
  }
  function deleteColumn(ci: number) {
    setColMenu(null);
    if (columns.length <= 2) return;
    const next = columns.filter((_, i) => i !== ci);
    const newW = snap.current.columnWidths.filter((_, i) => i !== ci);
    const newC = snap.current.columnColors.filter((_, i) => i !== ci);
    setCustomColumns(next); setColumnWidths(newW); setColumnColors(newC);
    persist({ customColumns: next, columnWidths: newW, columnColors: newC }); recordHistory();
  }
  function setColumnColor(ci: number, color: string | null) {
    setColMenu(null);
    const newC = colorsForCount(columns.length); newC[ci] = color;
    setColumnColors(newC);
    persist({ columnColors: newC }); recordHistory();
  }
  function resetColumns() {
    setCustomColumns(null);
    const defW = baseCols.map(() => DEFAULT_COL_WIDTH);
    const defC = baseCols.map(() => null);
    setColumnWidths(defW); setColumnColors(defC);
    persist({ customColumns: null, columnWidths: defW, columnColors: defC }); recordHistory();
  }

  // ── Arrows ────────────────────────────────────────────────────────────────
  function setActiveSheetArrows(updater: (arrows: FlowArrow[]) => FlowArrow[]) {
    const s = snap.current;
    const updated = s.sheets.map((sh, i) =>
      i === s.activeSheetIdx ? { ...sh, arrows: updater(sh.arrows ?? []) } : sh
    );
    setSheets(updated);
    snap.current = { ...snap.current, sheets: updated };
    persist({ sheets: updated }); recordHistory();
    requestAnimationFrame(recomputeArrows);
  }
  function handleArrowCellClick(cellKey: string) {
    if (!drawMode) return;
    if (!arrowFrom) { setArrowFrom(cellKey); return; }
    if (arrowFrom === cellKey) { setArrowFrom(null); setDrawMode(false); return; }
    const from = arrowFrom;
    setActiveSheetArrows((arr) => [...arr, { id: crypto.randomUUID(), from, to: cellKey }]);
    setArrowFrom(null);
    setDrawMode(false);
  }
  // Keyboard arrow-drawing (⌘L): first call marks the source, second draws to
  // the target. Draw mode stays on in between so the target can also be clicked.
  function linkCell(cellKey: string) {
    if (!arrowFrom) { setArrowFrom(cellKey); setDrawMode(true); return; }
    if (arrowFrom === cellKey) { setArrowFrom(null); setDrawMode(false); return; }
    const from = arrowFrom;
    setActiveSheetArrows((arr) => [...arr, { id: crypto.randomUUID(), from, to: cellKey }]);
    setArrowFrom(null);
    setDrawMode(false);
  }
  function deleteArrow(id: string) {
    setActiveSheetArrows((arr) => arr.filter((a) => a.id !== id));
  }
  function recomputeArrows() {
    const content = gridContentRef.current;
    const arrows = snap.current.sheets[snap.current.activeSheetIdx]?.arrows ?? [];
    if (!content || arrows.length === 0) { setArrowGeo([]); return; }
    const base = content.getBoundingClientRect();
    const geo: { id: string; d: string; mx: number; my: number }[] = [];
    for (const a of arrows) {
      const fe = cellEls.current[a.from];
      const te = cellEls.current[a.to];
      if (!fe || !te) continue;
      const fr = fe.getBoundingClientRect();
      const tr = te.getBoundingClientRect();

      // Same column (an answer stacked below/above the card it answers, one row
      // over because the aligned row was already taken): a left/right-edge curve
      // doesn't make sense here — source and target share the same x, so treat
      // it as a vertical bracket instead. Both ends anchor on the SAME edge (the
      // column's right side) and jog out by a small FIXED distance, independent
      // of how far apart the rows are — otherwise a large vertical gap stretches
      // the curve into a huge lopsided hook (this used to anchor the far end on
      // the opposite edge, which is what caused that).
      const sameColumn = Math.abs(fr.left - tr.left) < 2;
      let x1: number, y1: number, x2: number, y2: number, c1x: number, c2x: number, c1y: number, c2y: number;
      if (sameColumn) {
        const jog = 20;
        x1 = fr.right - base.left; y1 = fr.top + fr.height / 2 - base.top;
        x2 = tr.right - base.left; y2 = tr.top + tr.height / 2 - base.top;
        c1x = x1 + jog; c1y = y1;
        c2x = x2 + jog; c2y = y2;
      } else {
        // Start at right-center of source, end at left-center of target
        // (flip to left/right if target is to the left).
        const targetRight = tr.left + tr.width / 2 < fr.left + fr.width / 2;
        x1 = (targetRight ? fr.left : fr.right) - base.left;
        y1 = fr.top + fr.height / 2 - base.top;
        x2 = (targetRight ? tr.right : tr.left) - base.left;
        y2 = tr.top + tr.height / 2 - base.top;
        const dx = Math.max(30, Math.abs(x2 - x1) * 0.4);
        c1x = x1 + (targetRight ? -dx : dx); c1y = y1;
        c2x = x2 + (targetRight ? dx : -dx); c2y = y2;
      }
      geo.push({
        id: a.id,
        d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
        mx: (x1 + x2) / 2,
        my: (y1 + y2) / 2,
      });
    }
    setArrowGeo(geo);
  }

  // ── Find ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!findOpen || !findQuery.trim()) { setFindMatches([]); setFindIdx(0); return; }
    const q = findQuery.toLowerCase();
    const out: { sheetIdx: number; key: string }[] = [];
    snap.current.sheets.forEach((sh, si) => {
      const cells = si === snap.current.activeSheetIdx ? cellsRef.current : sh.cells;
      for (const [key, val] of Object.entries(cells)) {
        if (htmlToText(val).toLowerCase().includes(q)) out.push({ sheetIdx: si, key });
      }
    });
    setFindMatches(out);
    setFindIdx(0);
  }, [findQuery, findOpen, activeSheetIdx, reloadNonce, cellNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  function gotoMatch(idx: number) {
    const m = findMatches[idx];
    if (!m) return;
    if (m.sheetIdx !== activeSheetIdx) { switchSheet(m.sheetIdx); }
    requestAnimationFrame(() => {
      const el = cellEls.current[m.key];
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  function findNext(dir: 1 | -1) {
    if (findMatches.length === 0) return;
    const next = (findIdx + dir + findMatches.length) % findMatches.length;
    setFindIdx(next); gotoMatch(next);
  }
  function closeFind() { setFindOpen(false); setFindQuery(''); setFindMatches([]); }

  // Paint find hits with the CSS Custom Highlight API rather than wrapping them
  // in <mark>. Cell HTML is user content that gets persisted and broadcast to
  // live teammates, so mutating it to show a search hit would write the
  // highlight into the document itself. Highlight ranges live outside the DOM
  // and disappear the moment they're cleared, touching nothing.
  useLayoutEffect(() => {
    const highlights = (window as any).CSS?.highlights;
    const Ctor = (window as any).Highlight;
    if (!highlights || !Ctor) return; // engine without the API: scroll-into-view still works
    highlights.delete(FIND_HL);
    highlights.delete(FIND_HL_CURRENT);
    const q = findQuery.trim().toLowerCase();
    if (!findOpen || !q) return;

    // Only the active sheet is mounted, so only its hits can be painted; the
    // rest are reached by stepping through matches (which switches sheets).
    const cur = findMatches[findIdx];
    const currentKey = cur && cur.sheetIdx === activeSheetIdx ? cur.key : null;
    const rest: Range[] = [];
    const current: Range[] = [];

    for (const [key, el] of Object.entries(cellEls.current)) {
      if (!el || !el.isConnected) continue;
      for (const r of matchRangesIn(el, q)) (key === currentKey ? current : rest).push(r);
    }
    if (rest.length) highlights.set(FIND_HL, new Ctor(...rest));
    if (current.length) highlights.set(FIND_HL_CURRENT, new Ctor(...current));
  }, [findOpen, findQuery, findIdx, findMatches, activeSheetIdx, cellNonce, reloadNonce]);

  // Highlight registries are global to the document — drop ours on unmount so
  // they can't outlive the flow view.
  useEffect(() => () => {
    const highlights = (window as any).CSS?.highlights;
    highlights?.delete(FIND_HL);
    highlights?.delete(FIND_HL_CURRENT);
  }, []);

  // ── Sheet ops ─────────────────────────────────────────────────────────────

  function flushAndGetSheets(): SheetData[] {
    return snap.current.sheets.map((sh, i) =>
      i === snap.current.activeSheetIdx ? { ...sh, cells: { ...cellsRef.current } } : sh
    );
  }

  // Snapshot the flow once, when the Analyze Round panel opens — not on every
  // FlowView render while it's open. FlowView re-renders on every keystroke
  // anywhere in the flow, and re-flattening every cell on each of those (via
  // buildFlowSummary in AnalyzeRound) is wasted work. It also means "analyze the
  // round as it stood when I clicked Analyze" instead of a target that keeps
  // shifting while the panel is open.
  //
  // Placement matters here: useMemo's factory runs SYNCHRONOUSLY at this point
  // in render (unlike useEffect, which is deferred until after commit) — so this
  // has to sit after flushAndGetSheets/snap/cellsRef are actually initialized in
  // this render pass. It used to live right after the `analyzeOpen` useState
  // near the top of the component, which crashed the whole page the first time
  // Analyze Round was opened: ReferenceError, "snap"/"cellsRef" accessed before
  // initialization, since those are `const`s declared later in this same
  // function and aren't hoisted the way flushAndGetSheets itself is.
  const analyzeSheets = useMemo(() => (analyzeOpen ? flushAndGetSheets() : null), [analyzeOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stash where the current sheet is scrolled to, before anything moves.
  function rememberScroll() {
    const el = containerRef.current;
    const id = snap.current.sheets[snap.current.activeSheetIdx]?.id;
    if (el && id) sheetScroll.current[id] = { top: el.scrollTop, left: el.scrollLeft };
  }

  function switchSheet(idx: number) {
    if (idx === activeSheetIdx) return;
    rememberScroll();
    const saved = flushAndGetSheets();
    setSheets(saved);
    // When live, the Y.Doc is the source of truth — a sheet we left may have
    // received remote edits while it was inactive, so read its cells back from
    // the doc rather than the (possibly stale) local snapshot.
    const handle = syncRef.current;
    const targetId = saved[idx]?.id;
    if (liveRef.current && handle && targetId) {
      const sheet = findSheet(handle.doc, targetId);
      const cells: Record<string, string> = {};
      if (sheet) sheetCells(sheet).forEach((t, k) => { const v = t.toString(); if (v) cells[k] = v; });
      cellsRef.current = cells;
    } else {
      cellsRef.current = saved[idx]?.cells ?? {};
    }
    setActiveSheetIdx(idx);
    setCellNonce((n) => n + 1);
    persist({ sheets: saved });
  }

  // Sheet-level ops (add/delete/rename below) go through undo history like any
  // cell edit — deleting a tab full of arguments used to be unrecoverable.
  // `snap.current` normally catches up in a post-render effect, so each op
  // updates it by hand before recordHistory() — otherwise the snapshot taken
  // here would still hold the PRE-op sheets and undo would appear to do nothing.

  function addSheet() {
    rememberScroll();
    const saved = flushAndGetSheets();
    const neo: SheetData = { id: crypto.randomUUID(), name: `Sheet ${saved.length + 1}`, cells: {} };
    const next = [...saved, neo];
    setSheets(next); cellsRef.current = {}; setActiveSheetIdx(next.length - 1);
    snap.current = { ...snap.current, sheets: next, activeSheetIdx: next.length - 1 };
    persist({ sheets: next });
    recordHistory();
  }

  function deleteSheet(idx: number) {
    if (sheets.length <= 1) return;
    rememberScroll();
    const saved = flushAndGetSheets();
    const gone = saved[idx]?.id;
    if (gone) delete sheetScroll.current[gone];
    const next = saved.filter((_, i) => i !== idx);
    // Keep pointing at the SAME sheet after removal: deleting a tab before the
    // active one shifts everything down by one, so decrement in that case.
    // (Previously `min(activeSheetIdx, len-1)` left the index unchanged, jumping
    // the view forward to a different sheet.)
    const shifted = idx < activeSheetIdx ? activeSheetIdx - 1 : activeSheetIdx;
    const newIdx = Math.max(0, Math.min(shifted, next.length - 1));
    setSheets(next); cellsRef.current = next[newIdx]?.cells ?? {}; setActiveSheetIdx(newIdx);
    snap.current = { ...snap.current, sheets: next, activeSheetIdx: newIdx };
    persist({ sheets: next });
    recordHistory();
  }

  // Short, wide summary of a tab's content for its hover tooltip. When Auto
  // Flow's opt-in AI summary mode built this tab, `sheet.aiSummary` holds a
  // real Warroom-AI-written blurb (assembled from the per-card AI summaries
  // already generated at write time — see commitWrite in AutoFlow.tsx — never
  // a fresh API call just for hovering) and that leads the tooltip, marked so
  // it reads as AI content. Otherwise this falls back to a cheap local read of
  // the cells (first line of each = the tag) — fires on every hover, no AI
  // involved. For the ACTIVE tab the live edits live in cellsRef, not the
  // (stale-until-save) sheet.cells.
  function sheetSummary(idx: number): string {
    const s = snap.current;
    const sheet = s.sheets[idx];
    if (!sheet) return '';
    const cells = idx === s.activeSheetIdx ? cellsRef.current : sheet.cells;
    const entries = Object.entries(cells)
      .map(([key, html]) => {
        const [r, c] = key.split('-').map(Number);
        return { r, c, text: htmlToText(String(html ?? '')).split('\n')[0].trim() };
      })
      .filter((e) => e.text)
      .sort((a, b) => a.c - b.c || a.r - b.r);
    const aiLine = sheet.aiSummary?.trim() ? `✨ ${sheet.aiSummary.trim()}` : '';
    if (entries.length === 0) return aiLine || 'Empty';
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const e of entries) {
      const k = e.text.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      tags.push(e.text.length > 54 ? e.text.slice(0, 53) + '…' : e.text);
      if (tags.length >= (aiLine ? 2 : 3)) break; // leave room for the AI line + tab name
    }
    const more = entries.length - tags.length;
    const rest = tags.join('\n') + (more > 0 ? `\n+${more} more` : '');
    return aiLine ? `${aiLine}\n${rest}` : rest;
  }

  function startRenameSheet(idx: number) { setRenamingSheet(idx); setRenameValue(sheets[idx]?.name ?? ''); }
  function commitRenameSheet() {
    if (renamingSheet === null) return;
    const saved = flushAndGetSheets();
    const next = saved.map((s, i) => i === renamingSheet ? { ...s, name: renameValue.trim() || s.name } : s);
    setSheets(next); setRenamingSheet(null);
    snap.current = { ...snap.current, sheets: next };
    persist({ sheets: next });
    recordHistory();
  }

  // ── Font / zoom ───────────────────────────────────────────────────────────

  function changeFontSize(delta: number) {
    const next = Math.min(20, Math.max(9, fontSize + delta));
    setFontSize(next); persist({ fontSize: next });
  }

  function changeZoom(next: number) {
    const clamped = Math.max(20, Math.min(200, next));
    setZoom(clamped); persist({ zoom: clamped });
  }

  function fitZoom() {
    if (!containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const totalLogical = snap.current.columnWidths.reduce((a, b) => a + b, 0);
    if (totalLogical === 0) return;
    changeZoom(Math.round((cw / totalLogical) * 100));
  }

  // Fit columns to the window on open and when the chat panel opens/closes.
  // Gated on `loaded` so it runs *after* the async data load — otherwise it reads
  // empty column widths (total 0) and bails, leaving the flow stuck at 100% zoom.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(fitZoom, 60);
    return () => clearTimeout(t);
  }, [chatOpen, loaded, reloadNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Variant / PF order ────────────────────────────────────────────────────

  // Is there any text anywhere in the flow? (active sheet reads live cellsRef,
  // other sheets read their saved cells.) Used to hide the variant switcher once
  // there's content, since switching variant rebuilds sheets from defaults.
  function flowHasAnyContent(): boolean {
    const s = snap.current;
    return s.sheets.some((sh, i) => {
      const cells = i === s.activeSheetIdx ? cellsRef.current : (sh.cells ?? {});
      return Object.values(cells).some((v) => typeof v === 'string' && v.trim() !== '');
    });
  }

  function changeVariant(v: PolicyVariant) {
    // Refuse once there's content — switching rebuilds sheets from the default
    // names for the variant, which would drop extra/renamed tabs. The toolbar
    // hides the switcher in this case; this is the safety net for the brief
    // window before a re-render catches up.
    if (flowHasAnyContent()) return;
    // Flush the active sheet's live edits into the sheets array first
    const flushedSheets = flushAndGetSheets();
    // Rebuild with new tab names but carry cell content forward by position
    const newSheets = makeSheets('policy', v).map((newSheet, i) => ({
      ...newSheet,
      cells: flushedSheets[i]?.cells ?? {},
    }));
    setVariant(v);
    setSheets(newSheets);
    // Keep the same active position; update cellsRef to that sheet's content
    cellsRef.current = newSheets[snap.current.activeSheetIdx]?.cells ?? {};
    snap.current = { ...snap.current, sheets: newSheets, variant: v };
    persist({ variant: v, sheets: newSheets });
    recordHistory();
  }

  function changePfOrder(o: PFOrder) {
    const newCols = o === 'pro-first' ? PF_PRO_FIRST_COLS : PF_CON_FIRST_COLS;
    const newW = newCols.map(() => DEFAULT_COL_WIDTH);
    const newC = newCols.map(() => null);
    setPfOrder(o); setCustomColumns(null); setColumnWidths(newW); setColumnColors(newC);
    snap.current = { ...snap.current, pfOrder: o, customColumns: null, columnWidths: newW, columnColors: newC };
    persist({ pfOrder: o, customColumns: null, columnWidths: newW, columnColors: newC });
    recordHistory();
  }

  // ── Flow meta (name/event) ────────────────────────────────────────────────

  function updateFlowMeta(updates: Partial<FlowMeta>) {
    const newIndex = flowsIndex.map((f) => f.id === flowId ? { ...f, ...updates } : f);
    setFlowsIndex(newIndex);
    window.warroom?.storage.write('flows_index', newIndex);
  }

  function commitFlowRename() {
    const trimmed = renameValue.trim();
    if (trimmed) updateFlowMeta({ name: trimmed });
    setRenamingFlow(false);
  }

  function changeFlowEvent(e: 'policy' | 'pf') {
    setEvent(e); // sync global
    updateFlowMeta({ event: e });
    const defV: PolicyVariant = 'stock-issues';
    const defO: PFOrder = 'pro-first';
    const defCols = e === 'policy' ? POLICY_COLS : PF_PRO_FIRST_COLS;
    const defW = defCols.map(() => DEFAULT_COL_WIDTH);
    const defC = defCols.map(() => null);
    const newSheets = makeSheets(e, defV);
    setVariant(defV); setPfOrder(defO);
    setCustomColumns(null); setColumnWidths(defW); setColumnColors(defC);
    setSheets(newSheets); cellsRef.current = {}; setActiveSheetIdx(0);
    snap.current = { ...snap.current, event: e, variant: defV, pfOrder: defO, customColumns: null, columnWidths: defW, columnColors: defC, sheets: newSheets, activeSheetIdx: 0 };
    persist({ event: e, variant: defV, pfOrder: defO, customColumns: null, columnWidths: defW, columnColors: defC, sheets: newSheets });
    recordHistory();
  }

  // ── xlsx export ───────────────────────────────────────────────────────────

  async function buildXlsxBase64(): Promise<string> {
    const allSheets = flushAndGetSheets();
    const cols = customColumns ?? baseCols;
    const wb = XLSX.utils.book_new();

    for (const sheet of allSheets) {
      const aoa: string[][] = [cols];
      for (let ri = 0; ri < NUM_ROWS; ri++) {
        const row = cols.map((_, ci) => htmlToText(sheet.cells[`${ri}-${ci}`] ?? ''));
        if (row.some((v) => v.trim() !== '')) aoa.push(row);
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = cols.map((_, ci) => ({
        wch: Math.min(60, Math.max(12, ...aoa.map((row) => (row[ci] ?? '').length))),
      }));
      const safeName = sheet.name.replace(/[\\/:*?[\]]/g, '_').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, safeName);
    }

    return XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
  }

  async function exportXlsx() {
    const base64 = await buildXlsxBase64();
    const flowName = (flowMeta?.name ?? 'flow').replace(/[\\/:*?[\]]/g, '_');
    const result = await window.warroom?.dialog.saveBuffer(
      base64,
      `${flowName}.xlsx`,
      [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    );
    if (result && !result.ok && !result.canceled) {
      console.error('Export failed:', result.error);
    }
  }

  async function openInExcel() {
    const base64 = await buildXlsxBase64();
    const flowName = (flowMeta?.name ?? 'flow').replace(/[\\/:*?[\]]/g, '_');
    await window.warroom?.shell.openBuffer(base64, `${flowName}.xlsx`);
  }

  async function openInSheets() {
    const base64 = await buildXlsxBase64();
    const flowName = (flowMeta?.name ?? 'flow').replace(/[\\/:*?[\]]/g, '_');
    await window.warroom?.gdrive.uploadAsSheets(base64, `${flowName}.xlsx`);
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!flowId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <div className="text-sm font-medium text-ink/60">No flow selected</div>
        <div className="text-xs text-ink/35 text-center max-w-xs">
          Press the <span className="font-bold">+</span> next to <span className="font-bold">Flow</span> in the sidebar to create your first flow sheet.
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--placeholder)' }}>
        Loading flow…
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const flowHasContent = flowHasAnyContent();
  // AI-summary cells on the active sheet — get the blue→pink AI ring.
  const aiCellSet = new Set(activeSheet?.aiCells ?? []);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-main)' }}>

      {/* ── Top bar ── */}
      <div
        className="flex items-center gap-1 px-2.5 py-1 flex-shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', minHeight: 38 }}
      >
        {/* Flow name */}
        {renamingFlow ? (
          <input
            ref={flowNameInputRef}
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitFlowRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitFlowRename(); if (e.key === 'Escape') setRenamingFlow(false); }}
            className="input text-sm font-semibold w-40"
          />
        ) : (
          <FlowTooltip text="Double-click to rename">
            <button
              className="text-sm font-semibold text-ink hover:opacity-70 transition-opacity truncate max-w-[140px]"
              onDoubleClick={() => { setRenamingFlow(true); setRenameValue(flowMeta?.name ?? 'Untitled Flow'); }}
            >
              {flowMeta?.name ?? 'Untitled Flow'}
            </button>
          </FlowTooltip>
        )}

        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border-subtle)' }} />

        {/* Policy/PF event switching is intentionally not surfaced in the UI —
            changeFlowEvent stays wired for future use, but a flow's event is set
            at creation (and by Auto Flow's inference), not toggled here. */}

        {/* Stock Issues / Advantage — only while the flow is still empty. Switching
            variant rebuilds the sheets from the default names for that variant, so
            offering it once there's content would silently drop extra/renamed tabs
            and their contents. Once anything's on the flow, this disappears. */}
        {flowEvent === 'policy' && !flowHasContent && (
          <div className="flex rounded-lg p-0.5" style={{ background: 'var(--mode-toggle-bg)' }}>
            <SmallBtn label="Stock Issues" active={variant === 'stock-issues'} onClick={() => changeVariant('stock-issues')} />
            <SmallBtn label="Advantage" active={variant === 'advantage'} onClick={() => changeVariant('advantage')} />
          </div>
        )}
        {flowEvent === 'pf' && !flowHasContent && (
          <div className="flex rounded-lg p-0.5" style={{ background: 'var(--mode-toggle-bg)' }}>
            <SmallBtn label="Pro First" active={pfOrder === 'pro-first'} onClick={() => changePfOrder('pro-first')} />
            <SmallBtn label="Con First" active={pfOrder === 'con-first'} onClick={() => changePfOrder('con-first')} />
          </div>
        )}

        <div className="flex-1" />

        {/* Emphasis */}
        <ToolBtn onMouseDown={(e) => { e.preventDefault(); applyFormat('bold'); }} title="Bold (⌘B)">
          <span style={{ fontWeight: 800, fontSize: 13 }}>B</span>
        </ToolBtn>
        <ToolBtn onMouseDown={(e) => { e.preventDefault(); applyFormat('italic'); }} title="Italic (⌘I)">
          <span style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif', fontSize: 13 }}>I</span>
        </ToolBtn>
        <ToolBtn onMouseDown={(e) => { e.preventDefault(); applyFormat('underline'); }} title="Underline (⌘U)">
          <span style={{ textDecoration: 'underline', fontSize: 13 }}>U</span>
        </ToolBtn>
        <ToolBtn onMouseDown={(e) => { e.preventDefault(); applyFormat('strikeThrough'); }} title="Strikethrough (⌘⇧X)">
          <span style={{ textDecoration: 'line-through', fontSize: 13 }}>S</span>
        </ToolBtn>
        <ToolBtn onMouseDown={(e) => { e.preventDefault(); applyFormat('highlight'); }} title="Highlight (⌘⇧H)">
          <span style={{ fontSize: 13, background: HILITE, color: '#1a1a1a', padding: '0 3px', borderRadius: 2 }}>H</span>
        </ToolBtn>

        <ToolDivider />

        {/* Font size */}
        <ToolBtn onClick={() => changeFontSize(-1)} title="Smaller text"><span style={{ fontSize: 11 }}>A−</span></ToolBtn>
        <span className="text-xs w-4 text-center tabular-nums shrink-0" style={{ color: 'var(--label-color)' }}>{fontSize}</span>
        <ToolBtn onClick={() => changeFontSize(1)} title="Larger text"><span style={{ fontSize: 13 }}>A+</span></ToolBtn>

        <ToolDivider />

        {/* Zoom */}
        <ToolBtn onClick={() => changeZoom(zoom - 10)} title="Zoom out"><span style={{ fontSize: 15 }}>−</span></ToolBtn>
        <FlowTooltip text="Fit to window">
          <button
            className="text-xs w-9 text-center tabular-nums transition hover:opacity-70 shrink-0"
            style={{ color: 'var(--label-color)' }}
            onClick={fitZoom}
          >
            {zoom}%
          </button>
        </FlowTooltip>
        <ToolBtn onClick={() => changeZoom(zoom + 10)} title="Zoom in"><span style={{ fontSize: 14 }}>+</span></ToolBtn>
        <ToolBtn onClick={fitZoom} title="Fit to window"><IcoFit /></ToolBtn>

        {customColumns && (
          <ToolBtn onClick={resetColumns} title="Reset columns"><IcoResetCols /></ToolBtn>
        )}

        <ToolDivider />

        {/* Undo / Redo */}
        <ToolBtn onClick={undo} title="Undo (⌘Z)" disabled={!canUndo}><IcoUndo /></ToolBtn>
        <ToolBtn onClick={redo} title="Redo (⌘⇧Z)" disabled={!canRedo}><IcoRedo /></ToolBtn>

        <ToolDivider />

        {/* Find */}
        <ToolBtn onClick={() => { setFindOpen(true); setTimeout(() => findInputRef.current?.focus(), 0); }} active={findOpen} title="Find (⌘F)"><IcoFind /></ToolBtn>

        {/* Draw arrow */}
        <ToolBtn
          onClick={() => { setDrawMode((v) => !v); setArrowFrom(null); }}
          active={drawMode}
          title={drawMode ? 'Click a source cell, then a target cell — Esc to cancel' : 'Draw an arrow linking two cells (⌘L)'}
        >
          <IcoArrow />
        </ToolBtn>

        {/* Live status — present only while live; the entry point into going live
            lives inside the Share panel now (see "Combine Share and Collaborate"
            below), so this is purely a glanceable status readout + leave button. */}
        {live && (
          <div
            className="flex items-center gap-1.5 shrink-0 px-2 h-[26px] rounded-md"
            style={{ background: 'var(--nav-active-bg)' }}
            title={liveReady
              ? `Live — editing together in realtime${remoteCursors.length ? ` with ${remoteCursors.map((c) => c.user.name).join(', ')}` : ' (no one else here yet)'}`
              : 'Connecting to live session…'}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {liveReady && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: '#16a34a' }} />}
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: liveReady ? '#16a34a' : '#d97706' }} />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--nav-active-color)' }}>Live</span>
            {/* Present teammates */}
            <div className="flex items-center -space-x-1">
              {remoteCursors.slice(0, 4).map((c) => (
                <span
                  key={c.user.id}
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                  style={{ background: c.user.color, border: '1px solid var(--bg-elevated)' }}
                  title={c.user.name}
                >{c.user.name[0]?.toUpperCase()}</span>
              ))}
            </div>
            <FlowTooltip text="Leave live session">
              <button
                onClick={stopLiveCollab}
                className="text-[10px] leading-none ml-0.5 opacity-70 hover:opacity-100"
                style={{ color: 'var(--nav-active-color)' }}
              >✕</button>
            </FlowTooltip>
          </div>
        )}

        {/* Share — also where going live now starts (was a separate button; both
            led to the same panel, so they're one button now). */}
        <div className="relative shrink-0">
          <ToolBtn onClick={() => setShareOpen(true)} title="Share / Collaborate"><ShareIcon /></ToolBtn>
          {flowMeta?.shared && (
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full pointer-events-none" style={{ background: '#0077ed' }} />
          )}
        </div>

        {/* Analyze round */}
        <ToolBtn onClick={() => setAnalyzeOpen(true)} title="Analyze round (Warroom AI)" className="ai-glow-ring"><IcoAnalyze /></ToolBtn>
      </div>

      {/* Find bar */}
      {findOpen && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}
        >
          <IcoFind />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
              if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
            }}
            placeholder="Find across all tabs…"
            className="input text-sm flex-1 max-w-xs"
            autoFocus
          />
          <span className="text-xs tabular-nums shrink-0" style={{ color: 'var(--label-color)' }}>
            {findMatches.length ? `${findIdx + 1} / ${findMatches.length}` : (findQuery ? 'No matches' : '')}
          </span>
          <button className="btn px-2 py-0.5 text-sm" onClick={() => findNext(-1)} title="Previous (⇧⏎)" disabled={!findMatches.length}>↑</button>
          <button className="btn px-2 py-0.5 text-sm" onClick={() => findNext(1)} title="Next (⏎)" disabled={!findMatches.length}>↓</button>
          <button className="btn px-2 py-0.5 text-sm" onClick={closeFind} title="Close (Esc)">✕</button>
        </div>
      )}

      {/* Draw-mode banner */}
      {drawMode && (
        <div
          className="flex items-center gap-2 px-3 py-1 flex-shrink-0 text-xs"
          style={{ background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <IcoArrow />
          {arrowFrom ? 'Now click the target cell — or arrow-key over to it and press ⌘L' : 'Click the source cell to start the arrow — or press ⌘L inside it'}
          <button className="ml-auto btn px-2 py-0.5 text-xs" onClick={() => { setDrawMode(false); setArrowFrom(null); }}>Cancel</button>
        </div>
      )}

      {/* Share panel */}
      {shareOpen && flowId && (
        <SharePanel
          type="flow"
          id={flowId}
          name={flowMeta?.name ?? 'Untitled Flow'}
          getData={async () => {
            // Sharing a flow now always goes live first (if it isn't already) —
            // there's no more "send a frozen copy" path when a team is signed in,
            // so recipients always land in the same realtime doc as the sharer
            // instead of an independent copy that could silently diverge. Runs
            // right before the share actually sends (SharePanel calls getData()
            // only from handleShare), not on every render. `live` is a closure
            // variable that won't reflect startLiveCollab()'s setLive(true) within
            // this same call, so track success off its own return value instead.
            const isLive = live || (currentTeam ? await startLiveCollab() : false);
            const data = (await window.warroom?.storage.read(`flow_data_${flowId}`)) ?? {};
            // A live flow shares a *pointer* (same id + team) so recipients join the
            // very same realtime doc rather than getting a frozen copy. Falls back
            // to a plain snapshot if going live failed (offline, promote error) —
            // better than silently pointing a recipient at a doc that never got
            // promoted.
            if (isLive && currentTeam) return { ...data, live: true, flowId, teamId: currentTeam.id };
            return data;
          }}
          onClose={() => setShareOpen(false)}
          collabNote={live ? 'This flow is live — anyone you share it with joins your realtime session and edits it with you, instead of getting a copy.' : undefined}
          onExportXlsx={exportXlsx}
          onOpenInExcel={openInExcel}
          onOpenInSheets={openInSheets}
          live={live}
        />
      )}

      {analyzeOpen && analyzeSheets && (
        <AnalyzeRound
          sheets={analyzeSheets}
          columns={columns}
          event={flowEvent}
          flowId={flowId}
          onClose={() => setAnalyzeOpen(false)}
        />
      )}

      {/* ── Grid ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto scroll-thin"
        style={{ background: 'var(--bg-main)' }}
        onScroll={() => { rememberScroll(); requestAnimationFrame(recomputeArrows); }}
      >
        <div ref={gridContentRef} className="relative" style={{ minWidth: totalWidth + 'px' }}>

          {/* Arrow overlay */}
          {arrowGeo.length > 0 && (
            <svg
              className="absolute inset-0"
              style={{ width: '100%', height: '100%', pointerEvents: 'none', zIndex: 15, overflow: 'visible' }}
            >
              <defs>
                <marker id="wr-arrowhead" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L7,3 L0,6 Z" fill="var(--nav-active-color)" />
                </marker>
              </defs>
              {arrowGeo.map((g) => {
                const hov = hoveredArrow === g.id;
                return (
                  <g key={g.id}>
                    {/* Visible arrow — fades when hovered so content underneath is readable */}
                    <path
                      d={g.d} fill="none" stroke="var(--nav-active-color)" strokeWidth={2}
                      markerEnd="url(#wr-arrowhead)" opacity={hov ? 0.18 : 0.85}
                      style={{ pointerEvents: 'none', transition: 'opacity 0.12s' }}
                    />
                    {/* Wide invisible hit area for hover/click */}
                    <path
                      d={g.d} fill="none" stroke="transparent" strokeWidth={16}
                      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredArrow(g.id)}
                      onMouseLeave={() => setHoveredArrow((cur) => (cur === g.id ? null : cur))}
                      onClick={() => deleteArrow(g.id)}
                    >
                      <title>Click to delete this arrow</title>
                    </path>
                    {/* Delete affordance — only while hovering the arrow */}
                    {hov && (
                      <g
                        style={{ pointerEvents: 'all', cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredArrow(g.id)}
                        onMouseLeave={() => setHoveredArrow((cur) => (cur === g.id ? null : cur))}
                        onClick={() => deleteArrow(g.id)}
                      >
                        <circle cx={g.mx} cy={g.my} r={8} fill="var(--bg-elevated)" stroke="var(--nav-active-color)" strokeWidth={1.2} />
                        <text x={g.mx} y={g.my + 3.5} textAnchor="middle" fontSize={11} fill="var(--nav-active-color)">×</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          )}

          {/* Sticky header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              position: 'sticky',
              top: 0,
              zIndex: 20,
              borderBottom: '2px solid var(--border-med)',
            }}
          >
            {columns.map((col, ci) => {
              return (
                <div
                  key={ci}
                  className="relative flex items-center justify-center"
                  style={{
                    background: colBg(colColor(ci), dark, true),
                    borderRight: ci < columns.length - 1 ? '1px solid var(--border-med)' : 'none',
                    height: 36,
                    userSelect: 'none',
                  }}
                >
                  {renamingCol === ci ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRenameCol}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRenameCol();
                        if (e.key === 'Escape') setRenamingCol(null);
                      }}
                      className="w-full text-center text-xs font-bold bg-transparent outline-none px-2"
                      style={{ color: 'var(--nav-active-color)' }}
                    />
                  ) : (
                    <FlowTooltip text="Double-click to rename">
                      <span
                        className="text-xs font-bold truncate px-5"
                        style={{ color: 'var(--nav-active-color)', cursor: 'default' }}
                        onDoubleClick={() => startRenameCol(ci)}
                      >
                        {col}
                      </span>
                    </FlowTooltip>
                  )}

                  {/* Column menu trigger — always visible for discoverability.
                      Kept on native `title` (not FlowTooltip): this button is
                      itself `position: absolute` against the column header cell,
                      and FlowTooltip's wrapper span would introduce a *closer*
                      positioned ancestor, silently repositioning it. */}
                  <button
                    data-col-menu
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded transition"
                    style={{ color: 'var(--nav-active-color)', fontSize: 11, opacity: colMenu === ci ? 1 : 0.55 }}
                    title="Column options"
                    onClick={(e) => { e.stopPropagation(); setColMenu(colMenu === ci ? null : ci); }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = colMenu === ci ? '1' : '0.55')}
                  >
                    ▾
                  </button>

                  {colMenu === ci && (
                    <div
                      data-col-menu
                      className="absolute z-50 py-1 rounded-lg shadow-xl text-xs"
                      style={{
                        top: '100%', left: '50%', transform: 'translateX(-50%)',
                        minWidth: 168, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <DropBtn onClick={() => startRenameCol(ci)}>Rename column</DropBtn>
                      <DropBtn onClick={() => insertColumn(ci)}>Insert column left</DropBtn>
                      <DropBtn onClick={() => insertColumn(ci + 1)}>Insert column right</DropBtn>
                      {columns.length > 2 && <DropBtn onClick={() => deleteColumn(ci)} danger>Delete column</DropBtn>}
                      <div className="my-1 mx-2" style={{ borderTop: '1px solid var(--border-subtle)' }} />
                      <div className="px-3 pt-1 pb-0.5 uppercase tracking-wide" style={{ color: 'var(--label-color)', fontSize: 9 }}>Column color</div>
                      <div className="flex items-center gap-1.5 px-3 py-1.5 flex-wrap" style={{ maxWidth: 168 }}>
                        {COLOR_SWATCHES.map((c) => (
                          <button
                            key={c}
                            onClick={() => setColumnColor(ci, c)}
                            title={c}
                            className="rounded-full transition hover:scale-110"
                            style={{
                              width: 16, height: 16, background: c, cursor: 'pointer',
                              border: columnColors[ci] === c ? '2px solid var(--nav-active-color)' : '1px solid var(--border-med)',
                            }}
                          />
                        ))}
                        <label
                          className="rounded-full flex items-center justify-center cursor-pointer relative overflow-hidden"
                          title="Custom color"
                          style={{ width: 16, height: 16, border: '1px dashed var(--border-med)', fontSize: 9, color: 'var(--label-color)' }}
                        >
                          +
                          <input
                            type="color"
                            value={columnColors[ci] ?? colColor(ci)}
                            onChange={(e) => setColumnColor(ci, e.target.value)}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                        </label>
                      </div>
                      <DropBtn onClick={() => setColumnColor(ci, null)}>Reset to default</DropBtn>
                    </div>
                  )}

                  {/* Resize handle */}
                  {ci < columns.length - 1 && (
                    <div
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize"
                      style={{ zIndex: 2 }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        resizing.current = { idx: ci, startX: e.clientX, startW: snap.current.columnWidths[ci] };
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Data rows */}
          {Array.from({ length: NUM_ROWS }, (_, ri) => (
            <div key={ri} style={{ display: 'grid', gridTemplateColumns: gridTemplate }}>
              {columns.map((_, ci) => {
                const cellKey = `${ri}-${ci}`;
                const isHovered = hoveredCell?.ri === ri && hoveredCell?.ci === ci;
                const isArrowSrc = drawMode && arrowFrom === cellKey;
                const remoteCur = remoteCursorMap.get(cellKey);
                const isAiCell = aiCellSet.has(cellKey);
                return (
                  <div
                    key={ci}
                    className={`relative${isAiCell ? ' ai-glow-ring' : ''}`}
                    style={{
                      background: colBg(colColor(ci), dark, false),
                      borderRight: ci < columns.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      borderBottom: '1px solid var(--border-subtle)',
                      boxShadow: isArrowSrc
                        ? 'inset 0 0 0 2px var(--nav-active-color)'
                        : (remoteCur ? `inset 0 0 0 2px ${remoteCur.user.color}` : undefined),
                      cursor: drawMode ? 'crosshair' : undefined,
                    }}
                    onMouseEnter={() => setHoveredCell({ ri, ci })}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    {remoteCur && (
                      <div
                        className="absolute z-10 px-1.5 py-0.5 rounded text-[9px] font-semibold pointer-events-none whitespace-nowrap"
                        style={{ top: -9, left: 4, background: remoteCur.user.color, color: '#fff' }}
                      >
                        {remoteCur.user.name}
                      </div>
                    )}
                    <div
                      key={`${activeSheet?.id ?? 'sheet'}-${cellKey}-${reloadNonce}-${cellNonce}`}
                      ref={(el) => {
                        cellEls.current[cellKey] = el;
                        if (el && el.dataset.init !== '1') { el.innerHTML = cellToHtml(cellsRef.current[cellKey] ?? ''); el.dataset.init = '1'; }
                      }}
                      contentEditable={!drawMode}
                      suppressContentEditableWarning
                      onFocus={() => { focusedCell.current = cellKey; syncRef.current?.setActiveCell(cellKey); }}
                      onBlur={(e) => { if (liveRef.current) { pushLiveCell(cellKey, e.currentTarget.innerHTML); syncRef.current?.setActiveCell(null); } }}
                      onInput={(e) => handleInput(ri, ci, e)}
                      onPaste={(e) => handlePaste(ri, ci, e)}
                      onKeyDown={(e) => handleKeyDown(ri, ci, e)}
                      onMouseDown={(e) => { if (drawMode) { e.preventDefault(); handleArrowCellClick(cellKey); } }}
                      className="flow-cell w-full outline-none bg-transparent leading-snug whitespace-pre-wrap break-words"
                      style={{
                        fontSize: effectiveFontSize + 'px',
                        color: 'rgb(var(--ink-rgb))',
                        minHeight: Math.round(32 * zoom / 100) + 'px',
                        padding: `${Math.round(6 * zoom / 100)}px ${Math.round(8 * zoom / 100)}px`,
                        fontFamily: 'inherit',
                        caretColor: 'rgb(var(--ink-rgb))',
                      }}
                      spellCheck={false}
                    />
                    {/* Cell move buttons — top-right corner on hover */}
                    {isHovered && !drawMode && (
                      <div
                        className="absolute flex flex-col"
                        style={{ top: 2, right: 2, gap: 1, zIndex: 5, pointerEvents: 'auto' }}
                      >
                        {ri > 0 && (
                          <FlowTooltip text="Move up (⌘↑)" up>
                            <button
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => moveCell(ri, ci, 'up')}
                              className="flex items-center justify-center rounded transition"
                              style={{
                                width: 14, height: 14, fontSize: 8, lineHeight: 1,
                                background: 'var(--bg-elevated)', border: '1px solid var(--border-med)',
                                color: 'var(--label-color)', cursor: 'pointer',
                              }}
                            >▲</button>
                          </FlowTooltip>
                        )}
                        {ri < NUM_ROWS - 1 && (
                          <FlowTooltip text="Move down (⌘↓)">
                            <button
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => moveCell(ri, ci, 'down')}
                              className="flex items-center justify-center rounded transition"
                              style={{
                                width: 14, height: 14, fontSize: 8, lineHeight: 1,
                                background: 'var(--bg-elevated)', border: '1px solid var(--border-med)',
                                color: 'var(--label-color)', cursor: 'pointer',
                              }}
                            >▼</button>
                          </FlowTooltip>
                        )}
                      </div>
                    )}
                    {/* Insert-row "+" — thin hover strip straddling the bottom border line itself,
                        independent of the cell's own hover state (which drives the move buttons above). */}
                    {!drawMode && ri < NUM_ROWS - 1 && (
                      <div
                        className="absolute left-0 right-0"
                        style={{ bottom: -6, height: 12, zIndex: 6, pointerEvents: 'auto' }}
                        onMouseEnter={() => setHoveredGap({ ri, ci })}
                        onMouseLeave={() => setHoveredGap((g) => (g && g.ri === ri && g.ci === ci ? null : g))}
                      >
                        {hoveredGap?.ri === ri && hoveredGap?.ci === ci && (
                          <div
                            className="absolute left-1/2"
                            style={{ top: '50%', transform: 'translate(-50%, -50%)' }}
                          >
                            <FlowTooltip text="Insert row below">
                              <button
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => insertRowBetween(ri, ci)}
                                className="flex items-center justify-center rounded-full transition"
                                style={{
                                  width: 13, height: 13, fontSize: 11, lineHeight: 1,
                                  background: 'var(--nav-active-bg)', border: '1px solid var(--border-med)',
                                  color: 'var(--nav-active-color)', cursor: 'pointer',
                                }}
                              >+</button>
                            </FlowTooltip>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── Sheet tabs ── */}
      <div
        className="flex items-center flex-shrink-0 overflow-x-auto"
        style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-sidebar)', height: 36 }}
      >
        {/* Sheets (scrollable) */}
        <div className="flex items-center flex-1 overflow-x-auto min-w-0">
          {sheets.map((sheet, idx) => (
            <SheetTab
              key={sheet.id}
              name={sheet.name}
              active={idx === activeSheetIdx}
              renaming={renamingSheet === idx}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onCommitRename={commitRenameSheet}
              onCancelRename={() => setRenamingSheet(null)}
              onClick={() => switchSheet(idx)}
              onDoubleClick={() => startRenameSheet(idx)}
              onDelete={sheets.length > 1 ? () => deleteSheet(idx) : undefined}
              getSummary={() => sheetSummary(idx)}
            />
          ))}
        </div>

        {/* Add sheet — RIGHT side */}
        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border-subtle)' }} />
        <FlowTooltip text="Add sheet (⌘T)">
          <button
            className="flex items-center justify-center w-8 h-8 shrink-0 text-lg font-light transition"
            style={{ color: 'var(--label-color)' }}
            onClick={addSheet}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--nav-active-color)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--label-color)')}
          >+</button>
        </FlowTooltip>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// Two people / live-collab glyph.
function ShareIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12 10a2 2 0 0 0-1.6.8L5.9 8.4A2 2 0 0 0 6 8a2 2 0 0 0-.1-.4l4.5-2.3A2 2 0 1 0 9.9 3.4L5.4 5.7A2 2 0 1 0 5.4 10.3l4.5 2.3A2 2 0 1 0 12 10z"/>
    </svg>
  );
}

function IcoUndo() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7H12.5a4 4 0 0 1 0 8H6" />
      <path d="M7 4L4 7l3 3" />
    </svg>
  );
}
function IcoRedo() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 7H7.5a4 4 0 0 0 0 8H14" />
      <path d="M13 4l3 3-3 3" />
    </svg>
  );
}
function IcoFind() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.5 13.5L17 17" />
    </svg>
  );
}
function IcoArrow() {
  // A source node connected by a curve to an arrowhead — reads as "link two cells".
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4.5" cy="5" r="1.7" fill="currentColor" stroke="none" />
      <path d="M5 6.3C7 11 9.8 13.2 14 13.7" />
      <path d="M10.8 12.2L14.4 13.8L12.7 10.2" />
    </svg>
  );
}

function IcoFit() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4H4v3M16 7V4h-3M13 16h3v-3M4 13v3h3" />
    </svg>
  );
}
function IcoResetCols() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M8 4v12M12 4v12" />
    </svg>
  );
}
// A magnifying glass over a small spark — reads as "AI-inspect the round".
function IcoAnalyze() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M12.7 12.7L17 17" />
      <path d="M8.5 6v5M6 8.5h5" strokeWidth="1.2" />
    </svg>
  );
}

// Styled hover tooltip, matching the app's own bubble (see Home.tsx's Tooltip) —
// native `title` attributes technically work in Electron, but render as a slow,
// easy-to-miss OS tooltip that's inconsistent with how tooltips look everywhere
// else in Warroom. Every flow-editor button routes through this now, either via
// ToolBtn below or by wrapping directly. A short show-delay keeps a dense toolbar
// from flashing a tooltip for every icon the cursor passes over.
function FlowTooltip({ text, children, up = false, disabled, wide = false, className }: {
  text?: string; children: React.ReactNode; up?: boolean; disabled?: boolean;
  // `wide`: for multi-line content (e.g. a tab's content summary) — wider box,
  // left-aligned, and preserves the `\n`s in `text` as separate lines instead of
  // wrapping everything into one narrow column.
  wide?: boolean;
  // Extra classes for the wrapper span — e.g. `flex-1 min-w-0` so a truncating
  // child (a long tab name) can actually shrink instead of overflowing.
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!text || disabled) return <>{children}</>;
  function onEnter() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(true), 350);
  }
  function onLeave() {
    if (timer.current) clearTimeout(timer.current);
    setShow(false);
  }
  return (
    <span
      className={className}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {children}
      {show && (
        <span
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            ...(up ? { bottom: 'calc(100% + 7px)' } : { top: 'calc(100% + 7px)' }),
            zIndex: 9999,
            // width: 'max-content' is load-bearing: without it, an absolutely
            // positioned span with only `left` set shrink-to-fits against the
            // ANCHOR's width (often a 26px icon button), not its own text — so
            // a short label like "Draw arrow (⌘L)" would wrap one word per
            // line instead of sizing to itself. maxWidth is just a sane ceiling
            // in case a tooltip is ever accidentally long — it wraps wide, not
            // narrow-and-tall.
            width: 'max-content',
            maxWidth: wide ? 360 : 220,
            whiteSpace: wide ? 'pre-line' : 'normal',
            textAlign: wide ? 'left' : 'center',
            lineHeight: wide ? 1.5 : undefined,
            borderRadius: 8,
            padding: '5px 10px',
            fontSize: 11,
            pointerEvents: 'none',
            background: 'color-mix(in srgb, var(--bg-popover, var(--bg-sidebar)) 88%, transparent)',
            backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
            WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
            border: '1px solid var(--border-subtle)',
            color: 'var(--ink)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

// Shared compact toolbar icon button with a consistent hover background.
function ToolBtn({ children, onClick, onMouseDown, title, active, disabled, className }: {
  children: React.ReactNode; onClick?: () => void; onMouseDown?: (e: React.MouseEvent) => void;
  title?: string; active?: boolean; disabled?: boolean; className?: string;
}) {
  return (
    <FlowTooltip text={title} disabled={disabled}>
      <button
        onClick={onClick}
        onMouseDown={onMouseDown}
        disabled={disabled}
        className={`flex items-center justify-center rounded-md transition shrink-0${className ? ` ${className}` : ''}`}
        style={{
          width: 26, height: 26,
          background: active ? 'var(--nav-active-bg)' : 'transparent',
          color: active ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? 'default' : 'pointer',
        }}
        onMouseEnter={(e) => { if (!active && !disabled) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {children}
      </button>
    </FlowTooltip>
  );
}

function ToolDivider() {
  return <div className="w-px h-4 shrink-0" style={{ background: 'var(--border-subtle)' }} />;
}

function SmallBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-0.5 text-[10px] uppercase tracking-wider rounded-md transition font-bold"
      style={
        active
          ? { background: 'var(--bg-card)', color: 'var(--nav-active-color)', boxShadow: 'var(--nav-active-shadow)' }
          : { background: 'transparent', color: 'var(--nav-inactive-color)' }
      }
    >
      {label}
    </button>
  );
}

function DropBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className="w-full text-left px-3 py-1.5 text-xs transition"
      style={{ color: danger ? 'var(--danger, #ef4444)' : 'var(--nav-active-color)' }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SheetTab({
  name, active, renaming, renameValue, onRenameChange, onCommitRename, onCancelRename,
  onClick, onDoubleClick, onDelete, getSummary,
}: {
  name: string; active: boolean; renaming: boolean;
  renameValue: string; onRenameChange: (v: string) => void;
  onCommitRename: () => void; onCancelRename: () => void;
  onClick: () => void; onDoubleClick: () => void; onDelete?: () => void;
  getSummary?: () => string;
}) {
  const [hovered, setHovered] = useState(false);
  // Computed on hover (not every render) since it reads every cell on the tab.
  const [summary, setSummary] = useState<string | null>(null);
  return (
    <div
      className="flex items-center shrink-0"
      style={{
        height: '100%',
        borderRight: '1px solid var(--border-subtle)',
        background: active ? 'var(--bg-card)' : 'transparent',
        minWidth: 72, maxWidth: 130,
      }}
      onMouseEnter={() => { setHovered(true); if (getSummary) setSummary(getSummary()); }}
      onMouseLeave={() => setHovered(false)}
    >
      {renaming ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommitRename(); if (e.key === 'Escape') onCancelRename(); }}
          className="flex-1 bg-transparent outline-none text-xs font-medium px-3"
          style={{ color: 'var(--nav-active-color)' }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <FlowTooltip text={summary ? `${name}\n${summary}` : name} up wide className="flex-1 min-w-0">
          <button
            className="w-full text-left truncate text-xs font-medium px-3"
            style={{ color: active ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)' }}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
          >
            {name}
          </button>
        </FlowTooltip>
      )}
      {onDelete && !renaming && (
        <FlowTooltip text="Delete sheet">
          <button
            className="shrink-0 mr-1.5 w-4 h-4 flex items-center justify-center rounded text-xs transition"
            style={{
              color: 'var(--nav-inactive-color)',
              opacity: (hovered || active) ? 0.5 : 0,
              pointerEvents: (hovered || active) ? 'auto' : 'none',
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = (hovered || active) ? '0.5' : '0')}
          >×</button>
        </FlowTooltip>
      )}
    </div>
  );
}
