/**
 * Missing-speech-doc detection + relink. Originally built for post-import
 * recovery (see dataExport.ts — speech docs export as path references, not
 * bundled bytes, so most won't resolve on a different computer), but the
 * same "file moved/deleted outside the app" problem can happen any time —
 * see `useMissingSpeechDocs` below, used by Sidebar.tsx/CasesGrid.tsx for a
 * persistent broken-file indicator, not just right after an import.
 */

import { useCallback, useEffect, useState } from 'react';
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

/**
 * Live (well, checked-on-mount-and-on-change, not polled) set of missing doc
 * paths, for rendering a persistent broken-file badge in the sidebar/grid.
 * Re-checks whenever the recents list changes — covers a doc being added,
 * removed, or relinked — not on a timer, since "the file went missing" isn't
 * something that needs sub-second detection.
 */
export function useMissingSpeechDocs() {
  const [missing, setMissing] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    checkMissingSpeechDocs().then((docs) => setMissing(new Set(docs.map((d) => d.path))));
  }, []);

  useEffect(() => {
    refresh();
    function onStorage(e: StorageEvent) { if (e.key === RECENTS_KEY) refresh(); }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  const relink = useCallback(async (path: string): Promise<boolean> => {
    const newPath = await window.warroom?.dialog.openFile(['docx']);
    if (!newPath) return false;
    const ok = await relinkSpeechDoc(path, newPath);
    if (ok) setMissing((prev) => { const next = new Set(prev); next.delete(path); return next; });
    return ok;
  }, []);

  return { missing, relink };
}
