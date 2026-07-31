import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { buildCaseItems, CaseItem, CaseItemKind, removeFromRecents, renameInRecents, deleteCaseAndBlocks, readSpeechDocRecents, writeSpeechDocRecents } from '../utils/caseItems';
import { useMenuA11y } from '../hooks/useMenuA11y';
import {
  useCaseFolders,
  childFolders,
  folderTrail,
  flattenFolders,
  findFolder,
  resolveItemFolder,
  isSelfOrDescendant,
  createFolder,
  renameFolder,
  deleteFolder,
  moveFolder,
  moveItem,
  pruneAssignments,
  sortByOrder,
  ensureOrderSeeded,
  moveInOrder,
  CaseFolder,
  ITEM_DRAG_MIME as ITEM_MIME,
  FOLDER_DRAG_MIME as FOLDER_MIME,
} from '../utils/caseFolders';
import CasePreview from './CasePreview';

// ITEM_MIME/FOLDER_MIME are imported (aliased) from caseFolders.ts rather than
// declared locally — the sidebar tree is a separate React tree that also drags
// items/folders onto this grid and vice versa, so both sides must agree on the
// exact same MIME strings for a cross-view drop to be readable at all.

const KIND_LABEL: Record<CaseItemKind, string> = {
  case: 'Case',
  'oc-case': 'Imported',
  'speech-doc': 'Doc',
};

type Drag = { type: 'item'; key: string } | { type: 'folder'; id: string } | null;

export const CARD_BASE: React.CSSProperties = {
  transition: 'transform .15s cubic-bezier(.4,0,.2,1), box-shadow .15s ease, border-color .14s ease, background .14s ease',
};

const RECENTS_KEY = 'warroom-speech-doc-recents';

