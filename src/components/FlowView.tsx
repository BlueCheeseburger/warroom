import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useApp, FlowMeta } from '../store/appStore';
import SharePanel from './SharePanel';

// ─── Column definitions ───────────────────────────────────────────────────────

export const POLICY_COLS = ['1AC', '1NC', '2AC', '2NC/1NR', '1AR', '2NR', '2AR'];
export const PF_PRO_FIRST_COLS = ['Pro Case', 'Con Case', 'Con Rebuttal', 'Pro Rebuttal', 'Pro Summary', 'Con Summary', 'Pro FF', 'Con FF'];
export const PF_CON_FIRST_COLS = ['Con Case', 'Pro Case', 'Pro Rebuttal', 'Con Rebuttal', 'Con Summary', 'Pro Summary', 'Con FF', 'Pro FF'];

// Blue = aff/pro, green = neg/con
const POLICY_BLUE = new Set([0, 2, 4, 6]);
const PF_PRO_FIRST_BLUE = new Set([0, 3, 4, 6]);
const PF_CON_FIRST_BLUE = new Set([1, 2, 5, 7]);

// ─── Default sheet names ──────────────────────────────────────────────────────

const SHEETS_STOCK_ISSUES = ['Inherency', 'Harms', 'Solvency', 'Off 1', 'Off 2', 'Off 3', 'Off 4', 'RFD/Notes'];
const SHEETS_ADVANTAGE = ['Adv 1', 'Adv 2', 'Adv 3', 'Off 1', 'Off 2', 'Off 3', 'Off 4', 'RFD/Notes'];
const SHEETS_PF = ['Contention 1', 'Contention 2', 'Turns', 'Off 1', 'Off 2', 'RFD/Notes'];

export const NUM_ROWS = 60;
const DEFAULT_COL_WIDTH = 185;
const DEFAULT_FONT_SIZE = 13;

// ─── Types ────────────────────────────────────────────────────────────────────

type PolicyVariant = 'stock-issues' | 'advantage';
type PFOrder = 'pro-first' | 'con-first';

interface FlowArrow {
  id: string;
  from: string; // "ri-ci"
  to: string;   // "ri-ci"
}

interface SheetData {
  id: string;
  name: string;
  cells: Record<string, string>;
  arrows?: FlowArrow[];
}

interface StoredFlowData {
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

interface FlowSnapshot {
  sheets: SheetData[];
  columnColors: (string | null)[];
  customColumns: string[] | null;
  columnWidths: number[];
  activeSheetIdx: number;
}

const AFF_COLOR_KEY = 'warroom-flow-aff-color';
const NEG_COLOR_KEY = 'warroom-flow-neg-color';
const DEFAULT_AFF_COLOR = '#2563eb';
const DEFAULT_NEG_COLOR = '#16a34a';
const COLOR_SWATCHES = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#9333ea', '#0891b2', '#db2777', '#475569'];

// Cell values are stored as HTML (to support bold/italic/underline/strikethrough).
// Legacy plain-text values (and AI-written plain text) are upgraded on render.
const HTML_RE = /<(br|div|span|b|i|u|s|strike|em|strong|p)[\s/>]/i;
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function cellToHtml(value: string): string {
  if (!value) return '';
  if (HTML_RE.test(value)) return value;
  return escapeHtml(value).replace(/\n/g, '<br>');
}
function htmlToText(html: string): string {
  if (!html) return '';
  if (!HTML_RE.test(html) && !/[<&]/.test(html)) return html;
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.innerText;
}

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
  const { view, event, setEvent, flowsIndex, setFlowsIndex, chatOpen } = useApp();
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
  const [shareOpen, setShareOpen] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────

