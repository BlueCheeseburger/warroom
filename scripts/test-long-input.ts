// Tests for the long-input strategies (even sampling, chunking, context guard).
//
// The behavior being pinned down: an over-long flow must not be handled by
// taking the first N characters. That reads the whole 1AC and none of the 2NR,
// which misrepresents the round far worse than reading two-thirds of each — and
// worse, the model was never told anything was missing, so it would confidently
// call an argument dropped when the answer was simply never sent.
//
// Run:  npx tsx scripts/test-long-input.ts

import {
  splitFlowSummaryIntoSheets, countCardLines, sampleSections, trimToLines,
  buildCoverageNote, chunkSections, estimateTokens, contextLimitFor,
  overContextLimit, DEFAULT_CONTEXT_LIMIT, Section,
} from '../electron/longInput';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  →  ' + extra : ''}`); }
}

const SUMMARY = [
  '=== Sheet: Politics DA ===',
  '[1NC] uniqueness — bill passes now',
  '[2AC] no link — plan is bipartisan',
  '[2NC/1NR] link turn',
  '',
  '=== Sheet: Heg Adv ===',
  '[1AC] heg solves great power war',
  '[1NC] (empty)',
  '[2AC] extend Brooks',
  '',
  '=== Sheet: T ===',
  '[1NC] substantially means 40%',
  '',
].join('\n');

console.log('\n[1] splitFlowSummaryIntoSheets');
{
  const s = splitFlowSummaryIntoSheets(SUMMARY);
  check('one section per sheet', s.length === 3, `got ${s.length}`);
  check('labels are the sheet names', s.map((x) => x.label).join('|') === 'Politics DA|Heg Adv|T');
  check('card counts ignore (empty) and headers',
    s.map((x) => x.items).join('|') === '3|2|1', s.map((x) => x.items).join('|'));
  check('each section keeps its own header', s[1].text.startsWith('=== Sheet: Heg Adv ==='));
  check('empty input yields no sections', splitFlowSummaryIntoSheets('').length === 0);
  const noHeaders = splitFlowSummaryIntoSheets('[1AC] a card\n[2AC] another');
  check('text with no sheet headers becomes one section', noHeaders.length === 1);
  check('that fallback still counts its cards', noHeaders[0].items === 2);
}

console.log('\n[2] countCardLines');
{
  check('counts bracketed lines', countCardLines('[1AC] x\n[2AC] y') === 2);
  check('skips (empty) markers', countCardLines('[1AC] (empty)') === 0);
  check('skips the sheet header', countCardLines('=== Sheet: X ===\n[1AC] a') === 1);
  check('skips blank lines', countCardLines('\n\n[1AC] a\n\n') === 1);
  check('skips unbracketed prose', countCardLines('just some text') === 0);
}

console.log('\n[3] sampleSections — a fair share of every sheet, not the front of the flow');
{
  const secs = splitFlowSummaryIntoSheets(SUMMARY);
  const whole = sampleSections(secs, 10_000);
  check('everything fits → complete', whole.complete);
  check('complete coverage reports kept === total', whole.coverage.every((c) => c.kept === c.total));

  // Budget that forces trimming.
  const tight = sampleSections(secs, 120);
  check('over budget → not complete', !tight.complete);
  check('output respects the budget (approximately)', tight.text.length <= 160, `len ${tight.text.length}`);
  check('EVERY sheet is still represented — this is the whole point',
    secs.every((s) => tight.text.includes(s.label)), tight.text);
  check('coverage is reported for every sheet', tight.coverage.length === 3);
  check('coverage never claims more than existed', tight.coverage.every((c) => c.kept <= c.total));
}

