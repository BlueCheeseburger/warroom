import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { buildCaseItems, CaseItem, CaseItemKind } from '../utils/caseItems';
import {
  useCaseFolders,
  childFolders,
  folderTrail,
  findFolder,
  resolveItemFolder,
  isSelfOrDescendant,
  createFolder,
  renameFolder,
  deleteFolder,
  moveFolder,
  moveItem,
  pruneAssignments,
  CaseFolder,
} from '../utils/caseFolders';
import CasePreview from './CasePreview';

// Two MIME types rather than one payload with a discriminator: dataTransfer.getData
// is unreadable during dragover, so the *type* is the only thing a drop target can
// inspect while deciding whether to accept.
const ITEM_MIME = 'application/x-warroom-item';
const FOLDER_MIME = 'application/x-warroom-folder';

const KIND_LABEL: Record<CaseItemKind, string> = {
  case: 'Case',
  'oc-case': 'Imported',
  'speech-doc': 'Doc',
};

type Drag = { type: 'item'; key: string } | { type: 'folder'; id: string } | null;

const CARD_BASE: React.CSSProperties = {
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

  const subfolders = childFolders(folders, currentFolderId);
  const trail = folderTrail(folders, currentFolderId);

  const term = query.trim().toLowerCase();
  const searching = term.length > 0;

  // Search deliberately ignores the current folder: this grid is the place people
  // come to *find* a doc, and a scoped search would miss everything filed away.
  const visibleItems = useMemo(() => {
    const list = searching
      ? items.filter((i) => i.name.toLowerCase().includes(term))
      : items.filter((i) => resolveItemFolder(folders, i.key) === currentFolderId);
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [items, folders, currentFolderId, term, searching]);

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
    update((d) => deleteFolder(d, folder.id));
    setConfirmDelete(null);
    // The open folder just stopped existing — follow its documents up to the parent.
    if (currentFolderId === folder.id) navigate(folder.parentId);
  }

  /** Whether the in-flight drag may land on `targetId` (null = top level). */
  function canDrop(targetId: string | null): boolean {
    if (!drag) return false;
    if (drag.type === 'item') return true;
    if (targetId === null) return true;
    return !isSelfOrDescendant(folders, drag.id, targetId);
  }

  function handleDragOver(e: React.DragEvent, targetId: string | null, token: string) {
    if (!canDrop(targetId)) return;
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
                    onOpen={() => openItem(item)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(ITEM_MIME, item.key);
                      e.dataTransfer.effectAllowed = 'move';
                      setDrag({ type: 'item', key: item.key });
                    }}
                    onDragEnd={() => { setDrag(null); setDropTarget(null); }}
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

function Crumb({ label, active, highlighted, onClick, onDragOver, onDragLeave, onDrop }: {
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

function FolderIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" />
    </svg>
  );
}

function FolderTile({
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

function TileAction({ label, danger, onClick, children }: {
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

function ItemTile({ item, folderName, dimmed, onOpen, onDragStart, onDragEnd }: {
  item: CaseItem;
  /** Set only while searching — tells the user where the hit actually lives. */
  folderName?: string;
  dimmed: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const kindTitle = item.kind === 'oc-case' && item.teamName
    ? `Imported from ${item.teamName}`
    : KIND_LABEL[item.kind];

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="rounded-lg p-2 select-none"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        opacity: dimmed ? 0.45 : 1,
        cursor: 'pointer',
        ...CARD_BASE,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
        e.currentTarget.style.transform = '';
      }}
    >
      {/* Previews are drag images by default; letting the browser drag the <img>
          itself would cancel the tile drag before it starts. */}
      <div style={{ pointerEvents: 'none' }}>
        <CasePreview item={item} />
      </div>

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

function SideBadge({ side }: { side: 'aff' | 'neg' }) {
  return (
    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'var(--border-subtle)' }}>
      <span className={`w-1.5 h-1.5 rounded-full ${side === 'aff' ? 'bg-blue-500' : 'bg-rose-500'}`} />
      <span className="text-[9px] uppercase tracking-wider font-semibold text-ink/50">{side}</span>
    </span>
  );
}

// ─── Delete confirm ───────────────────────────────────────────────────────────

function DeleteFolderConfirm({ folder, parentName, onCancel, onConfirm }: {
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
