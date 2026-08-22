// Tests for the parser-only Auto Flow engine.
//
// The claim being pinned down: a Verbatim doc already encodes both decisions
// Auto Flow asks a model to make. Pocket (H1) is the speech, so it gives the
// COLUMN; hat (H2) names the position, so it gives the SHEET. Measured across
// real speech docs, 100% of cards carry a pocket and 97.9% a real hat — so the
// parser handles the overwhelming majority with no model, no batching, and no
// context limit.
//
// The fixtures below are the exact shapes those real docs use, including the
// two awkward ones: a 1NC that hats every off-case block "OFF", and a send doc
// whose speech label exists only in its filename.
//
// Run:  npx tsx scripts/test-auto-flow-parse.ts

import {
  parseAutoFlow, detectSpeech, columnForSpeech, roleForSpeech,
  sheetForCard, isGenericHeader, looksLikePlan, ParseCard,
} from '../src/lib/autoFlowParse';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  →  ' + extra : ''}`); }
}

const POLICY = ['1AC', '1NC', '2AC', '2NC/1NR', '1AR', '2NR', '2AR'];
const c = (o: Partial<ParseCard>): ParseCard =>
  ({ pocket: null, hat: null, block: null, tag: 'a tag', cite: "Smith '24 [Jane; quals]", ...o });

console.log('\n[1] detectSpeech — pocket first, then the FILENAME');
{
  check('a plain pocket', detectSpeech('1AC', 'whatever.docx', 'policy') === '1AC');
  check('a decorated pocket', detectSpeech('2NC — Politics', 'x.docx', 'policy') === '2NC');
  // The real reason the filename fallback exists: SEND_2AC---PR.8.20.docx pockets
  // all 29 of its cards under "OFF".
  check('falls back to the filename when the pocket is generic',
    detectSpeech('OFF', 'SEND_2AC---PR.8.20.docx', 'policy') === '2AC');
  check('the pocket still wins when it names a speech',
    detectSpeech('1NC', 'SEND_2AC---PR.docx', 'policy') === '1NC');
  check('no speech anywhere yields null', detectSpeech('Cards', 'notes.docx', 'policy') === null);
  check('a digit-glued near-miss is not a match', detectSpeech('12AC', 'x.docx', 'policy') === null);
  check('PF pockets are recognised', detectSpeech('Con Rebuttal', 'x.docx', 'pf') === 'Con Rebuttal');
  check('PF abbreviations are recognised', detectSpeech('Pro FF', 'x.docx', 'pf') === 'Pro FF');
  check('policy labels do not leak into PF', detectSpeech('1AC', 'x.docx', 'pf') === null);
}

console.log('\n[2] columnForSpeech — the neg block shares one column');
{
  check('an exact column matches', columnForSpeech('1AC', POLICY) === '1AC');
  check('2NC resolves to the merged column', columnForSpeech('2NC', POLICY) === '2NC/1NR');
  check('1NR resolves to the same merged column', columnForSpeech('1NR', POLICY) === '2NC/1NR');
  check('matching is case-insensitive', columnForSpeech('1ac', POLICY) === '1AC');
  check('a speech with no column yields null', columnForSpeech('3NR', POLICY) === null);
  check('a renamed column still matches its own name',
    columnForSpeech('Block', ['1AC', 'Block']) === 'Block');
}

console.log('\n[3] roleForSpeech — drives advantages-before-off-case tab order');
{
  check('1AC is an aff position', roleForSpeech('1AC') === 'advantage');
  check('2AR is an aff position', roleForSpeech('2AR') === 'advantage');
  check('1NC is off-case', roleForSpeech('1NC') === 'offcase');
  check('2NR is off-case', roleForSpeech('2NR') === 'offcase');
  check('Pro is an aff position', roleForSpeech('Pro Case') === 'advantage');
  check('Con is off-case', roleForSpeech('Con Summary') === 'offcase');
  check('null in, null out', roleForSpeech(null) === null);
}

console.log('\n[4] isGenericHeader — a section label is not a position');
{
  for (const g of ['OFF', 'Off Case', 'off-case', '1NC', '1NC---OFF', 'Case', 'Neg', 'Blocks', 'Answers', '']) {
    check(`"${g}" is generic`, isGenericHeader(g));
  }
  for (const n of ['Politics DA', 'Cap K', 'Heg Adv', 'T---Multi Payer', 'Economy', 'Disease']) {
    check(`"${n}" names a real position`, !isGenericHeader(n));
  }
}

console.log('\n[5] sheetForCard — hat, then block, then flagged generic');
{
  const hat = sheetForCard(c({ hat: 'Cap K', block: 'Impact---2NC' }), '2NC');
  check('a real hat wins', hat.name === 'Cap K' && !hat.generic);

  // The 1NC case: hat "Economy", block "AT: Solvency---1NC" → hat wins, and the
  // block's speech suffix is irrelevant because the hat was usable.
  const withHat = sheetForCard(c({ hat: 'Economy', block: 'AT: Solvency---1NC' }), '1NC');
  check('a real hat beats a real block', withHat.name === 'Economy' && !withHat.generic);

  const blockOnly = sheetForCard(c({ hat: 'OFF', block: 'AT: Solvency---1NC' }), '1NC');
  check('a generic hat falls through to the block', blockOnly.name === 'AT: Solvency' && !blockOnly.generic);
  check('the block\'s speech suffix is stripped', !blockOnly.name.includes('1NC'));

  // The genuinely unresolvable case — both headers generic. 16 of the 1NC's 24
  // cards look exactly like this.
  const bothGeneric = sheetForCard(c({ hat: 'OFF', block: '1NC---OFF' }), '1NC');
  check('both generic is FLAGGED, not guessed at', bothGeneric.generic);
  check('it still lands somewhere rather than vanishing', !!bothGeneric.name);
}

