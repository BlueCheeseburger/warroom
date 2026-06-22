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

interface SheetData {
  id: string;
  name: string;
  cells: Record<string, string>;
}

interface StoredFlowData {
  event: 'policy' | 'pf';
  variant: PolicyVariant;
  pfOrder: PFOrder;
  sheets: SheetData[];
  columnWidths: number[];
  customColumns: string[] | null;
  fontSize: number;
  zoom: number;
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

function colBg(isBlue: boolean, isDark: boolean, isHeader: boolean): string {
  if (isDark) {
    return isBlue
      ? (isHeader ? 'rgba(37,99,235,0.32)' : 'rgba(37,99,235,0.11)')
      : (isHeader ? 'rgba(22,163,74,0.30)' : 'rgba(22,163,74,0.10)');
  }
  return isBlue
    ? (isHeader ? 'rgba(191,219,254,0.85)' : 'rgba(219,234,254,0.45)')
    : (isHeader ? 'rgba(187,247,208,0.85)' : 'rgba(220,252,231,0.45)');
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
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [columnWidths, setColumnWidths] = useState<number[]>([]);
  const [customColumns, setCustomColumns] = useState<string[] | null>(null);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [zoom, setZoom] = useState(100);
  const [variant, setVariant] = useState<PolicyVariant>('stock-issues');
  const [pfOrder, setPfOrder] = useState<PFOrder>('pro-first');

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
  const cellEls = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const resizing = useRef<{ idx: number; startX: number; startW: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const flowNameInputRef = useRef<HTMLInputElement>(null);

  // Always-current snapshot for use in async/event callbacks
  const snap = useRef({ sheets, columnWidths, customColumns, fontSize, zoom, variant, pfOrder, activeSheetIdx });
  useEffect(() => { snap.current = { sheets, columnWidths, customColumns, fontSize, zoom, variant, pfOrder, activeSheetIdx }; });

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
        setFontSize(DEFAULT_FONT_SIZE);
        setZoom(100);
        cellsRef.current = {};
      }
      setActiveSheetIdx(0);
      setLoaded(true);
    }).catch(() => {
      const rawEv = flowMeta?.event ?? event;
      const ev: 'policy' | 'pf' = rawEv === 'pf' ? 'pf' : 'policy';
      const def = makeDefaultData(ev, 'stock-issues', 'pro-first');
      setVariant('stock-issues');
      setPfOrder('pro-first');
      setSheets(def.sheets);
      setColumnWidths(def.columnWidths);
      setCustomColumns(null);
      setFontSize(DEFAULT_FONT_SIZE);
      setZoom(100);
      cellsRef.current = {};
      setActiveSheetIdx(0);
      setLoaded(true);
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
      fontSize: s.fontSize,
      zoom: s.zoom,
      ...overrides,
    } as StoredFlowData);
  }

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const s = snap.current;
      const updated = s.sheets.map((sh, i) =>
        i === s.activeSheetIdx ? { ...sh, cells: { ...cellsRef.current } } : sh
      );
      setSheets(updated);
      persist({ sheets: updated });
    }, 600);
  }

  // ── Cell input / keyboard ─────────────────────────────────────────────────

  function handleInput(ri: number, ci: number, e: React.FormEvent<HTMLTextAreaElement>) {
    const el = e.target as HTMLTextAreaElement;
    cellsRef.current[`${ri}-${ci}`] = el.value;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    scheduleSave();
  }

  // Grow every cell to fit its content so rows auto-size like a spreadsheet.
  // Cells loaded via defaultValue don't fire onInput, so they need an explicit pass.
  function growAllCells() {
    for (const el of Object.values(cellEls.current)) {
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }

  function handleKeyDown(ri: number, ci: number, e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const next = e.shiftKey ? ci - 1 : ci + 1;
      if (next >= 0 && next < columns.length) {
        cellEls.current[`${ri}-${next}`]?.focus();
      } else if (!e.shiftKey && ri < NUM_ROWS - 1) {
        cellEls.current[`${ri + 1}-0`]?.focus();
      }
    } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (ri < NUM_ROWS - 1) cellEls.current[`${ri + 1}-${ci}`]?.focus();
    } else if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      if (ri < NUM_ROWS - 1) cellEls.current[`${ri + 1}-${ci}`]?.focus();
    } else if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault();
      if (ri > 0) cellEls.current[`${ri - 1}-${ci}`]?.focus();
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
    if (el) { el.value = b; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
    if (targetEl) { targetEl.value = a; targetEl.style.height = 'auto'; targetEl.style.height = targetEl.scrollHeight + 'px'; }
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
      // Column width changed → text re-wraps, so re-grow rows to fit.
      requestAnimationFrame(growAllCells);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-size all cells whenever content or layout changes ────────────────
  useLayoutEffect(() => {
    growAllCells();
  }, [loaded, reloadNonce, activeSheetIdx, zoom, fontSize, customColumns]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setCustomColumns(next); setRenamingCol(null); persist({ customColumns: next });
  }
  function insertColumn(at: number) {
    setColMenu(null);
    const next = [...columns]; next.splice(at, 0, `Col ${next.length + 1}`);
    const newW = [...snap.current.columnWidths]; newW.splice(at, 0, DEFAULT_COL_WIDTH);
    setCustomColumns(next); setColumnWidths(newW);
    persist({ customColumns: next, columnWidths: newW });
  }
  function deleteColumn(ci: number) {
    setColMenu(null);
    if (columns.length <= 2) return;
    const next = columns.filter((_, i) => i !== ci);
    const newW = snap.current.columnWidths.filter((_, i) => i !== ci);
    setCustomColumns(next); setColumnWidths(newW);
    persist({ customColumns: next, columnWidths: newW });
  }
  function resetColumns() {
    setCustomColumns(null);
    const defW = baseCols.map(() => DEFAULT_COL_WIDTH);
    setColumnWidths(defW);
    persist({ customColumns: null, columnWidths: defW });
  }

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
        const row = cols.map((_, ci) => sheet.cells[`${ri}-${ci}`] ?? '');
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
        className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', minHeight: 44 }}
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

        {/* Font size */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--label-color)' }}>Font</span>
          <button className="btn px-1.5 py-0.5 text-sm leading-none" onClick={() => changeFontSize(-1)}>−</button>
          <span className="text-xs w-5 text-center tabular-nums" style={{ color: 'var(--label-color)' }}>{fontSize}</span>
          <button className="btn px-1.5 py-0.5 text-sm leading-none" onClick={() => changeFontSize(1)}>+</button>
        </div>

        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border-subtle)' }} />

        {/* Zoom */}
        <div className="flex items-center gap-1 shrink-0">
          <button className="btn px-1.5 py-0.5 text-sm leading-none" onClick={() => changeZoom(zoom - 10)} title="Zoom out">−</button>
          <button
            className="text-xs w-10 text-center tabular-nums transition hover:opacity-70"
            style={{ color: 'var(--label-color)' }}
            onClick={fitZoom}
            title="Click to fit columns to window width"
          >
            {zoom}%
          </button>
          <button className="btn px-1.5 py-0.5 text-sm leading-none" onClick={() => changeZoom(zoom + 10)} title="Zoom in">+</button>
          <button className="btn text-xs px-2 py-0.5" onClick={fitZoom} title="Fit columns to window">Fit</button>
        </div>

        {customColumns && (
          <button className="btn text-xs px-2 py-0.5 shrink-0" onClick={resetColumns}>Reset cols</button>
        )}

        {/* Share button — icon only */}
        <div className="relative shrink-0">
          <button
            className="flex items-center justify-center w-8 h-8 rounded-lg transition"
            onClick={() => setShareOpen(true)}
            title="Share / Open / Export"
            style={{ background: 'transparent', color: 'var(--nav-inactive-color)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <ShareIcon />
          </button>
          {flowMeta?.shared && (
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full pointer-events-none" style={{ background: '#0077ed' }} />
          )}
        </div>

        {/* Shortcuts hint */}
        <div
          className="text-[10px] px-1.5 py-0.5 rounded shrink-0 cursor-default"
          style={{ color: 'var(--placeholder)', background: 'var(--mode-toggle-bg)' }}
          title="Tab → next col  |  Enter → next row  |  Shift+Enter → newline  |  Alt+↑↓ → move rows  |  Double-click column header → rename  |  Hover cell → ▲▼ to shift content"
        >
          ?
        </div>
      </div>

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
      <div ref={containerRef} className="flex-1 overflow-auto scroll-thin" style={{ background: 'var(--bg-main)' }}>
        <div style={{ minWidth: totalWidth + 'px' }}>

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
              const isBlue = blueCols.has(ci);
              return (
                <div
                  key={ci}
                  className="relative flex items-center justify-center"
                  style={{
                    background: colBg(isBlue, dark, true),
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

                  {/* Column menu trigger */}
                  <button
                    data-col-menu
                    className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded transition opacity-0 hover:opacity-100"
                    style={{ color: 'var(--label-color)', fontSize: 9 }}
                    onClick={(e) => { e.stopPropagation(); setColMenu(colMenu === ci ? null : ci); }}
                  >
                    ▾
                  </button>

                  {colMenu === ci && (
                    <div
                      data-col-menu
                      className="absolute z-50 py-1 rounded-lg shadow-xl text-xs"
                      style={{
                        top: '100%', left: '50%', transform: 'translateX(-50%)',
                        minWidth: 140, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <DropBtn onClick={() => startRenameCol(ci)}>Rename column</DropBtn>
                      <DropBtn onClick={() => insertColumn(ci)}>Insert column left</DropBtn>
                      <DropBtn onClick={() => insertColumn(ci + 1)}>Insert column right</DropBtn>
                      {columns.length > 2 && <DropBtn onClick={() => deleteColumn(ci)} danger>Delete column</DropBtn>}
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
                const isBlue = blueCols.has(ci);
                const cellKey = `${ri}-${ci}`;
                const isHovered = hoveredCell?.ri === ri && hoveredCell?.ci === ci;
                return (
                  <div
                    key={ci}
                    className="relative"
                    style={{
                      background: colBg(isBlue, dark, false),
                      borderRight: ci < columns.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                    onMouseEnter={() => setHoveredCell({ ri, ci })}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <textarea
                      key={`${activeSheet?.id ?? 'sheet'}-${cellKey}-${reloadNonce}`}
                      ref={(el) => { cellEls.current[cellKey] = el; }}
                      defaultValue={cellsRef.current[cellKey] ?? ''}
                      rows={1}
                      onInput={(e) => handleInput(ri, ci, e)}
                      onKeyDown={(e) => handleKeyDown(ri, ci, e)}
                      className="w-full resize-none overflow-hidden outline-none bg-transparent leading-snug"
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
                    {isHovered && (
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
