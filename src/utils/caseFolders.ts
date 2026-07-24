/**
 * Folders for the Cases grid.
 *
 * A folder is only a *label* layered on top of things that already exist — your
 * cases live in `db.cases`, imported speech docs live in the localStorage recents
 * list. Filing something into a folder never moves, copies, or touches the
 * underlying file; it just records an assignment here. That means folder state can
 * always be thrown away without losing a document.
 *
 * Persisted via `window.warroom.storage` under `case_folders` (not localStorage —
 * this is durable library structure, not view state). Both the sidebar tree and the
 * grid read it, so writes broadcast a window event and every mounted consumer
 * re-reads.
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * Shared HTML5 drag-and-drop MIME types for items/folders. The sidebar tree and
 * the Cases grid are separate React trees, each with their own local drag state
 * for visual feedback (hover highlight, drag opacity) — but that local state is
 * invisible across trees. The only thing a drop handler in ONE tree can see about
 * a drag that started in the OTHER is whatever's on the native `DataTransfer`, so
 * both trees must read and write the exact same MIME strings for cross-view drags
 * (grid tile -> sidebar folder, or vice versa) to work at all.
 */
export const ITEM_DRAG_MIME = 'application/x-warroom-item';
export const FOLDER_DRAG_MIME = 'application/x-warroom-folder';

export interface CaseFolder {
  id: string;
  name: string;
  /** null = top level. Folders nest arbitrarily deep. */
  parentId: string | null;
  createdAt: string;
}

export interface CaseFoldersData {
  folders: CaseFolder[];
  /** itemKey -> folderId. An item with no entry sits at the top level. */
  assignments: Record<string, string>;
  /**
   * Manual display order, as a flat list of itemKeys. Items sharing a folder
   * (or both at the top level) are shown in their relative order here; an
   * item with no entry sorts after every ordered item. Seeded automatically
   * (newest-added first) the first time a set of items is seen — see
   * `ensureOrderSeeded` — so "manual order" and "date added" are really the
   * same list: date-added order until the user drags something, at which
   * point that item's new position sticks.
   */
  order: string[];
}

const STORAGE_KEY = 'case_folders';
const CHANGE_EVENT = 'warroom-case-folders-changed';

export const emptyCaseFolders = (): CaseFoldersData => ({ folders: [], assignments: {}, order: [] });

// ── Item keys ────────────────────────────────────────────────────────────────
// Cases and speech docs are stored in completely different places, so the grid
// needs one namespace that can address either.

export const itemKeyForCase = (caseId: string) => `case:${caseId}`;
export const itemKeyForDoc = (path: string) => `doc:${path}`;

// ── Load / save ──────────────────────────────────────────────────────────────

let cache: CaseFoldersData | null = null;
let inflight: Promise<CaseFoldersData> | null = null;

// Exported for flowFolders.ts, which stores the same shape under its own key.
export function normalizeFolderData(raw: any): CaseFoldersData {
  const folders = Array.isArray(raw?.folders)
    ? raw.folders.filter((f: any) => f && typeof f.id === 'string' && typeof f.name === 'string')
      .map((f: any) => ({
        id: f.id,
        name: f.name,
        parentId: typeof f.parentId === 'string' ? f.parentId : null,
        createdAt: typeof f.createdAt === 'string' ? f.createdAt : new Date().toISOString(),
      }))
    : [];
  const assignments = raw?.assignments && typeof raw.assignments === 'object' ? { ...raw.assignments } : {};
  const order = Array.isArray(raw?.order) ? raw.order.filter((k: any) => typeof k === 'string') : [];
  return { folders, assignments, order };
}

export async function loadCaseFolders(): Promise<CaseFoldersData> {
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
export const peekCaseFolders = (): CaseFoldersData | null => cache;

export async function saveCaseFolders(next: CaseFoldersData): Promise<void> {
  cache = next;
  // Notify first so the UI is responsive; the disk write is not something the
  // user should wait on to see their own drag land.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  try {
    await window.warroom?.storage.write(STORAGE_KEY, next);
  } catch { /* best-effort — the in-memory cache still reflects the change */ }
}

export function subscribeCaseFolders(fn: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, fn);
  return () => window.removeEventListener(CHANGE_EVENT, fn);
}

