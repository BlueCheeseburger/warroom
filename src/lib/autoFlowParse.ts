// Auto Flow without the AI — placing cards from the document's own structure.
//
// A Verbatim doc already encodes both decisions Auto Flow asks a model to make.
// From DEBATE_DOC_STRUCTURE.md's heading mapping:
//
//   Pocket (H1) = the speech      → the COLUMN
//   Hat    (H2) = the position    → the SHEET
//   Block  (H3) = the card group  → sub-structure within the position
//   Tag    (H4) = the tagline     → the cell contents
//
// Measured across real speech docs: 100% of cards carry a pocket, and 97.9%
// carry a hat that names a real position. So the overwhelming majority of a run
// is a lookup, not a judgement — which means no batching, no context limit, no
// waiting, and no chance of the model mistyping a tagline.
//
// What this CANNOT do, and says so rather than guessing: a doc that labels every
// off-case block with the same generic header ("OFF", "1NC") gives the parser
// nothing to separate the positions with. Those cards are grouped under one tab
// and counted in `unresolved`, so the UI can tell the user to use AI mode for
// that doc. Fine-grained `respondsTo` (which specific card a perm answers) is
// also beyond it; answers are aligned by position instead.
//
// Run the tests:  npx tsx scripts/test-auto-flow-parse.ts

import { shortCite } from './citeShort';

export interface ParseCard {
  pocket: string | null;
  hat: string | null;
  block: string | null;
  tag: string;
  cite: string;
}

export interface ParsedPlacement {
  fileName: string;
  tag: string;
  cite: string;
  column: string;
  sheetName: string;
  isNewSheet: boolean;
  respondsTo: string | null;
  isPlan: boolean;
  sheetRole: 'advantage' | 'offcase' | null;
}

export interface ParseResult {
  placements: ParsedPlacement[];
  /** The aff, read off the 1AC's hat or plan text. Undefined when not derivable. */
  flowName?: string;
  /** Cards placed on a tab named after a generic header because no position was named. */
  unresolved: number;
  /** Cards with no recognisable speech, which cannot be given a column. */
  skipped: { tag: string; reason: string }[];
}

// ── Speech detection ────────────────────────────────────────────────────────

/**
 * Headers that name a *section* rather than a *position*. A doc that hats every
 * off-case block "OFF" is telling the parser nothing about what those arguments
 * are — the position only exists in the taglines, which is exactly the case that
 * still needs a model.
 */
const GENERIC_HEADER =
  /^(off|off[\s-]*case|on[\s-]*case|case|neg|aff|blocks?|extra|misc|cards?|frontlines?|answers?|1ac|2ac|1nc|2nc|1nr|1ar|2nr|2ar|1ac[\s-]*off|1nc[\s-]*off)$/i;

