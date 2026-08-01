import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp, FlowMeta } from '../store/appStore';
import { useMenuA11y } from '../hooks/useMenuA11y';
import {
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
} from '../utils/caseFolders';
import {
  useFlowFolders,
  itemKeyForFlow,
  FLOW_ITEM_DRAG_MIME as ITEM_MIME,
  FLOW_FOLDER_DRAG_MIME as FOLDER_MIME,
} from '../utils/flowFolders';
import { Crumb, FolderTile, DeleteFolderConfirm, ItemSelectionBar, CARD_BASE } from './CasesGrid';

// The Flow library, mirroring the Cases grid: click "Flow" in the sidebar and you
// get every flow and folder at once, instead of managing folders through a header
// button. Folder mechanics are identical (and share caseFolders.ts's pure tree
// helpers) — only the STORE differs (flowFolders.ts, its own key + drag MIME
// types), so a flow can never be filed into a Cases folder or vice versa.
//
// The generic folder UI (Crumb, FolderTile, DeleteFolderConfirm) is imported from
// CasesGrid rather than reimplemented, so the two libraries stay visually and
// behaviorally identical without a second copy to keep in sync.

type Drag = { type: 'item'; key: string } | { type: 'folder'; id: string } | null;

/**
 * Which of the first 4 columns of a flow's first sheet have any real content —
 * drives FlowTile's mini-grid glyph so it reflects the actual flow instead of
 * always drawing the same decoration (see CasePreview, which does the same
 * for Cases tiles). Cell keys are "ri-ci" (see FlowView.tsx); only the column
 * index matters here, not the row.
 */
function computeColumnFill(cells: Record<string, string> | undefined): boolean[] {
  const fill = [false, false, false, false];
  if (!cells) return fill;
  for (const key in cells) {
    const val = cells[key];
    if (!val) continue;
    if (!val.replace(/<[^>]*>/g, '').trim()) continue;
    const ci = parseInt(key.split('-')[1] ?? '', 10);
    if (ci >= 0 && ci < 4) fill[ci] = true;
  }
  return fill;
}