  const cellsRef = useRef<Record<string, string>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cellEls = useRef<Record<string, HTMLDivElement | null>>({});
  const resizing = useRef<{ idx: number; startX: number; startW: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridContentRef = useRef<HTMLDivElement>(null);
  const flowNameInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const focusedCell = useRef<string | null>(null);

  // Undo / redo — snapshots of editable flow state
  const history = useRef<FlowSnapshot[]>([]);
  const histIdx = useRef(-1);
  const restoring = useRef(false);

  // Always-current snapshot for use in async/event callbacks
  const snap = useRef({ sheets, columnWidths, customColumns, columnColors, fontSize, zoom, variant, pfOrder, activeSheetIdx });
  useEffect(() => { snap.current = { sheets, columnWidths, customColumns, columnColors, fontSize, zoom, variant, pfOrder, activeSheetIdx }; });

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

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!flowId) return;
    setLoaded(false);
    cellsRef.current = {};
    window.warroom?.storage.read(`flow_data_${flowId}`).then((data: StoredFlowData | null) => {
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

  // ── Global shortcuts: find (⌘F), undo (⌘Z), redo (⌘⇧Z / ⌘Y) ────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!flowId) return;
      if (e.key === 'Escape') {
        if (drawMode) { setDrawMode(false); setArrowFrom(null); }
        else if (findOpen) closeFind();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'f') {
        e.preventDefault();
        setFindOpen(true);
        setTimeout(() => findInputRef.current?.focus(), 0);
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault(); undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault(); redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flowId, drawMode, findOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist ───────────────────────────────────────────────────────────────

  function persist(overrides: Partial<StoredFlowData> = {}) {
    if (!flowId) return;
    const s = snap.current;
    const flushedSheets = s.sheets.map((sh, i) =>
      i === s.activeSheetIdx ? { ...sh, cells: { ...cellsRef.current } } : sh
    );
    window.warroom?.storage.write(`flow_data_${flowId}`, {
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
    } as StoredFlowData);
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
      activeSheetIdx: s.activeSheetIdx,
    };
  }

  function recordHistory() {
    if (restoring.current) return;
    const snapshot = takeSnapshot();
    history.current = history.current.slice(0, histIdx.current + 1);
    history.current.push(snapshot);
    if (history.current.length > 120) history.current.shift();
    histIdx.current = history.current.length - 1;
  }

  function restoreSnapshot(s: FlowSnapshot) {
    restoring.current = true;
    const idx = Math.min(s.activeSheetIdx, s.sheets.length - 1);
    setCustomColumns(s.customColumns);
    setColumnWidths(s.columnWidths);
    setColumnColors(s.columnColors);
    setSheets(s.sheets);
    setActiveSheetIdx(idx);
    cellsRef.current = { ...(s.sheets[idx]?.cells ?? {}) };
    snap.current = { ...snap.current, sheets: s.sheets, columnColors: s.columnColors, customColumns: s.customColumns, columnWidths: s.columnWidths, activeSheetIdx: idx };
    persist({ sheets: s.sheets, columnColors: s.columnColors, customColumns: s.customColumns, columnWidths: s.columnWidths });
    setCellNonce((n) => n + 1);
    requestAnimationFrame(recomputeArrows);
    setTimeout(() => { restoring.current = false; }, 0);
  }

  function undo() {
    if (histIdx.current > 0) { histIdx.current -= 1; restoreSnapshot(history.current[histIdx.current]); }
  }
  function redo() {
    if (histIdx.current < history.current.length - 1) { histIdx.current += 1; restoreSnapshot(history.current[histIdx.current]); }
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

  function handleInput(ri: number, ci: number, e: React.FormEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    cellsRef.current[`${ri}-${ci}`] = el.innerHTML;
    scheduleSave();
  }

  // Apply rich-text emphasis to the focused cell (toolbar buttons).
  // Buttons call this from onMouseDown(preventDefault) so the cell keeps focus
  // and its selection, letting execCommand act on the selected text.
  function applyFormat(cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough') {
    const key = focusedCell.current;
    const el = key ? cellEls.current[key] : null;
    if (!key || !el) return;
    el.focus();
    document.execCommand(cmd);
    cellsRef.current[key] = el.innerHTML;
    scheduleSave();
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

  function caretAtEdge(el: HTMLDivElement, edge: 'start' | 'end'): boolean {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) return false;
    const probe = r.cloneRange();
    probe.selectNodeContents(el);
    if (edge === 'start') { probe.setEnd(r.startContainer, r.startOffset); }
    else { probe.setStart(r.endContainer, r.endOffset); }
    return probe.toString().length === 0;
  }

  function handleKeyDown(ri: number, ci: number, e: React.KeyboardEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();

    // Rich-text emphasis — ⌘B / ⌘I / ⌘U, strikethrough ⌘⇧X (or ⌘⇧S)
    if (mod && !e.shiftKey && (k === 'b' || k === 'i' || k === 'u')) {
      e.preventDefault();
      document.execCommand(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
      cellsRef.current[`${ri}-${ci}`] = el.innerHTML; scheduleSave();
      return;
    }
    if (mod && e.shiftKey && (k === 'x' || k === 's')) {
      e.preventDefault();
      document.execCommand('strikeThrough');
      cellsRef.current[`${ri}-${ci}`] = el.innerHTML; scheduleSave();
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
      cellsRef.current[`${ri}-${ci}`] = el.innerHTML; scheduleSave();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (ri < NUM_ROWS - 1) focusCell(`${ri + 1}-${ci}`, 'start');
    } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const t = e.key === 'ArrowDown' ? ri + 1 : ri - 1;
      if (t >= 0 && t < NUM_ROWS) focusCell(`${t}-${ci}`);
    } else if (e.key === 'ArrowUp' && caretAtEdge(el, 'start')) {
      if (ri > 0) { e.preventDefault(); focusCell(`${ri - 1}-${ci}`); }
    } else if (e.key === 'ArrowDown' && caretAtEdge(el, 'end')) {
      if (ri < NUM_ROWS - 1) { e.preventDefault(); focusCell(`${ri + 1}-${ci}`, 'start'); }
    } else if (e.key === 'ArrowLeft' && caretAtEdge(el, 'start')) {
      if (ci > 0) { e.preventDefault(); focusCell(`${ri}-${ci - 1}`); }
    } else if (e.key === 'ArrowRight' && caretAtEdge(el, 'end')) {
      if (ci < columns.length - 1) { e.preventDefault(); focusCell(`${ri}-${ci + 1}`, 'start'); }
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
    scheduleSave();
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
      // Start at right-center of source, end at left-center of target
      // (flip to left/right if target is to the left).
      const targetRight = tr.left + tr.width / 2 < fr.left + fr.width / 2;
      const x1 = (targetRight ? fr.left : fr.right) - base.left;
      const y1 = fr.top + fr.height / 2 - base.top;
      const x2 = (targetRight ? tr.right : tr.left) - base.left;
      const y2 = tr.top + tr.height / 2 - base.top;
      const dx = Math.max(30, Math.abs(x2 - x1) * 0.4);
      const c1x = x1 + (targetRight ? -dx : dx);
      const c2x = x2 + (targetRight ? dx : -dx);
      geo.push({
        id: a.id,
        d: `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`,
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

  // ── Sheet ops ─────────────────────────────────────────────────────────────

  function flushAndGetSheets(): SheetData[] {
    return snap.current.sheets.map((sh, i) =>
      i === snap.current.activeSheetIdx ? { ...sh, cells: { ...cellsRef.current } } : sh
    );
  }

  function switchSheet(idx: number) {
    if (idx === activeSheetIdx) return;
    const saved = flushAndGetSheets();
    setSheets(saved);
    cellsRef.current = saved[idx]?.cells ?? {};
    setActiveSheetIdx(idx);
    persist({ sheets: saved });
  }

  function addSheet() {
    const saved = flushAndGetSheets();
    const neo: SheetData = { id: crypto.randomUUID(), name: `Sheet ${saved.length + 1}`, cells: {} };
    const next = [...saved, neo];
    setSheets(next); cellsRef.current = {}; setActiveSheetIdx(next.length - 1);
    persist({ sheets: next });
  }

  function deleteSheet(idx: number) {
    if (sheets.length <= 1) return;
    const saved = flushAndGetSheets();
    const next = saved.filter((_, i) => i !== idx);
    const newIdx = Math.min(activeSheetIdx, next.length - 1);
    setSheets(next); cellsRef.current = next[newIdx]?.cells ?? {}; setActiveSheetIdx(newIdx);
    persist({ sheets: next });
  }

  function startRenameSheet(idx: number) { setRenamingSheet(idx); setRenameValue(sheets[idx]?.name ?? ''); }
  function commitRenameSheet() {
    if (renamingSheet === null) return;
    const saved = flushAndGetSheets();
    const next = saved.map((s, i) => i === renamingSheet ? { ...s, name: renameValue.trim() || s.name } : s);
    setSheets(next); setRenamingSheet(null); persist({ sheets: next });
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

  function changeVariant(v: PolicyVariant) {
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
    persist({ variant: v, sheets: newSheets });
  }

  function changePfOrder(o: PFOrder) {
    const newCols = o === 'pro-first' ? PF_PRO_FIRST_COLS : PF_CON_FIRST_COLS;
    const newW = newCols.map(() => DEFAULT_COL_WIDTH);
    setPfOrder(o); setCustomColumns(null); setColumnWidths(newW);
    persist({ pfOrder: o, customColumns: null, columnWidths: newW });
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
    const newSheets = makeSheets(e, defV);
    setVariant(defV); setPfOrder(defO);
    setCustomColumns(null); setColumnWidths(defW);
    setSheets(newSheets); cellsRef.current = {}; setActiveSheetIdx(0);
    persist({ event: e, variant: defV, pfOrder: defO, customColumns: null, columnWidths: defW, sheets: newSheets });
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
          <button
            className="text-sm font-semibold text-ink hover:opacity-70 transition-opacity truncate max-w-[140px]"
            onDoubleClick={() => { setRenamingFlow(true); setRenameValue(flowMeta?.name ?? 'Untitled Flow'); }}
            title="Double-click to rename"
          >
            {flowMeta?.name ?? 'Untitled Flow'}
          </button>
        )}

        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border-subtle)' }} />

        {/* Event toggle */}
        <div className="flex rounded-lg p-0.5" style={{ background: 'var(--mode-toggle-bg)' }}>
          <SmallBtn label="Policy" active={flowEvent === 'policy'} onClick={() => changeFlowEvent('policy')} />
          <SmallBtn label="PF" active={flowEvent === 'pf'} onClick={() => changeFlowEvent('pf')} />
        </div>

        {/* Variant sub-toggle */}
        {flowEvent === 'policy' && (
          <div className="flex rounded-lg p-0.5" style={{ background: 'var(--mode-toggle-bg)' }}>
            <SmallBtn label="Stock Issues" active={variant === 'stock-issues'} onClick={() => changeVariant('stock-issues')} />
            <SmallBtn label="Advantage" active={variant === 'advantage'} onClick={() => changeVariant('advantage')} />
          </div>
        )}
        {flowEvent === 'pf' && (
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

        <ToolDivider />

        {/* Font size */}
        <ToolBtn onClick={() => changeFontSize(-1)} title="Smaller text"><span style={{ fontSize: 11 }}>A−</span></ToolBtn>
        <span className="text-xs w-4 text-center tabular-nums shrink-0" style={{ color: 'var(--label-color)' }}>{fontSize}</span>
        <ToolBtn onClick={() => changeFontSize(1)} title="Larger text"><span style={{ fontSize: 13 }}>A+</span></ToolBtn>

        <ToolDivider />

        {/* Zoom */}
        <ToolBtn onClick={() => changeZoom(zoom - 10)} title="Zoom out"><span style={{ fontSize: 15 }}>−</span></ToolBtn>
        <button
          className="text-xs w-9 text-center tabular-nums transition hover:opacity-70 shrink-0"
          style={{ color: 'var(--label-color)' }}
          onClick={fitZoom}
          title="Click to fit columns to window width"
        >
          {zoom}%
        </button>
        <ToolBtn onClick={() => changeZoom(zoom + 10)} title="Zoom in"><span style={{ fontSize: 14 }}>+</span></ToolBtn>
        <ToolBtn onClick={fitZoom} title="Fit columns to window"><IcoFit /></ToolBtn>

        {customColumns && (
          <ToolBtn onClick={resetColumns} title="Reset columns to default"><IcoResetCols /></ToolBtn>
        )}

        <ToolDivider />

        {/* Undo / Redo */}
        <ToolBtn onClick={undo} title="Undo (⌘Z)"><IcoUndo /></ToolBtn>
        <ToolBtn onClick={redo} title="Redo (⌘⇧Z)"><IcoRedo /></ToolBtn>

        <ToolDivider />

        {/* Find */}
        <ToolBtn onClick={() => { setFindOpen(true); setTimeout(() => findInputRef.current?.focus(), 0); }} active={findOpen} title="Find (⌘F)"><IcoFind /></ToolBtn>

        {/* Draw arrow */}
        <ToolBtn
          onClick={() => { setDrawMode((v) => !v); setArrowFrom(null); }}
          active={drawMode}
          title={drawMode ? 'Click a source cell, then a target cell — Esc to cancel' : 'Draw an arrow linking two cells'}
        >
          <IcoArrow />
        </ToolBtn>

        {/* Share */}
        <div className="relative shrink-0">
          <ToolBtn onClick={() => setShareOpen(true)} title="Share / Open / Export"><ShareIcon /></ToolBtn>
          {flowMeta?.shared && (
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full pointer-events-none" style={{ background: '#0077ed' }} />
          )}
        </div>

        {/* Shortcuts help */}
        <ToolBtn title={'Keyboard shortcuts:\nTab → next column   Enter → next row   Shift+Enter → line break\nArrows → move between cells   Alt+↑↓ → move a cell up/down\n⌘B / ⌘I / ⌘U → bold · italic · underline   ⌘⇧X → strikethrough\n⌘Z / ⌘⇧Z → undo · redo   ⌘F → find\nDouble-click a column header to rename · click ▾ for color'}>
          <IcoHelp />
        </ToolBtn>
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
            placeholder="Find in all sheets…"
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
          {arrowFrom ? 'Now click the target cell' : 'Click the source cell to start the arrow'}
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
            const data = await window.warroom?.storage.read(`flow_data_${flowId}`);
            return data ?? {};
          }}
          onClose={() => setShareOpen(false)}
          onExportXlsx={exportXlsx}
          onOpenInExcel={openInExcel}
          onOpenInSheets={openInSheets}
        />
      )}

      {/* ── Grid ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto scroll-thin"
        style={{ background: 'var(--bg-main)' }}
        onScroll={() => requestAnimationFrame(recomputeArrows)}
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
                    <span
                      className="text-xs font-bold truncate px-5"
                      style={{ color: 'var(--nav-active-color)', cursor: 'default' }}
                      onDoubleClick={() => startRenameCol(ci)}
                      title="Double-click to rename"
                    >
                      {col}
                    </span>
                  )}

                  {/* Column menu trigger — always visible for discoverability */}
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
                return (
                  <div
                    key={ci}
                    className="relative"
                    style={{
                      background: colBg(colColor(ci), dark, false),
                      borderRight: ci < columns.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      borderBottom: '1px solid var(--border-subtle)',
                      boxShadow: isArrowSrc ? 'inset 0 0 0 2px var(--nav-active-color)' : undefined,
                      cursor: drawMode ? 'crosshair' : undefined,
                    }}
                    onMouseEnter={() => setHoveredCell({ ri, ci })}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <div
                      key={`${activeSheet?.id ?? 'sheet'}-${cellKey}-${reloadNonce}-${cellNonce}`}
                      ref={(el) => {
                        cellEls.current[cellKey] = el;
                        if (el && el.dataset.init !== '1') { el.innerHTML = cellToHtml(cellsRef.current[cellKey] ?? ''); el.dataset.init = '1'; }
                      }}
                      contentEditable={!drawMode}
                      suppressContentEditableWarning
                      onFocus={() => { focusedCell.current = cellKey; }}
                      onInput={(e) => handleInput(ri, ci, e)}
                      onKeyDown={(e) => handleKeyDown(ri, ci, e)}
                      onMouseDown={(e) => { if (drawMode) { e.preventDefault(); handleArrowCellClick(cellKey); } }}
                      className="w-full outline-none bg-transparent leading-snug whitespace-pre-wrap break-words"
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
                          <button
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => moveCell(ri, ci, 'up')}
                            className="flex items-center justify-center rounded transition"
                            style={{
                              width: 14, height: 14, fontSize: 8, lineHeight: 1,
                              background: 'var(--bg-elevated)', border: '1px solid var(--border-med)',
                              color: 'var(--label-color)', cursor: 'pointer',
                            }}
                            title="Move content up one row"
                          >▲</button>
                        )}
                        {ri < NUM_ROWS - 1 && (
                          <button
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => moveCell(ri, ci, 'down')}
                            className="flex items-center justify-center rounded transition"
                            style={{
                              width: 14, height: 14, fontSize: 8, lineHeight: 1,
                              background: 'var(--bg-elevated)', border: '1px solid var(--border-med)',
                              color: 'var(--label-color)', cursor: 'pointer',
                            }}
                            title="Move content down one row"
                          >▼</button>
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
            />
          ))}
        </div>

