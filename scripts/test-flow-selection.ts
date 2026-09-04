// Selecting several flow cells and moving them as a group.
//
// The rules being pinned down here are the ones a debater would notice going
// wrong mid-round: a group keeps its internal spacing when it moves, a move
// overwrites what it lands on (never silently shuffles unrelated rows), and a
// move that would run off the grid does nothing rather than collapsing the
// group against the edge.
//
// Run:  npx tsx scripts/test-flow-selection.ts

import {
  toggleCell, rangeTo, planMove, planDrop, applyMove, applyPaste,
  clearCells, selectionKeys, isSelected, cellKey,
} from '../src/lib/flowSelection';

const ROWS = 60, COLS = 7;

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  →  ' + extra : ''}`); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n[1] Building a selection with ⌘-click');
{
  const a = toggleCell(null, 3, 1);
  check('first click selects one cell', eq(a, { col: 1, rows: [3] }));
  const b = toggleCell(a, 5, 1);
  check('a second click adds to it', eq(b, { col: 1, rows: [3, 5] }));
  const c = toggleCell(b, 4, 1);
  check('rows stay sorted regardless of click order', eq(c, { col: 1, rows: [3, 4, 5] }));
  const d = toggleCell(c, 4, 1);
  check('clicking a selected cell removes it', eq(d, { col: 1, rows: [3, 5] }));
  check('removing the last cell clears the selection',
    toggleCell(toggleCell(null, 2, 0), 2, 0) === null);
  // One column at a time: a group spanning two columns has no sane ⌘← behaviour.
  check('clicking into another column starts over',
    eq(toggleCell(c, 9, 4), { col: 4, rows: [9] }));
}

console.log('\n[2] Shift-click ranges');
{
  check('anchor above, click below', eq(rangeTo(2, 5, 0), { col: 0, rows: [2, 3, 4, 5] }));
  check('and the same the other way round', eq(rangeTo(5, 2, 0), { col: 0, rows: [2, 3, 4, 5] }));
  check('a range onto itself is one cell', eq(rangeTo(7, 7, 3), { col: 3, rows: [7] }));
}

console.log('\n[3] Where a move lands');
{
  const sel = { col: 2, rows: [3, 4, 9] };
  const down = planMove(sel, 1, 0, ROWS, COLS)!;
  check('every row shifts by one', eq(down.next.rows, [4, 5, 10]));
  check('the gap inside the group is preserved', down.next.rows[2] - down.next.rows[1] === 5);
  check('the column is unchanged', down.next.col === 2);
  check('sources and destinations are both counted as touched',
    down.touched.has('3-2') && down.touched.has('4-2') && down.touched.has('10-2'));

  const right = planMove(sel, 0, 1, ROWS, COLS)!;
  check('a sideways move keeps the rows', eq(right.next.rows, [3, 4, 9]));
  check('and lands in the next column', right.next.col === 3);

  check('a move off the left edge is refused', planMove({ col: 0, rows: [1] }, 0, -1, ROWS, COLS) === null);
  check('a move off the right edge is refused', planMove({ col: COLS - 1, rows: [1] }, 0, 1, ROWS, COLS) === null);
  check('a move off the top is refused', planMove({ col: 0, rows: [0, 2] }, -1, 0, ROWS, COLS) === null);
  check('a move off the bottom is refused', planMove({ col: 0, rows: [ROWS - 1] }, 1, 0, ROWS, COLS) === null);
  // Refusing beats clamping for the keyboard: silently squashing the group
  // against the last row would look like ⌘↓ corrupted the selection.
  check('a partly-off-grid group is refused whole, not clamped',
    planMove({ col: 0, rows: [ROWS - 2, ROWS - 1] }, 1, 0, ROWS, COLS) === null);
  check('a no-op move returns null', planMove({ col: 0, rows: [1] }, 0, 0, ROWS, COLS) === null);
  check('an empty selection moves nowhere', planMove({ col: 0, rows: [] }, 1, 0, ROWS, COLS) === null);
  check('no selection at all moves nowhere', planMove(null, 1, 0, ROWS, COLS) === null);
}