export default function FlowsGrid() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const flowsIndex = useApp((s) => s.flowsIndex);
  const setFlowsIndex = useApp((s) => s.setFlowsIndex);
  const event = useApp((s) => s.event);
  const setAutoFlowOpen = useApp((s) => s.setAutoFlowOpen);
  const { folders, ready, update } = useFlowFolders();

  const currentFolderId = view.kind === 'flows-grid' ? view.folderId ?? null : null;

  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<CaseFolder | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [reorderTarget, setReorderTarget] = useState<{ key: string; edge: 'before' | 'after' } | null>(null);
  const [renamingFlowId, setRenamingFlowId] = useState<string | null>(null);
  const [flowNameDraft, setFlowNameDraft] = useState('');
  const pushUndoToast = useApp((s) => s.pushUndoToast);

  // Multi-select mirrors CasesGrid: Cmd/Ctrl+click toggles a tile in/out
  // without opening it, driving the same bulk move/delete bar.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function clearSelection() { setSelected(new Set()); }

  // Content-aware tile preview: lazily read each flow's data once to learn
  // which of its first 4 columns actually have content. `requested` guards
  // against re-fetching on every render — flow data doesn't need to be live,
  // just accurate enough for a browse-time glyph.
  const [columnFill, setColumnFill] = useState<Record<string, boolean[]>>({});
  const requestedFill = useRef<Set<string>>(new Set());
  useEffect(() => {
    const toFetch = flowsIndex.filter((f) => !requestedFill.current.has(f.id));
    if (toFetch.length === 0) return;
    toFetch.forEach((f) => requestedFill.current.add(f.id));
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(toFetch.map(async (f) => {
        const data = await window.warroom?.storage.read(`flow_data_${f.id}`);
        return [f.id, computeColumnFill(data?.sheets?.[0]?.cells)] as const;
      }));
      if (cancelled) return;
      setColumnFill((prev) => {
        const next = { ...prev };
        for (const [id, fill] of entries) next[id] = fill;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [flowsIndex]);

  // Full breadcrumb per folder, for the flat "Move to" menus.
  const folderChoices = useMemo(
    () => flattenFolders(folders).map((f) => ({ id: f.id, label: folderTrail(folders, f.id).map((t) => t.name).join(' / ') })),
    [folders],
  );

  // Drop assignments for flows that no longer exist. Gated on `ready` — pruning
  // against an empty snapshot would wipe every assignment.
  useEffect(() => {
    if (!ready) return;
    const live = new Set(flowsIndex.map((f) => itemKeyForFlow(f.id)));
    const next = pruneAssignments(folders, live);
    if (Object.keys(next.assignments).length !== Object.keys(folders.assignments).length) update(() => next);
  }, [ready, flowsIndex, folders, update]);

  // Display order = newest created first, until the user drags a tile (then
  // that sticks) — same pattern as CasesGrid. Flows created before `createdAt`
  // existed fall back to their position in flowsIndex (oldest→newest, since
  // createFlow appends), zero-padded so it sorts correctly alongside real ISO
  // timestamps the very first time this runs.
  useEffect(() => {
    if (!ready) return;
    const seeded = ensureOrderSeeded(folders, flowsIndex.map((f, i) => ({
      key: itemKeyForFlow(f.id),
      addedAt: f.createdAt ?? String(i).padStart(8, '0'),
    })));
    if (seeded !== folders) update(() => seeded);
  }, [ready, flowsIndex, folders, update]);

  const subfolders = childFolders(folders, currentFolderId);
  const trail = folderTrail(folders, currentFolderId);
  const searching = query.trim().length > 0;

  // Search deliberately ignores the current folder — this grid is where you come
  // to find a flow, and needing to remember where you filed it defeats that.
  const visibleFlows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = searching
      ? flowsIndex.filter((f) => f.name.toLowerCase().includes(q))
      : flowsIndex.filter((f) => resolveItemFolder(folders, itemKeyForFlow(f.id)) === currentFolderId);
    return sortByOrder(folders, list.map((f) => ({ ...f, key: itemKeyForFlow(f.id) })));
  }, [flowsIndex, folders, currentFolderId, query, searching]);

  const navigate = useCallback((folderId: string | null) => {
    setView({ kind: 'flows-grid', ...(folderId ? { folderId } : {}) });
  }, [setView]);

  async function createFlow() {
    const id = crypto.randomUUID();
    const meta: FlowMeta = { id, name: `Flow ${flowsIndex.length + 1}`, event, createdAt: new Date().toISOString() };
    const next = [...flowsIndex, meta];
    setFlowsIndex(next);
    await window.warroom?.storage.write('flows_index', next);
    // A flow made from inside a folder belongs in that folder.
    if (currentFolderId) update((d) => moveItem(d, itemKeyForFlow(id), currentFolderId));
    setView({ kind: 'flow', flowId: id });
  }

  /** Shared by the single-tile "⋯" menu and the bulk-selection bar. Undoable, like CasesGrid's deleteItems. */
  async function deleteFlows(ids: string[]) {
    const idSet = new Set(ids);
    const removed = flowsIndex.filter((f) => idSet.has(f.id));
    if (removed.length === 0) return;
    const dataSnapshots = await Promise.all(removed.map((f) => window.warroom?.storage.read(`flow_data_${f.id}`)));
    const indexSnapshot = flowsIndex;
    const next = flowsIndex.filter((f) => !idSet.has(f.id));
    setFlowsIndex(next);
    await window.warroom?.storage.write('flows_index', next);
    for (const f of removed) window.warroom?.storage.write(`flow_data_${f.id}`, null as any);
    setSelected((prev) => {
      const n = new Set(prev);
      for (const id of ids) n.delete(itemKeyForFlow(id));
      return n;
    });
    const label = removed.length === 1 ? `Deleted "${removed[0].name}"` : `Deleted ${removed.length} flows`;
    pushUndoToast(label, async () => {
      for (let i = 0; i < removed.length; i++) {
        await window.warroom?.storage.write(`flow_data_${removed[i].id}`, dataSnapshots[i] as any);
      }
      setFlowsIndex(indexSnapshot);
      await window.warroom?.storage.write('flows_index', indexSnapshot);
    });
  }

  async function renameFlow(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = flowsIndex.map((f) => (f.id === id ? { ...f, name: trimmed } : f));
    setFlowsIndex(next);
    await window.warroom?.storage.write('flows_index', next);
  }

  /** Shared by the bulk-move bar and the per-tile "Move to" menu. */
  function moveFlows(keys: string[], folderId: string | null) {
    update((d) => keys.reduce((acc, key) => moveItem(acc, key, folderId), d));
    setSelected((prev) => {
      const n = new Set(prev);
      for (const key of keys) n.delete(key);
      return n;
    });
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
    // The open folder just stopped existing — follow its flows up to the parent.
    if (currentFolderId === folder.id) navigate(folder.parentId);
  }

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
      // Cross-tree drag from the sidebar: values aren't readable until drop, but
      // `.types` is enough to decide whether to accept the hover.
      const types = e.dataTransfer.types;
      if (!types.includes(ITEM_MIME) && !types.includes(FOLDER_MIME)) return;
    }
    e.preventDefault();
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

  function handleReorderOver(e: React.DragEvent, key: string) {
    const isItemDrag = drag?.type === 'item' || e.dataTransfer.types.includes(ITEM_MIME);
    if (!isItemDrag || (drag?.type === 'item' && drag.key === key)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const edge: 'before' | 'after' = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';
    setDropTarget(null);
    setReorderTarget({ key, edge });
  }

  function handleReorderDrop(e: React.DragEvent, key: string) {
    const edge = reorderTarget?.key === key ? reorderTarget.edge : 'before';
    setReorderTarget(null);
    const draggedKey = drag?.type === 'item' ? drag.key : e.dataTransfer.getData(ITEM_MIME);
    setDrag(null);
    if (!draggedKey || draggedKey === key) return;
    e.preventDefault();
    e.stopPropagation();
    const targetFolder = resolveItemFolder(folders, key);
    update((d) => moveInOrder(moveItem(d, draggedKey, targetFolder), draggedKey, key, edge));
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto scroll-thin" style={{ background: 'var(--bg-main)' }}>
      {/* Header */}
      <div
        className="glass-titlebar shrink-0 px-6 py-3 flex items-center justify-between gap-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-sm font-semibold text-ink">Flows</h1>
          <button className="btn text-[11px]" title="Start a blank flow" onClick={createFlow}>+ New flow</button>
          <button className="btn text-[11px]" title={creating ? 'Cancel' : 'Create a folder here'} onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : '+ New folder'}
          </button>
          <button
            className="btn text-[11px] ai-glow-ring"
            title="Build a flow from speech docs with Warroom AI"
            onClick={() => setAutoFlowOpen(true)}
          >
            Auto Flow
          </button>
        </div>
        <input
          className="input text-xs w-56"
          placeholder="Search flows…"
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
            <button className="btn-primary text-xs" title="Create this folder" onClick={commitCreate}>Create</button>
          </div>
        )}

        {trail.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap text-xs">
            <Crumb
              label="Flows"
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
                const count = flowsIndex.filter((fl) => resolveItemFolder(folders, itemKeyForFlow(fl.id)) === f.id).length;
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
            onMove={(folderId) => moveFlows([...selected], folderId)}
            onDelete={() => deleteFlows(flowsIndex.filter((f) => selected.has(itemKeyForFlow(f.id))).map((f) => f.id))}
            onClear={clearSelection}
          />
        )}

        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="label">{searching ? 'Results' : 'Flows'}</div>
            {searching && <span className="text-[11px] text-ink/40">Searching everywhere</span>}
          </div>

          {visibleFlows.length === 0 ? (
            <div className="text-sm italic text-ink/35 py-6">
              {searching ? 'No matches.' : flowsIndex.length === 0 ? 'No flows yet.' : 'This folder is empty — drag flows here.'}
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {visibleFlows.map((f) => {
                const homeId = resolveItemFolder(folders, f.key);
                const home = homeId ? findFolder(folders, homeId) : undefined;
                return (
                  <FlowTile
                    key={f.key}
                    flow={f}
                    folderName={searching ? (home?.name ?? 'Flows') : undefined}
                    columnFill={columnFill[f.id]}
                    dimmed={drag?.type === 'item' && drag.key === f.key}
                    selected={selected.has(f.key)}
                    renaming={renamingFlowId === f.id}
                    renameDraft={flowNameDraft}
                    onRenameDraft={setFlowNameDraft}
                    onStartRename={() => { setFlowNameDraft(f.name); setRenamingFlowId(f.id); }}
                    onCommitRename={() => { renameFlow(f.id, flowNameDraft); setRenamingFlowId(null); }}
                    onCancelRename={() => setRenamingFlowId(null)}
                    onOpen={() => setView({ kind: 'flow', flowId: f.id })}
                    onToggleSelect={() => toggleSelect(f.key)}
                    onDelete={() => deleteFlows([f.id])}
                    folderChoices={folderChoices}
                    currentFolderId={homeId}
                    onMoveTo={(folderId) => moveFlows([f.key], folderId)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(ITEM_MIME, f.key);
                      e.dataTransfer.effectAllowed = 'move';
                      setDrag({ type: 'item', key: f.key });
                    }}
                    onDragEnd={() => { setDrag(null); setDropTarget(null); setReorderTarget(null); }}
                    onReorderOver={(e) => handleReorderOver(e, f.key)}
                    onReorderLeave={() => setReorderTarget((cur) => (cur?.key === f.key ? null : cur))}
                    onReorderDrop={(e) => handleReorderDrop(e, f.key)}
                    reorderEdge={reorderTarget?.key === f.key ? reorderTarget.edge : null}
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
          parentName={confirmDelete.parentId ? findFolder(folders, confirmDelete.parentId)?.name ?? 'Flows' : 'Flows'}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => doDelete(confirmDelete)}
        />
      )}
    </div>
  );
}

