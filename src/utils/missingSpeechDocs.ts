/**
 * Post-import recovery for speech docs whose path doesn't resolve on this
 * computer — expected after a full-data import from a different machine
 * (see dataExport.ts), since speech docs are exported as path references,
 * never bundled file bytes.
 */

import { loadCaseFolders, saveCaseFolders, itemKeyForDoc } from './caseFolders';

const RECENTS_KEY = 'warroom-speech-doc-recents';
interface RecentDoc { path: string; name: string; cardCount?: number; addedAt?: string }

function getRecents(): RecentDoc[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]'); } catch { return []; }
}
function setRecents(next: RecentDoc[]) {
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  window.dispatchEvent(new StorageEvent('storage', { key: RECENTS_KEY, newValue: JSON.stringify(next) }));
}

export interface MissingDoc { path: string; name: string }

/**
 * Walks every speech doc currently in the library and returns the ones that
 * don't exist on this machine. Reuses fs:trustIfExists (electron/main.ts) —
 * it doubles as "does this exist" and "trust it if so", so a doc that DOES
 * happen to exist at the same path is immediately openable too, not just
 * marked present.
 */
export async function checkMissingSpeechDocs(): Promise<MissingDoc[]> {
  const recents = getRecents();
  if (recents.length === 0) return [];
  const res = await window.warroom?.fs.trustIfExists(recents.map((r) => r.path));
  const existing = new Set(res?.existing ?? []);
  return recents.filter((r) => !existing.has(r.path)).map((r) => ({ path: r.path, name: r.name }));
}

/**
 * User picked a new location for a doc whose old path went missing. Updates
 * the recents entry in place and moves its folder assignment (keyed by path,
 * see caseFolders.ts) from the old key to the new one — otherwise relinking
 * would silently drop the doc back to the top level.
 */
export async function relinkSpeechDoc(oldPath: string, newPath: string): Promise<boolean> {
  const recents = getRecents();
  const idx = recents.findIndex((r) => r.path === oldPath);
  if (idx === -1) return false;
  const next = recents.map((r, i) => (i === idx ? { ...r, path: newPath } : r));
  setRecents(next);

  const data = await loadCaseFolders();
  const oldKey = itemKeyForDoc(oldPath);
  const newKey = itemKeyForDoc(newPath);
  if (data.assignments[oldKey] !== undefined) {
    const assignments = { ...data.assignments };
    assignments[newKey] = assignments[oldKey];
    delete assignments[oldKey];
    await saveCaseFolders({ ...data, assignments });
  }
  return true;
}