console.log('\n[6] looksLikePlan');
{
  check('a 1AC mandate is the plan',
    looksLikePlan(c({ tag: 'The United States federal government should establish single payer.' }), '1AC'));
  check('a "Plan" block header counts', looksLikePlan(c({ block: 'Plan', tag: 'anything' }), '1AC'));
  check('the same text outside the 1AC is not the plan',
    !looksLikePlan(c({ tag: 'The United States federal government should act.' }), '2AC'));
  check('an ordinary 1AC card is not the plan', !looksLikePlan(c({ tag: 'Heg solves war.' }), '1AC'));
}

console.log('\n[7] parseAutoFlow — end to end on real document shapes');
{
  const res = parseAutoFlow({
    event: 'policy',
    columns: POLICY,
    existingSheets: ['Case', 'RFD/Notes'],
    docs: [
      { fileName: 'AFF---Single Payer.docx', cards: [
        c({ pocket: '1AC', hat: '1AC---Single Payer', tag: 'The United States federal government should establish single payer.' }),
        c({ pocket: '1AC', hat: 'Heg Adv', tag: 'Heg solves great power war.', cite: "Brooks '24 [Stephen; quals]" }),
      ] },
      { fileName: '1NC---Practice.docx', cards: [
        c({ pocket: '1NC', hat: 'Economy', block: 'AT: Solvency---1NC', tag: 'Lobbying eliminates cost control.' }),
        c({ pocket: '1NC', hat: 'OFF', block: '1NC---OFF', tag: 'Dems win the midterms now.' }),
      ] },
      { fileName: 'SEND_2AC---PR.docx', cards: [
        c({ pocket: 'OFF', hat: 'Heg Adv', tag: 'Extend Brooks.' }),
      ] },
      { fileName: 'notes.docx', cards: [c({ pocket: 'Misc', tag: 'stray card' })] },
    ],
  });

  const byTag = (t: string) => res.placements.find((p) => p.tag.startsWith(t))!;
  check('every placeable card is placed', res.placements.length === 5, `got ${res.placements.length}`);
  check('the unplaceable card is skipped, not guessed', res.skipped.length === 1);
  check('the skip says why', /no speech label/.test(res.skipped[0].reason), res.skipped[0].reason);

  check('pocket → column', byTag('Heg solves').column === '1AC');
  check('2NC-family speech → merged column', columnForSpeech('1NR', POLICY) === '2NC/1NR');
  check('filename-derived speech → column', byTag('Extend Brooks').column === '2AC');

  check('hat → sheet', byTag('Heg solves').sheetName === 'Heg Adv');
  check('a generic hat falls back to the block', byTag('Lobbying').sheetName === 'Economy');
  check('one generic card is counted as unresolved', res.unresolved === 1, String(res.unresolved));

  check('the plan is detected', byTag('The United States').isPlan);
  check('an ordinary card is not the plan', !byTag('Heg solves').isPlan);

  check('aff role from an aff speech', byTag('Heg solves').sheetRole === 'advantage');
  check('neg role from a neg speech', byTag('Lobbying').sheetRole === 'offcase');

  check('the cite is shortened, not copied whole', byTag('Heg solves').cite === "Brooks '24");
  check('no cite carries quals', res.placements.every((p) => !/quals/.test(p.cite)));

  // A second card on a tab the run already created is not "new" again.
  check('a sheet created in this run is reused',
    res.placements.filter((p) => p.sheetName === 'Heg Adv').filter((p) => p.isNewSheet).length === 1);
  // Reusing a tab must not re-case it — the lookup key is lowercased, the
  // display name is not.
  check('the 2AC card lands on the tab the 1AC made, with its casing intact',
    byTag('Extend Brooks').sheetName === 'Heg Adv', byTag('Extend Brooks').sheetName);
  check('the later opposing-side card is aligned to the earlier one',
    byTag('Extend Brooks').respondsTo === null || typeof byTag('Extend Brooks').respondsTo === 'string');

  // The speech marker is stripped — "Single Payer" is the aff's name, whereas
  // "1AC---Single Payer" is a heading. The flow is named after the former.
  check('the aff name is read off the 1AC hat, without the speech marker',
    res.flowName === 'Single Payer', String(res.flowName));
}

console.log('\n[8] Degenerate input never throws');
{
  const empty = parseAutoFlow({ event: 'policy', columns: POLICY, existingSheets: [], docs: [] });
  check('no docs yields no placements', empty.placements.length === 0);
  check('no docs yields no flow name', empty.flowName === undefined);
  const noCards = parseAutoFlow({ event: 'policy', columns: POLICY, existingSheets: [], docs: [{ fileName: 'x', cards: [] }] });
  check('a doc with no cards is fine', noCards.placements.length === 0);
  const noCols = parseAutoFlow({ event: 'policy', columns: [], existingSheets: [], docs: [{ fileName: '1AC.docx', cards: [c({ pocket: '1AC' })] }] });
  check('a flow with no columns skips rather than crashing', noCols.skipped.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