export default function CasesGrid() {
  const db = useApp((s) => s.db);
  const dbReady = useApp((s) => s.ready);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const { folders, ready, update } = useCaseFolders();

  const currentFolderId = view.kind === 'cases-grid' ? view.folderId ?? null : null;

  // Speech docs live in localStorage, so nothing re-renders us when another window
  // adds one — bump a counter off the storage event and rebuild the list.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === RECENTS_KEY) setTick((t) => t + 1); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const items = useMemo(() => buildCaseItems(db), [db, tick]);

  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<CaseFolder | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Multi-select mirrors Sidebar.tsx's tree: Cmd/Ctrl+click toggles a tile in/out
  // without opening it, driving the same bulk move/delete bar pattern.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const updateDb = useApp((s) => s.update);
  const pushUndoToast = useApp((s) => s.pushUndoToast);
  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function clearSelection() { setSelected(new Set()); }

  // Full breadcrumb per folder, same as Sidebar.tsx's folderChoices — flat list
  // reads better than indentation once it's inside a narrow popover.
  const folderChoices = useMemo(
    () => flattenFolders(folders).map((f) => ({ id: f.id, label: folderTrail(folders, f.id).map((t) => t.name).join(' / ') })),
    [folders],
  );

  // Prune once per mount. Guarded on the db being loaded too — pruning against an
  // empty db would read every assignment as stale and wipe the user's folders.
  const prunedRef = useRef(false);
  useEffect(() => {
    if (!ready || !dbReady || prunedRef.current) return;
    prunedRef.current = true;
    const liveKeys = new Set(items.map((i) => i.key));
    const next = pruneAssignments(folders, liveKeys);
    if (Object.keys(next.assignments).length !== Object.keys(folders.assignments).length) {
      update((d) => pruneAssignments(d, liveKeys));
    }
  }, [ready, dbReady, items, folders, update]);

  // Display order = date added, until the user drags a tile (then that sticks).
  // New items get seeded into folders.order in an effect (a write, so it can't
  // happen during render) rather than during the prune pass above, which only
  // runs once per mount and would miss items added later in the session.
  useEffect(() => {
    if (!ready || !dbReady) return;
    const seeded = ensureOrderSeeded(folders, items.map((i) => ({ key: i.key, addedAt: i.addedAt })));
    if (seeded !== folders) update(() => seeded);
  }, [ready, dbReady, items, folders, update]);
  const orderedItems = useMemo(() => sortByOrder(folders, items), [folders, items]);

  const subfolders = childFolders(folders, currentFolderId);
  const trail = folderTrail(folders, currentFolderId);

  const term = query.trim().toLowerCase();
  const searching = term.length > 0;

  // Search deliberately ignores the current folder: this grid is the place people
  // come to *find* a doc, and a scoped search would miss everything filed away —
  // and unlike folder browsing, search results are sorted by relevance to the
  // query (alphabetically), not by date added.
  const visibleItems = useMemo(() => {
    if (searching) {
      return [...items.filter((i) => i.name.toLowerCase().includes(term))]
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return orderedItems.filter((i) => resolveItemFolder(folders, i.key) === currentFolderId);
  }, [items, orderedItems, folders, currentFolderId, term, searching]);

  const navigate = useCallback((folderId: string | null) => {
    setView({ kind: 'cases-grid', ...(folderId ? { folderId } : {}) });
  }, [setView]);

  function openItem(item: CaseItem) {
    if (item.kind === 'speech-doc') {
      if (item.path) setView({ kind: 'speech-doc', docPath: item.path });
      return;
    }
    setView({ kind: 'case', caseId: item.id });
  }

  function commitCreate() {
    const name = newName.trim();
    if (name) update((d) => createFolder(d, name, currentFolderId));
    setNewName('');
    setCreating(false);
  }

  function commitRename(id: string) {
    const name = renameDraft.trim();
    if (name) update((d) => renameFolder(d, id, name));
    setRenamingId(null);
  }

  function doDelete(folder: CaseFolder) {
    const snapshot = folders;
    update((d) => deleteFolder(d, folder.id));
    setConfirmDelete(null);
    // The open folder just stopped existing — follow its documents up to the parent.
    if (currentFolderId === folder.id) navigate(folder.parentId);
    pushUndoToast(`Deleted folder "${folder.name}"`, () => update(() => snapshot));
  }

  /** True if the currently-open view is showing one of the given item ids/paths. */
  function viewPointsAt(deletedItems: CaseItem[]): boolean {
    if (view.kind === 'speech-doc') return deletedItems.some((i) => i.kind === 'speech-doc' && i.path === view.docPath);
    if (view.kind === 'case') return deletedItems.some((i) => i.kind !== 'speech-doc' && i.id === view.caseId);
    return false;
  }

  /** Shared by the bulk-delete bar and the per-tile context menu's Delete entry. */
  function deleteItems(keys: string[]) {
    const keySet = new Set(keys);
    const targets = items.filter((i) => keySet.has(i.key));
    if (targets.length === 0) return;
    const dbSnapshot = db;
    const recentsSnapshot = readSpeechDocRecents();
    for (const t of targets) {
      if (t.kind === 'speech-doc') removeFromRecents(t.path!);
    }
    const caseIds = targets.filter((t) => t.kind !== 'speech-doc').map((t) => t.id);
    if (caseIds.length) updateDb((d) => caseIds.reduce((acc, id) => deleteCaseAndBlocks(acc, id), d));
    if (targets.some((t) => t.kind === 'speech-doc')) setTick((t) => t + 1);
    // Follow the user away from whatever tile they were looking at if it just disappeared.
    if (viewPointsAt(targets)) navigate(currentFolderId);
    setSelected((prev) => { const next = new Set(prev); for (const k of keys) next.delete(k); return next; });
    const label = targets.length === 1 ? `Deleted "${targets[0].name}"` : `Deleted ${targets.length} items`;
    pushUndoToast(label, () => {
      writeSpeechDocRecents(recentsSnapshot);
      updateDb(() => dbSnapshot);
      setTick((t) => t + 1);
    });
  }

  /** Shared by the bulk-move bar and the per-tile context menu's "Move to" rows. */
  function moveItems(keys: string[], folderId: string | null) {
    update((d) => keys.reduce((acc, key) => moveItem(acc, key, folderId), d));
    setSelected((prev) => { const next = new Set(prev); for (const k of keys) next.delete(k); return next; });
  }

  function renameItem(item: CaseItem, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name) return;
    if (item.kind === 'speech-doc') {
      renameInRecents(item.path!, trimmed);
      setTick((t) => t + 1);
    } else {
      updateDb((d) => ({ ...d, cases: { ...d.cases, [item.id]: { ...d.cases[item.id], name: trimmed } } }));
    }
  }

  /** Whether the in-flight drag may land on `targetId` (null = top level). */
  function canDrop(targetId: string | null): boolean {
    if (!drag) return false;
    if (drag.type === 'item') return true;
    if (targetId === null) return true;
    return !isSelfOrDescendant(folders, drag.id, targetId);
  }

  function handleDragOver(e: React.DragEvent, targetId: string | null, token: string) {
    if (drag) {
      if (!canDrop(targetId)) return;
    } else {
      // No local drag — this hover is likely a cross-tree drag from the sidebar
      // (a separate React tree, so it never touched `drag` here). dataTransfer's
      // values aren't readable until drop, but `.types` lists which MIME types
      // are present, which is enough to accept the hover. (A folder dragged onto
      // its own descendant can't be caught until drop, where the id is readable —
      // handleDrop's moveFolder call already no-ops on that case internally.)
      const types = e.dataTransfer.types;
      if (!types.includes(ITEM_MIME) && !types.includes(FOLDER_MIME)) return;
    }
    e.preventDefault(); // without this the drop event never fires
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(token);
  }

  function handleDrop(e: React.DragEvent, targetId: string | null) {
    e.preventDefault();
    const itemKey = e.dataTransfer.getData(ITEM_MIME);
    if (itemKey) {
      update((d) => moveItem(d, itemKey, targetId));
    } else {
      const folderId = e.dataTransfer.getData(FOLDER_MIME);
      if (folderId) update((d) => moveFolder(d, folderId, targetId));
    }
    setDrag(null);
    setDropTarget(null);
  }

  // ── Drag-to-reorder (tile onto tile) ────────────────────────────────────
  const [reorderTarget, setReorderTarget] = useState<{ key: string; edge: 'before' | 'after' } | null>(null);
  function handleReorderOver(e: React.DragEvent, item: CaseItem) {
    const isItemDrag = drag?.type === 'item' || e.dataTransfer.types.includes(ITEM_MIME);
    if (!isItemDrag || (drag?.type === 'item' && drag.key === item.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const edge: 'before' | 'after' = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';
    setDropTarget(null); // this isn't a folder-file drop, so clear any folder highlight
    setReorderTarget({ key: item.key, edge });
  }
  function handleReorderDrop(e: React.DragEvent, item: CaseItem) {
    const edge = reorderTarget?.key === item.key ? reorderTarget.edge : 'before';
    setReorderTarget(null);
    const draggedKey = drag?.type === 'item' ? drag.key : e.dataTransfer.getData(ITEM_MIME);
    setDrag(null);
    if (!draggedKey || draggedKey === item.key) return;
    e.preventDefault();
    e.stopPropagation();
    const targetFolder = resolveItemFolder(folders, item.key);
    update((d) => moveInOrder(moveItem(d, draggedKey, targetFolder), draggedKey, item.key, edge));
  }

  const nothingAtAll = items.length === 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto scroll-thin" style={{ background: 'var(--bg-main)' }}>
      {/* Header */}
      <div
        className="glass-titlebar shrink-0 px-6 py-3 flex items-center justify-between gap-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-sm font-semibold text-ink">Cases</h1>
          <button className="btn text-[11px]" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : '+ New folder'}
          </button>
        </div>
        <input
          className="input text-xs w-56"
          placeholder="Search cases…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
        />
      </div>

      <div className="flex-1 p-6 space-y-5 max-w-6xl w-full mx-auto">
        {creating && (
          <div className="flex gap-2">
            <input
              autoFocus
              className="input flex-1 text-xs"
              placeholder="Folder name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCreate();
                if (e.key === 'Escape') { setNewName(''); setCreating(false); }
              }}
            />
            <button className="btn-primary text-xs" onClick={commitCreate}>Create</button>
          </div>
        )}

        {trail.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap text-xs">
            <Crumb
              label="Cases"
              active={false}
              highlighted={dropTarget === 'crumb:root'}
              onClick={() => navigate(null)}
              onDragOver={(e) => handleDragOver(e, null, 'crumb:root')}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => handleDrop(e, null)}
            />
            {trail.map((f, i) => (
              <React.Fragment key={f.id}>
                <span className="text-ink/25">›</span>
                <Crumb
                  label={f.name}
                  active={i === trail.length - 1}
                  highlighted={dropTarget === `crumb:${f.id}`}
                  onClick={() => navigate(f.id)}
                  onDragOver={(e) => handleDragOver(e, f.id, `crumb:${f.id}`)}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => handleDrop(e, f.id)}
                />
              </React.Fragment>
            ))}
          </div>
        )}

        {!searching && subfolders.length > 0 && (
          <div>
            <div className="label mb-2">Folders</div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {subfolders.map((f) => {
                const count = items.filter((i) => resolveItemFolder(folders, i.key) === f.id).length;
                const token = `folder:${f.id}`;
                return (
                  <FolderTile
                    key={f.id}
                    folder={f}
                    count={count}
                    renaming={renamingId === f.id}
                    renameDraft={renameDraft}
                    highlighted={dropTarget === token}
                    dimmed={drag?.type === 'folder' && drag.id === f.id}
                    onOpen={() => navigate(f.id)}
                    onStartRename={() => { setRenameDraft(f.name); setRenamingId(f.id); }}
                    onRenameDraft={setRenameDraft}
                    onCommitRename={() => commitRename(f.id)}
                    onCancelRename={() => setRenamingId(null)}
                    onDelete={() => setConfirmDelete(f)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(FOLDER_MIME, f.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDrag({ type: 'folder', id: f.id });
                    }}
                    onDragEnd={() => { setDrag(null); setDropTarget(null); }}
                    onDragOver={(e) => handleDragOver(e, f.id, token)}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(e) => handleDrop(e, f.id)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {selected.size > 0 && (
          <ItemSelectionBar
            count={selected.size}
            folderChoices={folderChoices}
            onMove={(folderId) => moveItems([...selected], folderId)}
            onDelete={() => deleteItems([...selected])}
            onClear={clearSelection}
          />
        )}

        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="label">{searching ? 'Results' : 'Documents'}</div>
            {searching && <span className="text-[11px] text-ink/40">Searching everywhere</span>}
          </div>

          {visibleItems.length === 0 ? (
            <div className="text-sm italic text-ink/35 py-6">
              {searching
                ? 'No matches.'
                : nothingAtAll
                  ? 'No cases yet.'
                  : 'This folder is empty — drag cases here.'}
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {visibleItems.map((item) => {
                const homeId = resolveItemFolder(folders, item.key);
                const home = homeId ? findFolder(folders, homeId) : undefined;
                return (
                  <ItemTile
                    key={item.key}
                    item={item}
                    folderName={searching ? (home?.name ?? 'Cases') : undefined}
                    dimmed={drag?.type === 'item' && drag.key === item.key}
                    selected={selected.has(item.key)}
                    onOpen={() => openItem(item)}
                    onToggleSelect={() => toggleSelect(item.key)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(ITEM_MIME, item.key);
                      e.dataTransfer.effectAllowed = 'move';
                      setDrag({ type: 'item', key: item.key });
                    }}
                    onDragEnd={() => { setDrag(null); setDropTarget(null); setReorderTarget(null); }}
                    onReorderOver={(e) => handleReorderOver(e, item)}
                    onReorderLeave={() => setReorderTarget((cur) => (cur?.key === item.key ? null : cur))}
                    onReorderDrop={(e) => handleReorderDrop(e, item)}
                    reorderEdge={reorderTarget?.key === item.key ? reorderTarget.edge : null}
                    folderChoices={folderChoices}
                    currentFolderId={homeId}
                    onMoveTo={(folderId) => moveItems([item.key], folderId)}
                    onRename={(name) => renameItem(item, name)}
                    onDelete={() => deleteItems([item.key])}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <DeleteFolderConfirm
          folder={confirmDelete}
          parentName={confirmDelete.parentId ? findFolder(folders, confirmDelete.parentId)?.name ?? 'Cases' : 'Cases'}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => doDelete(confirmDelete)}
        />
      )}
    </div>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

export function Crumb({ label, active, highlighted, onClick, onDragOver, onDragLeave, onDrop }: {
  label: string;
  active: boolean;
  highlighted: boolean;
  onClick: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="rounded px-1.5 py-0.5 transition"
      style={{
        background: highlighted ? 'var(--nav-hover-bg)' : 'transparent',
        boxShadow: highlighted ? '0 0 0 1px var(--accent)' : 'none',
        color: active ? 'rgb(var(--ink-rgb))' : 'rgba(var(--ink-rgb), 0.5)',
        border: 'none',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

// ─── Folder tile ──────────────────────────────────────────────────────────────

export function FolderIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" />
    </svg>
  );
}

export function FolderTile({
  folder, count, renaming, renameDraft, highlighted, dimmed,
  onOpen, onStartRename, onRenameDraft, onCommitRename, onCancelRename, onDelete,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}: {
  folder: CaseFolder;
  count: number;
  renaming: boolean;
  renameDraft: string;
  highlighted: boolean;
  dimmed: boolean;
  onOpen: () => void;
  onStartRename: () => void;
  onRenameDraft: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const [hover, setHover] = useState(false);

  if (renaming) {
    return (
      <input
        autoFocus
        value={renameDraft}
        onChange={(e) => onRenameDraft(e.target.value)}
        onBlur={onCommitRename}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommitRename();
          if (e.key === 'Escape') onCancelRename();
        }}
        className="rounded-lg px-3 py-2.5 text-sm font-medium outline-none w-full"
        style={{ background: 'var(--nav-active-bg)', border: '1px solid var(--border-med)', color: 'rgb(var(--ink-rgb))' }}
      />
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="rounded-lg px-3 py-2.5 flex items-center gap-2.5 select-none"
      style={{
        background: highlighted ? 'var(--nav-hover-bg)' : 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        boxShadow: highlighted ? '0 0 0 2px var(--accent)' : undefined,
        opacity: dimmed ? 0.45 : 1,
        cursor: 'pointer',
        ...CARD_BASE,
      }}
    >
      <span className="shrink-0 text-ink/45"><FolderIcon /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate text-ink" title={folder.name}>{folder.name}</div>
        <div className="text-[11px] text-ink/40">{count} item{count !== 1 ? 's' : ''}</div>
      </div>
      {hover && (
        <div className="flex items-center gap-1 shrink-0">
          <TileAction label="Rename" onClick={(e) => { e.stopPropagation(); onStartRename(); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </TileAction>
          <TileAction label="Delete" danger onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" />
            </svg>
          </TileAction>
        </div>
      )}
    </div>
  );
}

export function TileAction({ label, danger, onClick, children }: {
  label: string;
  danger?: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex items-center justify-center w-6 h-6 rounded transition"
      style={{
        background: 'transparent',
        border: '1px solid var(--border-subtle)',
        color: danger ? 'rgb(var(--danger-rgb))' : 'var(--nav-inactive-color)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--nav-hover-bg)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  );
}

// ─── Item tile ────────────────────────────────────────────────────────────────

function ItemTile({
  item, folderName, dimmed, selected, onOpen, onToggleSelect, onDragStart, onDragEnd,
  onReorderOver, onReorderLeave, onReorderDrop, reorderEdge,
  folderChoices, currentFolderId, onMoveTo, onRename, onDelete,
}: {
  item: CaseItem;
  /** Set only while searching — tells the user where the hit actually lives. */
  folderName?: string;
  dimmed: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onReorderOver: (e: React.DragEvent) => void;
  onReorderLeave: () => void;
  onReorderDrop: (e: React.DragEvent) => void;
  /** 'before'/'after' when this tile is the current reorder-drop target, else null. */
  reorderEdge: 'before' | 'after' | null;
  folderChoices: { id: string; label: string }[];
  currentFolderId: string | null;
  onMoveTo: (folderId: string | null) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(item.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const kindTitle = item.kind === 'oc-case' && item.teamName
    ? `Imported from ${item.teamName}`
    : KIND_LABEL[item.kind];

  function startRename() {
    setMenuOpen(false);
    setRenameDraft(item.name);
    setRenaming(true);
  }
  function commitRename() {
    onRename(renameDraft);
    setRenaming(false);
  }

  useEffect(() => {
    if (renaming) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [renaming]);

  function handleClick(e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect();
      return;
    }
    onOpen();
  }

  if (renaming) {
    return (
      <div
        className="rounded-lg p-2"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', ...CARD_BASE }}
      >
        <div style={{ pointerEvents: 'none' }}><CasePreview item={item} /></div>
        <input
          ref={inputRef}
          value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          className="mt-2 w-full text-xs font-medium outline-none rounded px-1 py-0.5"
          style={{ background: 'var(--nav-active-bg)', border: '1px solid var(--border-med)', color: 'rgb(var(--ink-rgb))' }}
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onReorderOver}
      onDragLeave={onReorderLeave}
      onDrop={onReorderDrop}
      onMouseEnter={(e) => {
        setHover(true);
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        setHover(false);
        e.currentTarget.style.borderColor = selected ? 'var(--accent)' : 'var(--border-subtle)';
        e.currentTarget.style.transform = '';
      }}
      className="rounded-lg p-2 select-none relative"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        boxShadow: selected
          ? '0 0 0 2px var(--accent)'
          : reorderEdge === 'before' ? '-3px 0 0 var(--accent)'
          : reorderEdge === 'after' ? '3px 0 0 var(--accent)'
          : 'none',
        opacity: dimmed ? 0.45 : 1,
        cursor: 'pointer',
        ...CARD_BASE,
      }}
    >
      {/* Previews are drag images by default; letting the browser drag the <img>
          itself would cancel the tile drag before it starts. */}
      <div style={{ pointerEvents: 'none' }}>
        <CasePreview item={item} />
      </div>

      {(hover || menuOpen) && (
        <div className="absolute top-1.5 right-1.5">
          <TileAction label="More" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="2" cy="6" r="1.1" /><circle cx="6" cy="6" r="1.1" /><circle cx="10" cy="6" r="1.1" />
            </svg>
          </TileAction>
        </div>
      )}

      {menuOpen && (
        <ItemMenu
          folderChoices={folderChoices}
          currentFolderId={currentFolderId}
          onMoveTo={(id) => { setMenuOpen(false); onMoveTo(id); }}
          onRename={() => startRename()}
          onDelete={() => { setMenuOpen(false); onDelete(); }}
          onClose={() => setMenuOpen(false)}
        />
      )}

      <div className="mt-2 px-0.5">
        <div className="text-xs font-medium truncate text-ink" title={item.name}>{item.name}</div>
        <div className="mt-1 flex items-center gap-1 flex-wrap">
          {item.side !== 'unknown' && <SideBadge side={item.side} />}
          <span
            title={kindTitle}
            className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold"
            style={{ background: 'var(--border-subtle)', color: 'var(--placeholder)' }}
          >
            {KIND_LABEL[item.kind]}
          </span>
        </div>
        {folderName && (
          <div className="mt-1 text-[10px] text-ink/40 truncate" title={folderName}>in {folderName}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Right-click / "⋯" popover for a single tile — the grid's equivalent of
 * Sidebar.tsx's NavItem context menu (Move to / Rename / Delete), rebuilt here
 * rather than imported since NavItem is coupled to sidebar-only item types
 * (opponents, tournaments, judges) that don't exist in this grid.
 */
function ItemMenu({ folderChoices, currentFolderId, onMoveTo, onRename, onDelete, onClose }: {
  folderChoices: { id: string; label: string }[];
  currentFolderId: string | null;
  onMoveTo: (folderId: string | null) => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  useMenuA11y(true, ref, onClose);

  const moveOptions = folderChoices.filter((f) => f.id !== currentFolderId);

  return (
    <div
      ref={ref}
      className="glass-popover absolute top-7 right-1.5 z-50 rounded-lg py-1 text-xs shadow-xl"
      style={{ minWidth: 170, maxWidth: 240, border: '1px solid var(--border-subtle)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--placeholder)' }}>
        Move to
      </div>
      <div style={{ maxHeight: 176, overflowY: 'auto' }}>
        {currentFolderId !== null && (
          <button onClick={() => onMoveTo(null)} className="w-full text-left px-3 py-1.5 transition block"
            style={{ color: 'rgb(var(--ink-rgb))' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            Top level (no folder)
          </button>
        )}
        {moveOptions.map((f) => (
          <button key={f.id} onClick={() => onMoveTo(f.id)} className="w-full text-left px-3 py-1.5 transition truncate block"
            title={f.label} style={{ color: 'rgb(var(--ink-rgb))' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            {f.label}
          </button>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '4px 0' }} />
      <button onClick={onRename} className="w-full text-left px-3 py-1.5 transition"
        style={{ color: 'rgb(var(--ink-rgb))' }}
        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
        Rename
      </button>
      <button onClick={onDelete} className="w-full text-left px-3 py-1.5 transition"
        style={{ color: 'rgb(var(--danger-rgb))' }}
        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
        Delete
      </button>
    </div>
  );
}

/** Bulk-action bar shown above the grid while a multi-selection (Cmd/Ctrl+click) is active. */
function ItemSelectionBar({ count, folderChoices, onMove, onDelete, onClear }: {
  count: number;
  folderChoices: { id: string; label: string }[];
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);
  useMenuA11y(menuOpen, menuRef, () => setMenuOpen(false));

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px]"
      style={{ background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)' }}>
      <span className="font-semibold pl-0.5">{count} selected</span>
      <div className="flex-1" />
      <div className="relative" ref={menuRef}>
        <button onClick={() => setMenuOpen((v) => !v)}
          className="px-2.5 py-1 rounded-md transition font-medium"
          style={{ background: 'var(--bg-elevated)', color: 'rgb(var(--ink-rgb))' }}>
          Move to
        </button>
        {menuOpen && (
          <div className="glass-popover absolute right-0 top-full mt-1 z-50 rounded-lg py-1 text-xs shadow-xl"
            style={{ minWidth: 180, maxWidth: 260, border: '1px solid var(--border-subtle)' }}>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              <button onClick={() => { onMove(null); setMenuOpen(false); }}
                className="w-full text-left px-3 py-1.5 transition block"
                style={{ color: 'rgb(var(--ink-rgb))' }}
                onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
                onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                Top level (no folder)
              </button>
              {folderChoices.map((f) => (
                <button key={f.id} onClick={() => { onMove(f.id); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 transition truncate block" title={f.label}
                  style={{ color: 'rgb(var(--ink-rgb))' }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <button onClick={onDelete} className="px-2.5 py-1 rounded-md transition font-medium" style={{ color: 'rgb(var(--danger-rgb))' }}
        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgb(var(--danger-rgb) / 0.15)'}
        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
        Delete
      </button>
      <button onClick={onClear} title="Clear selection"
        className="w-5 h-5 flex items-center justify-center rounded-md transition"
        style={{ color: 'rgb(var(--ink-rgb))' }}
        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
        ✕
      </button>
    </div>
  );
}

function SideBadge({ side }: { side: 'aff' | 'neg' }) {
  return (
    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'var(--border-subtle)' }}>
      <span className={`w-1.5 h-1.5 rounded-full ${side === 'aff' ? 'bg-blue-500' : 'bg-rose-500'}`} />
      <span className="text-[9px] uppercase tracking-wider font-semibold text-ink/50">{side}</span>
    </span>
  );
}

// ─── Delete confirm ───────────────────────────────────────────────────────────

export function DeleteFolderConfirm({ folder, parentName, onCancel, onConfirm }: {
  folder: CaseFolder;
  parentName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={onCancel}
    >
      <div
        className="glass-popover rounded-xl p-5 max-w-sm w-full mx-4"
        style={{ border: '1px solid var(--border-subtle)', boxShadow: '0 12px 40px rgba(0,0,0,0.28)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-ink mb-2">Delete “{folder.name}”?</div>
        <p className="text-xs text-ink/60 leading-relaxed mb-4">
          Your documents are kept. Everything in this folder moves up to <strong className="text-ink/80">{parentName}</strong> —
          only the folder itself goes away. Nothing is deleted from disk.
        </p>
        <div className="flex justify-end gap-2">
          <button className="btn text-xs" onClick={onCancel}>Cancel</button>
          <button
            className="btn text-xs"
            style={{ color: 'rgb(var(--danger-rgb))', borderColor: 'rgb(var(--danger-rgb) / 0.3)' }}
            onClick={onConfirm}
          >
            Delete folder
          </button>
        </div>
      </div>
    </div>
  );
}
