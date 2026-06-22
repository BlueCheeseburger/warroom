// Faithful simulation of live collaborative flowing WITHOUT Supabase.
// Two (or three) Y.Docs are wired together through the exact same update-relay
// path flowSync uses over the network: local updates (origin !== 'remote') are
// forwarded and applied on the peer with origin 'remote'. This exercises the
// real CRDT merge code in flowDoc.ts that users will hit.
//
// Run:  npx tsx scripts/test-live-flows.ts

import * as Y from 'yjs';
import {
  seedDoc, docToData, cellText, setYText, sheetCells, findSheet,
  u8ToB64, b64ToU8, LOCAL_ORIGIN, REMOTE_ORIGIN, FlowDocData,
} from '../src/lib/flowDoc';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  →  ' + extra : ''}`); }
}

// HTML upgrader matching FlowView.cellToHtml for plain text (no formatting here).
const cellToHtml = (v: string) => v;

const sample: FlowDocData = {
  event: 'policy', variant: 'stock-issues', pfOrder: 'pro-first',
  sheets: [
    { id: 's1', name: 'Solvency', cells: { '0-0': 'plan solves', '1-2': 'perm do both' }, arrows: [] },
    { id: 's2', name: 'Off 1', cells: { '0-1': 'DA uniqueness' }, arrows: [] },
  ],
  columnWidths: [185, 185, 185, 185, 185, 185, 185],
  customColumns: null,
  columnColors: [null, null, null, null, null, null, null],
  fontSize: 13, zoom: 100,
};

// Wire two docs together exactly like flowSync's transport (minus base64/Supabase).
function connect(a: Y.Doc, b: Y.Doc) {
  a.on('update', (u: Uint8Array, origin: any) => { if (origin === REMOTE_ORIGIN) return; Y.applyUpdate(b, u, REMOTE_ORIGIN); });
  b.on('update', (u: Uint8Array, origin: any) => { if (origin === REMOTE_ORIGIN) return; Y.applyUpdate(a, u, REMOTE_ORIGIN); });
}

// ── 1. seed / extract roundtrip ──────────────────────────────────────────────
console.log('\n[1] seedDoc / docToData roundtrip');
{
  const doc = new Y.Doc();
  seedDoc(doc, sample, cellToHtml);
  const out = docToData(doc);
  check('extract is non-null', !!out);
  check('event/variant preserved', out!.event === 'policy' && out!.variant === 'stock-issues');
  check('sheet names preserved', out!.sheets.map((s) => s.name).join(',') === 'Solvency,Off 1');
  check('cell content preserved', out!.sheets[0].cells['0-0'] === 'plan solves' && out!.sheets[0].cells['1-2'] === 'perm do both');
  check('columnWidths preserved', JSON.stringify(out!.columnWidths) === JSON.stringify(sample.columnWidths));
  check('empty cells omitted', !('5-5' in out!.sheets[0].cells));
}

// ── 2. setYText minimal-diff correctness (simulated typing) ───────────────────
console.log('\n[2] setYText incremental edits');
{
  const doc = new Y.Doc();
  const t = doc.getText('t');
  const states = ['', 's', 'so', 'sol', 'solv', 'solvency', 'solvency ', 'solvency!', 'olvency!', 'olvenc'];
  let ok = true;
  for (const s of states) { setYText(t, s); if (t.toString() !== s) { ok = false; break; } }
  check('toString tracks every state', ok, t.toString());
  // mid-string insert
  setYText(t, 'olvenc');
  setYText(t, 'oXlvenc');
  check('mid-string insert applies', t.toString() === 'oXlvenc');
}

// ── 3. base64 transport roundtrip ────────────────────────────────────────────
console.log('\n[3] base64 update transport');
{
  const doc = new Y.Doc();
  seedDoc(doc, sample, cellToHtml);
  const b64 = u8ToB64(Y.encodeStateAsUpdate(doc));
  const doc2 = new Y.Doc();
  Y.applyUpdate(doc2, b64ToU8(b64), REMOTE_ORIGIN);
  check('snapshot survives base64 roundtrip', JSON.stringify(docToData(doc2)) === JSON.stringify(docToData(doc)));
}