console.log('\n[4] sampleSections — small sheets survive whole next to one huge one');
{
  const big = '=== Sheet: Big ===\n' + Array.from({ length: 200 }, (_, i) => `[1AC] card ${i}`).join('\n');
  const secs: Section[] = [
    { label: 'Big', text: big, items: 200 },
    { label: 'Tiny A', text: '=== Sheet: Tiny A ===\n[1NC] a', items: 1 },
    { label: 'Tiny B', text: '=== Sheet: Tiny B ===\n[1NC] b', items: 1 },
  ];
  const out = sampleSections(secs, 600);
  const tinyA = out.coverage.find((c) => c.label === 'Tiny A')!;
  const tinyB = out.coverage.find((c) => c.label === 'Tiny B')!;
  const bigCov = out.coverage.find((c) => c.label === 'Big')!;
  check('a small sheet inside its share is kept whole', tinyA.kept === tinyA.total);
  check('the other small sheet too', tinyB.kept === tinyB.total);
  check('the oversized sheet is the one that gets trimmed', bigCov.kept < bigCov.total);
  check('the trimmed sheet still contributes something', bigCov.kept > 0);
}

console.log('\n[5] trimToLines — never cuts mid-card');
{
  const t = trimToLines('=== Sheet: X ===\n[1AC] aaaa\n[2AC] bbbb', 30);
  check('cuts on a line boundary', !t.endsWith('bb') || t.split('\n').every((l) => l === '' || /^(===|\[)/.test(l)));
  check('always keeps the first line even when over budget',
    trimToLines('a-very-long-first-line-indeed', 5) === 'a-very-long-first-line-indeed');
  check('under budget is unchanged', trimToLines('short', 100) === 'short');
}

console.log('\n[6] buildCoverageNote — names the gap in cards, per sheet');
{
  const note = buildCoverageNote([
    { label: 'Politics DA', kept: 12, total: 31 },
    { label: 'T', kept: 4, total: 4 },
  ]);
  check('names the short sheet with real numbers', note.includes('Politics DA: you can see 12 of 31 cards'));
  check('does not list a sheet that was complete', !note.includes('T:'));
  check('totals the missing cards', note.includes('19 card'));
  check('tells the model not to call those dropped', note.toLowerCase().includes('dropped'));

  const full = buildCoverageNote([{ label: 'X', kept: 5, total: 5 }]);
  check('a complete flow says so explicitly', full.includes('IN FULL'));
}

console.log('\n[7] chunkSections — whole sheets only');
{
  const secs = splitFlowSummaryIntoSheets(SUMMARY);
  const one = chunkSections(secs, 10_000);
  check('everything in one chunk when it fits', one.length === 1 && one[0].length === 3);

  const many = chunkSections(secs, 80);
  check('splits into several chunks when tight', many.length > 1, `got ${many.length}`);
  check('no sheet is split across chunks',
    many.flat().length === secs.length && new Set(many.flat().map((s) => s.label)).size === 3);
  check('chunk order follows sheet order',
    many.flat().map((s) => s.label).join('|') === 'Politics DA|Heg Adv|T');
  check('an oversized single section still gets a chunk',
    chunkSections([{ label: 'Huge', text: 'x'.repeat(5000), items: 1 }], 100).length === 1);
  check('empty input yields no chunks', chunkSections([], 100).length === 0);
}

console.log('\n[8] Context guard — a hard stop before anything is sent');
{
  check('token estimate scales with length', estimateTokens('x'.repeat(3500)) === 1000);
  check('empty text is zero tokens', estimateTokens('') === 0);

  check('gemini maps to its big window', contextLimitFor('gemini-2.5-flash') === 900_000);
  check('claude maps to 180k', contextLimitFor('claude-sonnet-4') === 180_000);
  check('longest-prefix wins over a shorter one', contextLimitFor('gpt-4.1-mini') === 900_000);
  check('an unknown model gets the conservative default',
    contextLimitFor('some-local-llama') === DEFAULT_CONTEXT_LIMIT);
  check('an empty model id does not throw', contextLimitFor('') === DEFAULT_CONTEXT_LIMIT);

  check('a normal prompt passes', overContextLimit('hello', 'gemini-2.5-flash') === null);
  // 1,000,000 chars ≈ 285,000 tokens, comfortably past Claude's 180k.
  const over = overContextLimit('x'.repeat(1_000_000), 'claude-sonnet-4');
  check('an oversized prompt is blocked', over !== null);
  check('the block names the real numbers', !!over && over.includes('180,000'));
  check('the block says nothing was sent', !!over && over.includes('Nothing was sent'));
  check('the block points at the setting', !!over && over.includes('Work past the length limit'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