console.log('\n[4] Dropping a dragged group');
{
  const sel = { col: 1, rows: [10, 11, 12] };
  // Grabbed the middle cell and dropped it on row 20 — the group follows the
  // cell that was actually under the cursor.
  const p = planDrop(sel, 11, 20, 3, ROWS, COLS)!;
  check('the grabbed cell lands where it was dropped', p.next.rows[1] === 20);
  check('the rest of the group follows it', eq(p.next.rows, [19, 20, 21]));
  check('and it lands in the dropped-on column', p.next.col === 3);

  // A drag CAN clamp — the pointer wanders past the end of the grid and
  // stopping at the edge is the only sane reading of that gesture.
  const low = planDrop({ col: 0, rows: [0, 1] }, 0, ROWS - 1, 0, ROWS, COLS)!;
  check('a drag past the bottom clamps instead of failing', eq(low.next.rows, [ROWS - 2, ROWS - 1]));
}

console.log('\n[5] Applying a move to the cells');
{
  const cells: Record<string, string> = { '3-0': 'aff', '4-0': 'link', '7-0': 'IN THE WAY' };
  const plan = planMove({ col: 0, rows: [3, 4] }, 3, 0, ROWS, COLS)!;
  const out = applyMove(cells, plan);
  check('content arrives at the destination', out['6-0'] === 'aff' && out['7-0'] === 'link');
  check('what was already there is overwritten', out['7-0'] === 'link');
  check('the sources are emptied', !('3-0' in out) && !('4-0' in out));
  check('the input map is not mutated', cells['3-0'] === 'aff');

  // A one-row nudge: the source of one cell is the destination of another, so
  // clearing sources blindly would erase content that had just been moved in.
  const nudge = planMove({ col: 0, rows: [3, 4] }, 1, 0, ROWS, COLS)!;
  const out2 = applyMove({ '3-0': 'a', '4-0': 'b' }, nudge);
  check('an overlapping nudge keeps both cells', out2['4-0'] === 'a' && out2['5-0'] === 'b');
  check('and frees only the row it actually left', !('3-0' in out2));

  // Moving a blank over text still means "blank now" — leaving the old text
  // would read as the move having failed.
  const blank = planMove({ col: 0, rows: [1] }, 1, 0, ROWS, COLS)!;
  check('a blank source clears its destination', !('2-0' in applyMove({ '2-0': 'old' }, blank)));
}

console.log('\n[6] Cross-tab paste and delete');
{
  const landed = applyPaste({ '5-1': 'existing' }, ['5-1', '6-1'], ['moved', 'also']);
  check('a cross-tab drop overwrites the target', landed['5-1'] === 'moved');
  check('and writes the rest of the group', landed['6-1'] === 'also');

  const cleared = clearCells({ '1-0': 'x', '2-0': 'y', '3-0': 'z' }, ['1-0', '3-0']);
  check('delete empties exactly the selected cells', !('1-0' in cleared) && !('3-0' in cleared));
  check('and leaves the others alone', cleared['2-0'] === 'y');
}

console.log('\n[7] Small helpers');
{
  check('keys are row-col', cellKey(4, 2) === '4-2');
  check('selectionKeys walks the group', eq(selectionKeys({ col: 2, rows: [1, 3] }), ['1-2', '3-2']));
  check('selectionKeys of nothing is empty', eq(selectionKeys(null), []));
  check('isSelected finds a member', isSelected({ col: 2, rows: [1, 3] }, 3, 2));
  check('isSelected rejects the same row in another column', !isSelected({ col: 2, rows: [3] }, 3, 1));
  check('isSelected of nothing is false', !isSelected(null, 0, 0));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
