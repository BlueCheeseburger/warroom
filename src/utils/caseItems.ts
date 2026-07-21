/**
 * One list of everything that belongs under "Cases".
 *
 * Three different things show up side by side in the grid and the sidebar, and they
 * live in three different places:
 *
 *   - `case`       — a case you built in Warroom, out of blocks. In `db.cases`.
 *                    Has no .docx behind it, so it has no page to screenshot.
 *   - `oc-case`    — a case imported from an opponent's OpenCaseList disclosure.
 *                    In `db.cases` too, but backed by real docx bytes (`ocSource`).
 *   - `speech-doc` — a .docx you opened/imported. Lives in the localStorage recents
 *                    list, NOT in the db.
 *
 * This module flattens all three into one `CaseItem` shape so callers never have to
 * care which bucket something came from.
 */

import { DB } from '../types';
import { itemKeyForCase, itemKeyForDoc } from './caseFolders';

export type CaseItemKind = 'case' | 'oc-case' | 'speech-doc';
export type ItemSide = 'aff' | 'neg' | 'unknown';

export interface CaseItem {
  /** Namespaced key used for folder assignments — see caseFolders.ts */
  key: string;
  kind: CaseItemKind;
  /** caseId for case/oc-case, file path for speech-doc */
  id: string;
  name: string;
  side: ItemSide;
  /** oc-case only: the team the disclosure came from */
  teamName?: string;
  /** oc-case only: the source URL, also the key for its cached docx bytes */
  ocUrl?: string;
  /** speech-doc only: absolute path on disk */
  path?: string;
}

const SPEECH_RECENTS_KEY = 'warroom-speech-doc-recents';
const SPEECH_SIDES_KEY = 'warroom-speech-doc-sides';

export interface RecentDoc { path: string; name: string; cardCount?: number }

export function readSpeechDocRecents(): RecentDoc[] {
  try { return JSON.parse(localStorage.getItem(SPEECH_RECENTS_KEY) ?? '[]'); } catch { return []; }
}

function writeSpeechDocRecents(next: RecentDoc[]) {
  localStorage.setItem(SPEECH_RECENTS_KEY, JSON.stringify(next));
  // Sidebar.tsx and SpeechDocViewer.tsx both listen for this to re-read recents —
  // a same-tab localStorage write doesn't fire a native 'storage' event, so it has
  // to be dispatched by hand for other mounted components to notice.
  window.dispatchEvent(new StorageEvent('storage', { key: SPEECH_RECENTS_KEY, newValue: JSON.stringify(next) }));
}

/** Remove an imported speech doc from the library. Deletes nothing on disk — only the recents entry. */
export function removeFromRecents(path: string) {
  writeSpeechDocRecents(readSpeechDocRecents().filter((r) => r.path !== path));
}

export function renameInRecents(path: string, displayName: string) {
  writeSpeechDocRecents(readSpeechDocRecents().map((r) => (r.path === path ? { ...r, name: displayName } : r)));
}

/**
 * Aff/neg for imported docs, from the cache the home Cases tile fills in (it tallies
 * 1AC/2AC/1AR/2AR against 1NC/2NC/1NR/2NR). Read-only here: the grid shows a side
 * badge when the answer is already known and simply omits it otherwise, rather than
 * re-extracting every doc just to draw a badge.
 */
export function readSpeechDocSides(): Record<string, ItemSide> {
  try { return JSON.parse(localStorage.getItem(SPEECH_SIDES_KEY) ?? '{}'); } catch { return {}; }
}

export const stripDocxExt = (name: string) => name.replace(/\.docx$/i, '');

/** Every case + imported speech doc, in one list. */
export function buildCaseItems(db: DB): CaseItem[] {
  const items: CaseItem[] = [];

  for (const c of Object.values(db.cases ?? {})) {
    items.push({
      key: itemKeyForCase(c.id),
      kind: c.ocSource ? 'oc-case' : 'case',
      id: c.id,
      name: c.name,
      side: (c.side as ItemSide) ?? 'unknown',
      teamName: c.ocSource?.teamName,
      ocUrl: c.ocSource?.url,
    });
  }

  const sides = readSpeechDocSides();
  for (const r of readSpeechDocRecents()) {
    items.push({
      key: itemKeyForDoc(r.path),
      kind: 'speech-doc',
      id: r.path,
      name: stripDocxExt(r.name),
      side: sides[r.path] ?? 'unknown',
      path: r.path,
    });
  }

  return items;
}

/**
 * Delete a case (yours or an imported OC one) and every block that belonged to
 * it. Pure — callers apply it via `update(db => deleteCaseAndBlocks(db, id))`.
 * Kept here so the sidebar, the grid, and any future bulk-action UI can't drift
 * out of sync on what "delete a case" actually does.
 */
export function deleteCaseAndBlocks(db: DB, caseId: string): DB {
  const { [caseId]: _removed, ...cases } = db.cases;
  const blocks = { ...db.blocks };
  for (const b of Object.values(db.blocks)) { if (b.caseId === caseId) delete blocks[b.id]; }
  return { ...db, cases, blocks };
}