// ── Tree helpers ─────────────────────────────────────────────────────────────

export function childFolders(data: CaseFoldersData, parentId: string | null): CaseFolder[] {
  return data.folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const findFolder = (data: CaseFoldersData, id: string): CaseFolder | undefined =>
  data.folders.find((f) => f.id === id);

/** Breadcrumb trail from the top level down to `id`, inclusive. */
export function folderTrail(data: CaseFoldersData, id: string | null): CaseFolder[] {
  const trail: CaseFolder[] = [];
  const seen = new Set<string>();
  let cur = id;
  while (cur) {
    if (seen.has(cur)) break; // defensive: a corrupted cycle must not hang the UI
    seen.add(cur);
    const f = findFolder(data, cur);
    if (!f) break;
    trail.unshift(f);
    cur = f.parentId;
  }
  return trail;
}

/**
 * Every folder in stable depth-first order, alphabetical within each level.
 * For flat pickers (e.g. a "Move to folder" menu) where there's no room for a
 * real nested tree widget — pair each entry with `folderTrail` for a full
 * breadcrumb label so nesting is still legible without indentation.
 */
export function flattenFolders(data: CaseFoldersData): CaseFolder[] {
  const out: CaseFolder[] = [];
  const walk = (parentId: string | null) => {
    for (const f of childFolders(data, parentId)) {
      out.push(f);
      walk(f.id);
    }
  };
  walk(null);
  return out;
}

/** Every folder beneath `id`, not including `id` itself. */
export function descendantFolderIds(data: CaseFoldersData, id: string): string[] {
  const out: string[] = [];
  const walk = (parent: string) => {
    for (const f of data.folders) {
      if (f.parentId === parent && !out.includes(f.id)) {
        out.push(f.id);
        walk(f.id);
      }
    }
  };
  walk(id);
  return out;
}

/** True if `maybeChild` is `folderId` or lives underneath it — blocks cyclic drags. */
export const isSelfOrDescendant = (data: CaseFoldersData, folderId: string, maybeChild: string): boolean =>
  folderId === maybeChild || descendantFolderIds(data, folderId).includes(maybeChild);

/**
 * The folder an item is actually shown in. An assignment pointing at a folder that
 * no longer exists resolves to the top level, so a deleted folder can never strand
 * a document somewhere unreachable.
 */
export function resolveItemFolder(data: CaseFoldersData, itemKey: string): string | null {
  const id = data.assignments[itemKey];
  if (!id) return null;
  return findFolder(data, id) ? id : null;
}

// ── Mutations (all return a new CaseFoldersData; caller saves) ────────────────

export function createFolder(data: CaseFoldersData, name: string, parentId: string | null): CaseFoldersData {
  const folder: CaseFolder = {
    id: `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || 'New folder',
    parentId,
    createdAt: new Date().toISOString(),
  };
  return { ...data, folders: [...data.folders, folder] };
}

export function renameFolder(data: CaseFoldersData, id: string, name: string): CaseFoldersData {
  const clean = name.trim();
  if (!clean) return data;
  return { ...data, folders: data.folders.map((f) => (f.id === id ? { ...f, name: clean } : f)) };
}

/**
 * Delete a folder without deleting anything inside it. Its documents and subfolders
 * move up to its parent, so the only thing lost is the grouping itself.
 */
export function deleteFolder(data: CaseFoldersData, id: string): CaseFoldersData {
  const target = findFolder(data, id);
  if (!target) return data;
  const parent = target.parentId;

  const folders = data.folders
    .filter((f) => f.id !== id)
    .map((f) => (f.parentId === id ? { ...f, parentId: parent } : f));

  const assignments = { ...data.assignments };
  for (const [key, folderId] of Object.entries(assignments)) {
    if (folderId !== id) continue;
    if (parent) assignments[key] = parent;
    else delete assignments[key]; // back to the top level
  }
  return { folders, assignments, order: data.order ?? [] };
}

export function moveFolder(data: CaseFoldersData, id: string, parentId: string | null): CaseFoldersData {
  if (parentId && isSelfOrDescendant(data, id, parentId)) return data; // would orphan the subtree
  return { ...data, folders: data.folders.map((f) => (f.id === id ? { ...f, parentId } : f)) };
}

export function moveItem(data: CaseFoldersData, itemKey: string, folderId: string | null): CaseFoldersData {
  const assignments = { ...data.assignments };
  if (folderId) assignments[itemKey] = folderId;
  else delete assignments[itemKey];
  return { ...data, assignments };
}

/** Drop assignments/order entries whose item no longer exists, so the file doesn't grow forever. */
export function pruneAssignments(data: CaseFoldersData, liveKeys: Set<string>): CaseFoldersData {
  const assignments: Record<string, string> = {};
  for (const [key, folderId] of Object.entries(data.assignments)) {
    if (liveKeys.has(key)) assignments[key] = folderId;
  }
  const order = (data.order ?? []).filter((k) => liveKeys.has(k));
  return { ...data, assignments, order };
}

// ── Manual / date-added order ───────────────────────────────────────────────
// `order` is one flat list shared by every folder — an item's position in it is
// only meaningful relative to the other items that end up filtered into the
// same folder view, so one list is enough to give every folder (and the top
// level) its own stable relative order without per-folder bookkeeping.

/**
 * Append any item not yet present in `order`, newest `addedAt` first, ahead of
 * everything already ordered. First run (empty `order`) seeds the whole
 * library in date-added order in one shot; after that, only genuinely new
 * items get inserted, so a manual drag never gets silently undone by this.
 * Returns `data` unchanged (same reference) if nothing was missing, so callers
 * can skip the write when nothing changed.
 */
export function ensureOrderSeeded(data: CaseFoldersData, entries: { key: string; addedAt?: string }[]): CaseFoldersData {
  const have = new Set(data.order ?? []);
  const missing = entries.filter((e) => !have.has(e.key));
  if (missing.length === 0) return data;
  missing.sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
  return { ...data, order: [...missing.map((m) => m.key), ...(data.order ?? [])] };
}

/** Sort items by their position in `order`; unordered items keep their relative input order, after everything ordered. */
export function sortByOrder<T extends { key: string }>(data: CaseFoldersData, items: T[]): T[] {
  const rank = new Map((data.order ?? []).map((k, i) => [k, i]));
  return items
    .map((item, i) => ({ item, i, r: rank.has(item.key) ? rank.get(item.key)! : Infinity }))
    .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.i - b.i))
    .map((x) => x.item);
}

/** Move `draggedKey` to sit immediately before/after `targetKey` in the shared order list. */
export function moveInOrder(data: CaseFoldersData, draggedKey: string, targetKey: string, edge: 'before' | 'after'): CaseFoldersData {
  if (draggedKey === targetKey) return data;
  const order = (data.order ?? []).filter((k) => k !== draggedKey);
  const idx = order.indexOf(targetKey);
  const insertAt = idx === -1 ? order.length : edge === 'before' ? idx : idx + 1;
  order.splice(insertAt, 0, draggedKey);
  return { ...data, order };
}

// ── React binding ────────────────────────────────────────────────────────────

/**
 * Shared folder state. Every consumer (sidebar tree, grid) sees the same value and
 * re-renders together on any change, so a drag in the grid updates the sidebar in
 * the same tick.
 *
 * `update` takes one of the mutation helpers above:
 *   update((d) => moveItem(d, itemKeyForDoc(path), folderId))
 */
export function useCaseFolders() {
  const [data, setData] = useState<CaseFoldersData>(() => peekCaseFolders() ?? emptyCaseFolders());
  const [ready, setReady] = useState(() => peekCaseFolders() !== null);

  useEffect(() => {
    let cancelled = false;
    loadCaseFolders().then((d) => {
      if (cancelled) return;
      setData(d);
      setReady(true);
    });
    const off = subscribeCaseFolders(() => setData(peekCaseFolders() ?? emptyCaseFolders()));
    return () => { cancelled = true; off(); };
  }, []);

  const update = useCallback((fn: (d: CaseFoldersData) => CaseFoldersData) => {
    const next = fn(peekCaseFolders() ?? emptyCaseFolders());
    void saveCaseFolders(next); // saveCaseFolders broadcasts; every consumer re-reads
  }, []);

  return { folders: data, ready, update };
}