// ─── Flow tile ────────────────────────────────────────────────────────────────

function FlowTile({
  flow, folderName, columnFill, dimmed, selected, renaming, renameDraft, onRenameDraft, onStartRename, onCommitRename, onCancelRename,
  onOpen, onToggleSelect, onDelete, folderChoices, currentFolderId, onMoveTo,
  onDragStart, onDragEnd, onReorderOver, onReorderLeave, onReorderDrop, reorderEdge,
}: {
  flow: FlowMeta & { key: string };
  folderName?: string;
  /** Which of the first 4 columns have content — undefined while still loading. */
  columnFill?: boolean[];
  dimmed: boolean;
  selected: boolean;
  renaming: boolean;
  renameDraft: string;
  onRenameDraft: (v: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onOpen: () => void;
  onToggleSelect: () => void;
  onDelete: () => void;
  folderChoices: { id: string; label: string }[];
  currentFolderId: string | null;
  onMoveTo: (folderId: string | null) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onReorderOver: (e: React.DragEvent) => void;
  onReorderLeave: () => void;
  onReorderDrop: (e: React.DragEvent) => void;
  reorderEdge: 'before' | 'after' | null;
}) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
    <div className="relative">
      {reorderEdge && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ [reorderEdge === 'before' ? 'left' : 'right']: -6, width: 2, background: 'var(--accent)', borderRadius: 2 } as React.CSSProperties}
        />
      )}
      <div
        role="button"
        tabIndex={0}
        draggable
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect();
            return;
          }
          onOpen();
        }}
        onDoubleClick={(e) => { e.stopPropagation(); onStartRename(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(true); }}
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
        title={flow.name}
        className="rounded-lg overflow-hidden select-none"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          boxShadow: selected ? '0 0 0 2px var(--accent)' : 'none',
          opacity: dimmed ? 0.45 : 1,
          cursor: 'pointer',
          ...CARD_BASE,
        }}
      >
        {/* Mini flow-grid glyph — reflects which of the flow's first 4 columns
            actually have content (see computeColumnFill above). While that's
            still loading, `columnFill` is undefined and every bar shows, so
            the tile doesn't flash from "full" to "empty" once data lands. */}
        <div
          className="flex items-center justify-center"
          style={{ height: 86, background: 'var(--bg-main)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <svg width="58" height="40" viewBox="0 0 58 40" fill="none" aria-hidden="true">
            <rect x="0.5" y="0.5" width="57" height="39" rx="3" stroke="var(--border-med)" />
            <line x1="14.5" y1="0.5" x2="14.5" y2="39.5" stroke="var(--border-med)" />
            <line x1="29" y1="0.5" x2="29" y2="39.5" stroke="var(--border-med)" />
            <line x1="43.5" y1="0.5" x2="43.5" y2="39.5" stroke="var(--border-med)" />
            <line x1="0.5" y1="10.5" x2="57.5" y2="10.5" stroke="var(--border-med)" />
            {(columnFill?.[0] ?? true) && <>
              <rect x="3" y="14" width="9" height="2" rx="1" fill="currentColor" opacity="0.35" />
              <rect x="3" y="19" width="7" height="2" rx="1" fill="currentColor" opacity="0.25" />
            </>}
            {(columnFill?.[1] ?? true) && (
              <rect x="17.5" y="14" width="9" height="2" rx="1" fill="currentColor" opacity="0.35" />
            )}
            {(columnFill?.[2] ?? true) && (
              <rect x="32" y="19" width="9" height="2" rx="1" fill="currentColor" opacity="0.35" />
            )}
            {(columnFill?.[3] ?? true) && (
              <rect x="46.5" y="24" width="8" height="2" rx="1" fill="currentColor" opacity="0.25" />
            )}
          </svg>
        </div>

        <div className="px-3 py-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate text-ink">{flow.name}</div>
            <div className="text-[11px] text-ink/40 truncate">
              {folderName ? `in ${folderName}` : (flow.event === 'pf' ? 'Public Forum' : 'Policy')}
              {(flow as any).live ? ' · Live' : ''}
            </div>
          </div>
          {(hover || menuOpen) && (
            <button
              title="More actions"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="shrink-0 rounded"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)', padding: 2 }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="2" cy="6" r="1.1" /><circle cx="6" cy="6" r="1.1" /><circle cx="10" cy="6" r="1.1" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {menuOpen && (
        <FlowTileMenu
          folderChoices={folderChoices}
          currentFolderId={currentFolderId}
          onMoveTo={(id) => { setMenuOpen(false); onMoveTo(id); }}
          onRename={() => { setMenuOpen(false); onStartRename(); }}
          onDelete={() => { setMenuOpen(false); onDelete(); }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

function FlowTileMenu({ folderChoices, currentFolderId, onMoveTo, onRename, onDelete, onClose }: {
  folderChoices: { id: string; label: string }[];
  currentFolderId: string | null;
  onMoveTo: (folderId: string | null) => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = () => onClose();
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);
  useMenuA11y(true, ref, onClose);

  const options = folderChoices.filter((f) => f.id !== currentFolderId);

  return (
    <div
      ref={ref}
      className="glass-popover absolute right-2 z-50 rounded-lg py-1 text-xs shadow-xl"
      style={{ top: '100%', minWidth: 170, maxWidth: 250, border: '1px solid var(--border-subtle)' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {(currentFolderId !== null || options.length > 0) && (
        <>
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--nav-inactive-color)', opacity: 0.7 }}>
            Move to
          </div>
          <div style={{ maxHeight: 170, overflowY: 'auto' }}>
            {currentFolderId !== null && (
              <MenuRow label="Flows (top level)" onClick={() => onMoveTo(null)} />
            )}
            {options.map((f) => <MenuRow key={f.id} label={f.label} onClick={() => onMoveTo(f.id)} />)}
          </div>
          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '4px 0' }} />
        </>
      )}
      <MenuRow label="Rename" onClick={onRename} />
      <MenuRow label="Delete" danger onClick={onDelete} />
    </div>
  );
}

function MenuRow({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      title={label}
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 transition truncate block"
      style={{ color: danger ? 'var(--danger, #ef4444)' : 'var(--nav-active-color)' }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      {label}
    </button>
  );
}