        {/* Add sheet — RIGHT side */}
        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border-subtle)' }} />
        <button
          className="flex items-center justify-center w-8 h-8 shrink-0 text-lg font-light transition"
          style={{ color: 'var(--label-color)' }}
          onClick={addSheet}
          title="Add sheet"
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--nav-active-color)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--label-color)')}
        >+</button>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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
function IcoHelp() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" />
      <path d="M8 8a2 2 0 1 1 2.7 1.9c-.5.2-.7.6-.7 1.1v.4" />
      <circle cx="10" cy="14" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Shared compact toolbar icon button with a consistent hover background.
function ToolBtn({ children, onClick, onMouseDown, title, active, disabled }: {
  children: React.ReactNode; onClick?: () => void; onMouseDown?: (e: React.MouseEvent) => void;
  title?: string; active?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      onMouseDown={onMouseDown}
      title={title}
      disabled={disabled}
      className="flex items-center justify-center rounded-md transition shrink-0"
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
  onClick, onDoubleClick, onDelete,
}: {
  name: string; active: boolean; renaming: boolean;
  renameValue: string; onRenameChange: (v: string) => void;
  onCommitRename: () => void; onCancelRename: () => void;
  onClick: () => void; onDoubleClick: () => void; onDelete?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="flex items-center shrink-0"
      style={{
        height: '100%',
        borderRight: '1px solid var(--border-subtle)',
        background: active ? 'var(--bg-card)' : 'transparent',
        minWidth: 72, maxWidth: 130,
      }}
      onMouseEnter={() => setHovered(true)}
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
        <button
          className="flex-1 text-left truncate text-xs font-medium px-3"
          style={{ color: active ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)' }}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          title="Double-click to rename"
        >
          {name}
        </button>
      )}
      {onDelete && !renaming && (
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
          title="Delete sheet"
        >×</button>
      )}
    </div>
  );
}