export function isGenericHeader(s: string | null | undefined): boolean {
  const t = String(s ?? '').replace(/[-—–]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  return !t || GENERIC_HEADER.test(t);
}

/** Canonical policy speech tokens, longest first so "2NC" wins over "2N". */
const POLICY_SPEECHES = ['1AC', '2AC', '1NC', '2NC', '1NR', '1AR', '2NR', '2AR'];

const PF_SPEECHES: [RegExp, string][] = [
  [/\bpro\s*(case|constructive)\b/i, 'Pro Case'],
  [/\bcon\s*(case|constructive)\b/i, 'Con Case'],
  [/\bpro\s*(rebuttal|reb)\b/i, 'Pro Rebuttal'],
  [/\bcon\s*(rebuttal|reb)\b/i, 'Con Rebuttal'],
  [/\bpro\s*(summary|sum)\b/i, 'Pro Summary'],
  [/\bcon\s*(summary|sum)\b/i, 'Con Summary'],
  [/\bpro\s*(ff|final\s*focus)\b/i, 'Pro FF'],
  [/\bcon\s*(ff|final\s*focus)\b/i, 'Con FF'],
];

/**
 * Which speech a card belongs to, from its pocket — falling back to the FILE
 * NAME, because the label genuinely isn't always in the document. A real send
 * doc measured here (`SEND_2AC---PR.8.20.docx`) pockets all 29 of its cards
 * under "OFF"; the only place the words "2AC" appear is the filename.
 */
export function detectSpeech(pocket: string | null, fileName: string, event: 'policy' | 'pf'): string | null {
  const from = (s: string): string | null => {
    const t = String(s ?? '');
    if (event === 'pf') {
      for (const [re, label] of PF_SPEECHES) if (re.test(t)) return label;
      return null;
    }
    const up = t.toUpperCase();
    for (const sp of POLICY_SPEECHES) {
      // Word-ish boundary: "2AC" in "SEND_2AC---PR" counts, "12AC" does not.
      if (new RegExp(`(^|[^0-9A-Z])${sp}([^0-9A-Z]|$)`).test(up)) return sp;
    }
    return null;
  };
  return from(pocket ?? '') ?? from(fileName);
}

/** The 2NC and 1NR share one column in this app's policy layout. */
export function columnForSpeech(speech: string, columns: string[]): string | null {
  const exact = columns.find((c) => c.trim().toUpperCase() === speech.toUpperCase());
  if (exact) return exact;
  // A merged column ("2NC/1NR") contains the speech as one of its parts.
  const merged = columns.find((c) =>
    c.split(/[\/,]/).some((part) => part.trim().toUpperCase() === speech.toUpperCase()));
  return merged ?? null;
}

/** Aff speeches build the case; neg speeches bring off-case. Drives tab order. */
export function roleForSpeech(speech: string | null): 'advantage' | 'offcase' | null {
  if (!speech) return null;
  const s = speech.toUpperCase();
  if (/^(1AC|2AC|1AR|2AR)$/.test(s) || /^PRO\b/.test(s)) return 'advantage';
  if (/^(1NC|2NC|1NR|2NR)$/.test(s) || /^CON\b/.test(s)) return 'offcase';
  return null;
}

/** The plan text: a 1AC card whose tag reads like a mandate. */
const PLAN_RE = /\b(the\s+)?(united\s+states\s+federal\s+government|usfg|the\s+united\s+states)\b[\s\S]{0,40}\bshould\b/i;

export function looksLikePlan(card: ParseCard, speech: string | null): boolean {
  if (speech !== '1AC') return false;
  const t = `${card.tag} ${card.block ?? ''}`;
  return PLAN_RE.test(t) || /^\s*(plan|the\s+plan)\s*[:.]?\s*$/i.test(card.block ?? '');
}

// ── Sheet naming ────────────────────────────────────────────────────────────

/**
 * Remove a speech marker from EITHER end, then tidy the dash runs Verbatim uses
 * as separators. Both ends matter and for different reasons:
 *
 *   "AT: Solvency---1NC"   → "AT: Solvency"   (trailing — the usual shape)
 *   "1NC---OFF"            → "OFF"            (leading — must reduce to the
 *                                              generic word so it is CAUGHT as
 *                                              generic rather than surviving as
 *                                              the position name "1NC — OFF")
 *   "1AC---Single Payer"   → "Single Payer"   (leading — this is also what makes
 *                                              a usable flow name)
 */
const SPEECH_MARKER = '(1AC|2AC|1NC|2NC|1NR|1AR|2NR|2AR)';

function stripSpeechMarkers(s: string): string {
  return String(s ?? '')
    .replace(new RegExp(`^\\s*${SPEECH_MARKER}\\s*[-—–:]{1,3}\\s*`, 'i'), '')
    .replace(new RegExp(`[-—–]{2,}\\s*${SPEECH_MARKER}\\s*$`, 'i'), '')
    .replace(/[-—–]{2,}/g, ' — ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which tab a card goes on. Hat first (it names the position), then block, then
 * the speech itself as a last resort — with `generic: true` whenever nothing
 * named an actual position, so the caller can report it instead of pretending.
 */
export function sheetForCard(card: ParseCard, speech: string | null): { name: string; generic: boolean } {
  const hat = stripSpeechMarkers(card.hat ?? '');
  if (hat && !isGenericHeader(hat)) return { name: hat, generic: false };
  const block = stripSpeechMarkers(card.block ?? '');
  if (block && !isGenericHeader(block)) return { name: block, generic: false };
  const fallback = hat || block || speech || 'Unsorted';
  return { name: fallback, generic: true };
}

/**
 * Case-insensitive match returning the tab's ORIGINAL casing.
 *
 * The lookup key is lowercased but the value is not: returning the key would
 * rename "Heg Adv" to "heg adv" the moment a second card landed on it.
 */
function matchExistingSheet(name: string, existing: Map<string, string>): string | null {
  return existing.get(name.trim().toLowerCase()) ?? null;
}

// ── The parse ───────────────────────────────────────────────────────────────

export interface ParseInput {
  docs: { fileName: string; cards: ParseCard[] }[];
  columns: string[];
  existingSheets: string[];
  event: 'policy' | 'pf';
}

export function parseAutoFlow(input: ParseInput): ParseResult {
  const { docs, columns, existingSheets, event } = input;
  const placements: ParsedPlacement[] = [];
  const skipped: ParseResult['skipped'] = [];
  let unresolved = 0;
  let flowName: string | undefined;

  // Sheets created during this run, so the second card of a position matches the
  // tab the first one made rather than being marked new again.
  const known = new Map<string, string>(
    (existingSheets ?? []).map((s) => [s.trim().toLowerCase(), s]));

  // The most recent card placed on each sheet, per role. An answer in a later
  // speech is aligned to the opposing side's last card on the same position —
  // coarser than knowing a perm answers one specific CP card, but it is what the
  // document structure actually supports.
  const lastOnSheet = new Map<string, { tag: string; role: string | null }>();

  for (const doc of docs ?? []) {
    for (const card of doc.cards ?? []) {
      const speech = detectSpeech(card.pocket, doc.fileName, event);
      const column = speech ? columnForSpeech(speech, columns) : null;
      if (!column) {
        skipped.push({ tag: card.tag, reason: speech ? `no "${speech}" column in this flow` : 'no speech label on the card or its file' });
        continue;
      }

      const sheet = sheetForCard(card, speech);
      if (sheet.generic) unresolved++;

      const existing = matchExistingSheet(sheet.name, known);
      const sheetName = existing ?? sheet.name;
      const isNewSheet = !existing;
      if (isNewSheet) known.set(sheetName.trim().toLowerCase(), sheetName);

      const role = roleForSpeech(speech);
      const prev = lastOnSheet.get(sheetName.trim().toLowerCase());
      const respondsTo = prev && prev.role && role && prev.role !== role ? prev.tag : null;

      const isPlan = looksLikePlan(card, speech);
      if (!flowName && speech === '1AC' && !sheet.generic) flowName = sheet.name;

      placements.push({
        fileName: doc.fileName,
        tag: card.tag.trim(),
        cite: shortCite(card.cite ?? ''),
        column,
        sheetName,
        isNewSheet,
        respondsTo,
        isPlan,
        sheetRole: role,
      });
      lastOnSheet.set(sheetName.trim().toLowerCase(), { tag: card.tag.trim(), role });
    }
  }

  return { placements, flowName, unresolved, skipped };
}
