// Selecting several flow cells at once, and moving them as a group.
//
// A selection is always WITHIN ONE COLUMN. That isn't a simplification for its
// own sake: a column is a speech, and the whole point of grabbing a run of
// cells is "these arguments belong somewhere else" — either further down this
// speech, or over in the speech that answers it. A rectangle spanning columns
// has no honest answer for what ⌘← should do to it.
//
// Moving OVERWRITES what it lands on. The alternative (pushing occupied cells
// out of the way) silently rewrites rows the user never selected, which on a
// flow means arguments quietly sliding away from the line they were answering.
//
// Everything here is pure so scripts/test-flow-selection.ts can exercise it
// without React or a DOM. FlowView.tsx owns the pointer/keyboard handling.

export interface CellSelection {
  /** Column index every selected cell sits in. */
  col: number;
  /** Row indices, ascending, no duplicates. */
  rows: number[];
}

export function cellKey(row: number, col: number): string { return `${row}-${col}`; }

export function isSelected(sel: CellSelection | null, row: number, col: number): boolean {
  return !!sel && sel.col === col && sel.rows.includes(row);
}

function normalize(col: number, rows: number[]): CellSelection | null {
  const uniq = [...new Set(rows)].filter((r) => r >= 0).sort((a, b) => a - b);
  return uniq.length ? { col, rows: uniq } : null;
}

/**
 * ⌘-click: add this cell, or drop it if it was already in. Clicking into a
 * different column starts over rather than silently abandoning the old column —
 * a selection that spanned two columns couldn't be moved sideways.
 */
export function toggleCell(sel: CellSelection | null, row: number, col: number): CellSelection | null {
  if (!sel || sel.col !== col) return { col, rows: [row] };
  return sel.rows.includes(row)
    ? normalize(col, sel.rows.filter((r) => r !== row))
    : normalize(col, [...sel.rows, row]);
}

/** Shift-click: every row between the anchor and here, inclusive. */
export function rangeTo(anchorRow: number, row: number, col: number): CellSelection {
  const lo = Math.min(anchorRow, row), hi = Math.max(anchorRow, row);
  return { col, rows: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) };
}

export interface MovePlan {
  /** Source keys, in selection order. */
  from: string[];
  /** Destination keys, parallel to `from`. */
  to: string[];
  /** Where the selection ends up. */
  next: CellSelection;
  /** Every cell key the move disturbs — sources and destinations. Arrows
   *  touching any of these are dropped (see dropArrowsTouching). */
  touched: Set<string>;
}

/**
 * Where a move by (dRow, dCol) would land, or null if it can't happen.
 *
 * The group keeps its internal spacing — a selection of rows 3, 4 and 9 moved
 * down one is 4, 5 and 10, gap intact. `clamp` is for dragging, where the
 * pointer can wander past the end of the grid and the sane response is to stop
 * at the edge; a keyboard move refuses instead, so ⌘↓ at the bottom does
 * nothing rather than quietly collapsing the group against the last row.
 */
export function planMove(
  sel: CellSelection | null,
  dRow: number,
  dCol: number,
  numRows: number,
  numCols: number,
  opts: { clamp?: boolean } = {},
): MovePlan | null {
  if (!sel || sel.rows.length === 0) return null;
  const col = sel.col + dCol;
  if (col < 0 || col >= numCols) return null;

  let shift = dRow;
  const lo = sel.rows[0], hi = sel.rows[sel.rows.length - 1];
  if (lo + shift < 0 || hi + shift > numRows - 1) {
    if (!opts.clamp) return null;
    shift = Math.max(-lo, Math.min(shift, numRows - 1 - hi));
  }
  if (shift === 0 && dCol === 0) return null;

  const from = sel.rows.map((r) => cellKey(r, sel.col));
  const rows = sel.rows.map((r) => r + shift);
  const to = rows.map((r) => cellKey(r, col));
  return { from, to, next: { col, rows }, touched: new Set([...from, ...to]) };
}

/** The same thing, for a drop: put the grabbed cell on `targetRow`/`targetCol`. */
export function planDrop(
  sel: CellSelection | null,
  grabRow: number,
  targetRow: number,
  targetCol: number,
  numRows: number,
  numCols: number,
): MovePlan | null {
  if (!sel) return null;
  return planMove(sel, targetRow - grabRow, targetCol - sel.col, numRows, numCols, { clamp: true });
}

/**
 * Apply a plan to a cell map. Destinations take the moved content outright;
 * sources are emptied unless they are also destinations (a one-row nudge
 * overlaps itself). An empty source clears its destination rather than leaving
 * whatever was there — moving a blank cell onto text still means "this is blank
 * now", and leaving the old text behind would look like the move failed.
 */
export function applyMove(cells: Record<string, string>, plan: MovePlan): Record<string, string> {
  const next = { ...cells };
  const payload = plan.from.map((k) => cells[k] ?? '');
  const dest = new Set(plan.to);
  plan.from.forEach((k) => { if (!dest.has(k)) delete next[k]; });
  plan.to.forEach((k, i) => { if (payload[i]) next[k] = payload[i]; else delete next[k]; });
  return next;
}

/** Drop a payload onto another sheet (a cross-tab drag). Overwrites, same rule. */
export function applyPaste(cells: Record<string, string>, keys: string[], payload: string[]): Record<string, string> {
  const next = { ...cells };
  keys.forEach((k, i) => { if (payload[i]) next[k] = payload[i]; else delete next[k]; });
  return next;
}

/** Empty every selected cell (Delete with a selection). */
export function clearCells(cells: Record<string, string>, keys: string[]): Record<string, string> {
  const next = { ...cells };
  keys.forEach((k) => delete next[k]);
  return next;
}

/** The keys a selection covers, ascending. */
export function selectionKeys(sel: CellSelection | null): string[] {
  return sel ? sel.rows.map((r) => cellKey(r, sel.col)) : [];
}