// ── 4. two clients, DIFFERENT cells, concurrent ──────────────────────────────
console.log('\n[4] concurrent edits in different cells');
{
  const A = new Y.Doc();
  seedDoc(A, sample, cellToHtml);
  const B = new Y.Doc();
  Y.applyUpdate(B, Y.encodeStateAsUpdate(A), REMOTE_ORIGIN); // B joins with snapshot
  connect(A, B);

  // simultaneous edits to two different cells of sheet s1
  setYText(cellText(A, 's1', '0-0')!, 'plan solves warming');
  setYText(cellText(B, 's1', '3-0')!, 'extend solvency');

  const da = docToData(A)!.sheets[0].cells;
  const db = docToData(B)!.sheets[0].cells;
  check('A sees B edit', da['3-0'] === 'extend solvency');
  check('B sees A edit', db['0-0'] === 'plan solves warming');
  check('both converge', JSON.stringify(da) === JSON.stringify(db), JSON.stringify(da) + ' vs ' + JSON.stringify(db));
}

// ── 5. two clients, SAME cell, concurrent (no loss, deterministic merge) ──────
console.log('\n[5] concurrent edits in the SAME cell');
{
  const A = new Y.Doc();
  seedDoc(A, { ...sample, sheets: [{ id: 's1', name: 'S', cells: { '0-0': 'base ' }, arrows: [] }] }, cellToHtml);
  const B = new Y.Doc();
  Y.applyUpdate(B, Y.encodeStateAsUpdate(A), REMOTE_ORIGIN);

  // Edit BOTH offline (disconnected), then connect so updates cross — the real
  // "both typing at once" race. Each appends its own word to the shared base.
  setYText(cellText(A, 's1', '0-0')!, 'base aff');
  setYText(cellText(B, 's1', '0-0')!, 'base neg');
  connect(A, B);
  // flush both directions
  Y.applyUpdate(B, Y.encodeStateAsUpdate(A), REMOTE_ORIGIN);
  Y.applyUpdate(A, Y.encodeStateAsUpdate(B), REMOTE_ORIGIN);

  const ca = cellText(A, 's1', '0-0')!.toString();
  const cb = cellText(B, 's1', '0-0')!.toString();
  check('same-cell converges identically', ca === cb, `${ca} vs ${cb}`);
  check('no text silently dropped (both words survive)', ca.includes('aff') && ca.includes('neg'), ca);
}

// ── 6. late join converges via full-state rebroadcast ────────────────────────
console.log('\n[6] late joiner converges');
{
  const A = new Y.Doc();
  seedDoc(A, sample, cellToHtml);
  setYText(cellText(A, 's1', '0-0')!, 'plan solves warming and econ');

  // C joins with NO snapshot, then receives full state (what flowSync does on
  // presence-grow). It must end up identical to A.
  const C = new Y.Doc();
  Y.applyUpdate(C, Y.encodeStateAsUpdate(A), REMOTE_ORIGIN);
  check('late joiner has all content', docToData(C)!.sheets[0].cells['0-0'] === 'plan solves warming and econ');
  check('late joiner fully matches', JSON.stringify(docToData(C)) === JSON.stringify(docToData(A)));
}

// ── 7. structural sync: add + rename sheet propagate ─────────────────────────
console.log('\n[7] structural changes propagate');
{
  const A = new Y.Doc();
  seedDoc(A, sample, cellToHtml);
  const B = new Y.Doc();
  Y.applyUpdate(B, Y.encodeStateAsUpdate(A), REMOTE_ORIGIN);
  connect(A, B);

  // rename a sheet + add a sheet on A (mirrors syncStructureToDoc)
  A.transact(() => {
    const arr = A.getArray<Y.Map<any>>('sheets');
    findSheet(A, 's2')!.set('name', 'Politics DA');
    const sm = new Y.Map<any>();
    sm.set('id', 's3'); sm.set('name', 'Case'); sm.set('cells', new Y.Map()); sm.set('arrows', new Y.Array());
    arr.push([sm]);
  }, LOCAL_ORIGIN);

  const names = docToData(B)!.sheets.map((s) => s.name).join(',');
  check('B sees rename + add', names === 'Solvency,Politics DA,Case', names);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
