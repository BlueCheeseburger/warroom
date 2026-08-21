// Pure batching helpers for Auto Flow's classify step.
//
// These exist as their own module (rather than inline in main.ts) so they can be
// unit-tested without booting Electron — same reason docxFlowCards.ts is split
// out. main.ts owns the AI calls and the retry/split control flow; everything
// here is deterministic and side-effect free.
//
// WHY BATCHING EXISTS AT ALL: the classify handler used to send every card in
// one prompt, hard-truncated with `JSON.stringify(docs).slice(0, 60000)`. On a
// real case packet (a 1AC can carry 700+ cards) that cut the JSON mid-object, so
// most cards were never sent and what was sent was malformed. The reply then hit
// the output-token cap and came back cut off, failed to parse, and got laundered
// into `{ ok: true, placements: [] }` — a multi-minute wait ending in "Warroom
// AI didn't propose any placements" with no error shown anywhere.
//
// Run the tests:  npx tsx scripts/test-auto-flow-batch.ts

import type { ExtractedFlowCard } from './docxFlowCards';

/**
 * One (fileName, card) pair, flattened out of the per-doc grouping so batches can
 * be cut at any point while still preserving DOCUMENT ORDER across the whole run.
 * That order is load-bearing: the classify prompt numbers the aff's advantages by
 * first appearance in the 1AC, and the write step lays tabs out in the order the
 * placements come back.
 */
export type FlatFlowCard = { fileName: string; card: ExtractedFlowCard };

export interface DocGroup {
  fileName: string;
  cards: ExtractedFlowCard[];
}

export function flattenDocs(docs: DocGroup[]): FlatFlowCard[] {
  const out: FlatFlowCard[] = [];
  for (const d of docs ?? []) {
    for (const card of d.cards ?? []) out.push({ fileName: d.fileName, card });
  }
  return out;
}

/**
 * Regroup a flat slice back into the `[{ fileName, cards }]` shape the prompt
 * expects. Files appear in the order they're first seen in the slice, and each
 * file's cards keep their relative order, so a batch reads as a contiguous chunk
 * of the original documents rather than a reshuffle.
 */
export function regroupBatch(batch: FlatFlowCard[]): DocGroup[] {
  const order: string[] = [];
  const byFile = new Map<string, ExtractedFlowCard[]>();
  for (const { fileName, card } of batch) {
    if (!byFile.has(fileName)) { byFile.set(fileName, []); order.push(fileName); }
    byFile.get(fileName)!.push(card);
  }
  return order.map((fileName) => ({ fileName, cards: byFile.get(fileName)! }));
}

/** Split a flat card list into fixed-size batches, preserving order. */
export function chunkCards(flat: FlatFlowCard[], size: number): FlatFlowCard[][] {
  const step = Math.max(1, Math.floor(size));
  const out: FlatFlowCard[][] = [];
  for (let i = 0; i < flat.length; i += step) out.push(flat.slice(i, i + step));
  return out;
}

/**
 * Fold the sheet names a batch proposed into the known-sheet list,
 * case-insensitively and preserving first-seen order.
 *
 * This is what keeps a chunked run coherent: batch 2 is told about the tabs
 * batch 1 invented, so the same position can't come back named "Heg Adv" once
 * and "Hegemony" the next time and end up as two tabs.
 */
export function mergeSheetNames(known: string[], placements: { sheetName?: unknown }[]): string[] {
  const seen = new Set((known ?? []).map((s) => String(s).trim().toLowerCase()));
  const out = [...(known ?? [])];
  for (const p of placements ?? []) {
    const name = String(p?.sheetName ?? '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export interface NormalizedPlacement {
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

/**
 * Coerce the model's raw placement objects into the shape the write step relies
 * on, dropping any that are missing the three fields a card genuinely can't be
 * placed without. The DROPPED COUNT is reported to the user rather than hidden —
 * a silently shorter list used to be indistinguishable from a smaller document.
 */
export function normalizePlacements(rawList: any[]): NormalizedPlacement[] {
  return (Array.isArray(rawList) ? rawList : [])
    .filter((p: any) => p && typeof p.tag === 'string' && typeof p.column === 'string' && typeof p.sheetName === 'string')
    .map((p: any) => ({
      fileName: String(p.fileName ?? ''),
      tag: String(p.tag ?? '').trim(),
      cite: String(p.cite ?? '').trim(),
      column: String(p.column ?? '').trim(),
      sheetName: String(p.sheetName ?? '').trim(),
      isNewSheet: !!p.isNewSheet,
      // Best-effort hints for the write step's same-row/arrow placement and the
      // plan-goes-first convention — both optional, both degrade gracefully to
      // "place normally" if the model left them out or they don't resolve.
      respondsTo: typeof p.respondsTo === 'string' && p.respondsTo.trim() ? p.respondsTo.trim() : null,
      isPlan: !!p.isPlan,
      // Which family of sheet this card's position belongs to, so the write step
      // can order tabs — aff advantages first (in 1AC order), then off-case.
      // 'advantage' = a 1AC aff case position (advantage/contention), 'offcase' =
      // a neg off-case position (DA/CP/K/T…), null = an existing/structural match.
      sheetRole: p.sheetRole === 'advantage' || p.sheetRole === 'offcase' ? p.sheetRole : null,
    }));
}
