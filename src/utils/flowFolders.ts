/**
 * Folders for the Flow sidebar section — the exact same model as the Cases
 * folders (see utils/caseFolders.ts): a folder is only a *label* layered on top
 * of flows that already exist in `flows_index`. Filing a flow never touches its
 * stored data (`flow_data_<id>`); it just records an assignment here, so folder
 * state can always be thrown away without losing a flow.
 *
 * All the tree logic (childFolders, folderTrail, moveItem, deleteFolder, …) is
 * shared with the cases system — those helpers are pure functions over a
 * FoldersData value, so this module only supplies the separate STORE: its own
 * storage key, change event, cache, and React hook. Keeping the stores separate
 * (rather than one merged file) means cases folders and flow folders can never
 * collide, and a flow can never be dragged into a cases folder or vice versa
 * (they also use distinct drag MIME types, below).
 *
 * Persisted via `window.warroom.storage` under `flow_folders`.
 */

import { useState, useEffect, useCallback } from 'react';
import { CaseFoldersData, emptyCaseFolders, normalizeFolderData } from './caseFolders';

/**
 * Drag MIME types for flow items/folders. Deliberately different strings from
 * caseFolders' ITEM_DRAG_MIME/FOLDER_DRAG_MIME so a flow dragged over the Cases
 * tree (or a case over the Flow tree) is simply not accepted as a drop —
 * cross-filing between the two systems is meaningless.
 */
export const FLOW_ITEM_DRAG_MIME = 'application/x-warroom-flow-item';
export const FLOW_FOLDER_DRAG_MIME = 'application/x-warroom-flow-folder';

/** Item key for a flow in the assignments map. */
export const itemKeyForFlow = (flowId: string) => `flow:${flowId}`;

const STORAGE_KEY = 'flow_folders';
const CHANGE_EVENT = 'warroom-flow-folders-changed';

let cache: CaseFoldersData | null = null;
let inflight: Promise<CaseFoldersData> | null = null;

export async function loadFlowFolders(): Promise<CaseFoldersData> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const raw = await window.warroom?.storage.read(STORAGE_KEY);
      cache = normalizeFolderData(raw);
    } catch {
      cache = emptyCaseFolders();
    }
    inflight = null;
    return cache!;
  })();
  return inflight;
}

/** Read the already-loaded value without awaiting. Null until the first load lands. */
export const peekFlowFolders = (): CaseFoldersData | null => cache;

export async function saveFlowFolders(next: CaseFoldersData): Promise<void> {
  cache = next;
  // Notify first so the UI is responsive; the disk write is not something the
  // user should wait on to see their own drag land.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  try {
    await window.warroom?.storage.write(STORAGE_KEY, next);
  } catch { /* best-effort — the in-memory cache still reflects the change */ }
}

export function subscribeFlowFolders(fn: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, fn);
  return () => window.removeEventListener(CHANGE_EVENT, fn);
}

/**
 * Shared flow-folder state — same contract as useCaseFolders. Every consumer
 * sees the same value and re-renders together on any change.
 *
 * `update` takes one of caseFolders' pure mutation helpers:
 *   update((d) => moveItem(d, itemKeyForFlow(id), folderId))
 */
export function useFlowFolders() {
  const [data, setData] = useState<CaseFoldersData>(() => peekFlowFolders() ?? emptyCaseFolders());
  const [ready, setReady] = useState(() => peekFlowFolders() !== null);

  useEffect(() => {
    let cancelled = false;
    loadFlowFolders().then((d) => {
      if (cancelled) return;
      setData(d);
      setReady(true);
    });
    const off = subscribeFlowFolders(() => setData(peekFlowFolders() ?? emptyCaseFolders()));
    return () => { cancelled = true; off(); };
  }, []);

  const update = useCallback((fn: (d: CaseFoldersData) => CaseFoldersData) => {
    const next = fn(peekFlowFolders() ?? emptyCaseFolders());
    void saveFlowFolders(next); // saveFlowFolders broadcasts; every consumer re-reads
  }, []);

  return { folders: data, ready, update };
}
