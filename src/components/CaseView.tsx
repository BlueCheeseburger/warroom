import React, { useState } from 'react';
import { useApp, useDangerBtnClass } from '../store/appStore';
import { Block } from '../types';
import { EditIcon, TrashIcon } from './Spinner';
import SharePanel from './SharePanel';

const BLOCK_TYPES = [
  { value: 'frontline', label: 'Frontlines' },
  { value: 'answer', label: 'Answers' },
  { value: 'extension', label: 'Extensions' },
  { value: 'counterplan', label: 'Counter-plans' },
  { value: 'disadvantage', label: 'Disadvantages' },
  { value: 'kritik', label: 'Kritiks' },
  { value: 'theory', label: 'Theory' },
  { value: 'other', label: 'Other' },
] as const;

type BlockType = (typeof BLOCK_TYPES)[number]['value'];

export default function CaseView() {
  const { db, update, setView, view, mode } = useApp();
  if (view.kind !== 'case') return null;
  const c = db.cases[view.caseId];
  if (!c) return <NotFound />;

  const blocks = c.blocks.map((id) => db.blocks[id]).filter(Boolean);

  // Group by type, preserving order of BLOCK_TYPES
  const grouped = BLOCK_TYPES.map(({ value, label }) => ({
    type: value,
    label,
    blocks: blocks.filter((b) => b.type === value),
  })).filter((g) => g.blocks.length > 0 || mode === 'prep');

  return (
    <div className="flex flex-col h-full">
      <CaseHeader c={c} blockCount={blocks.length} cardCount={c.blocks.reduce((n, id) => n + (db.blocks[id]?.cards.length ?? 0), 0)} />
      <div className="flex-1 overflow-y-auto scroll-thin p-6">
        {blocks.length === 0 && mode === 'prep' && (
          <div className="text-sm text-ink/40 italic mb-6">No blocks yet — add one below.</div>
        )}
        {grouped.map(({ type, label, blocks: bs }) => (
          <BlockGroup key={type} label={label} blocks={bs} type={type as BlockType} caseId={c.id} />
        ))}
        {mode === 'prep' && <AddBlockForm caseId={c.id} />}
      </div>
    </div>
  );
}

function CaseHeader({ c, blockCount, cardCount }: { c: any; blockCount: number; cardCount: number }) {
  const { update, setView, mode, db } = useApp();
  const dangerCls = useDangerBtnClass();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [shareOpen, setShareOpen] = useState(false);

  async function saveName() {
    if (!name.trim()) return setEditing(false);
    await update((db) => ({ ...db, cases: { ...db.cases, [c.id]: { ...c, name: name.trim() } } }));
    setEditing(false);
  }

  async function deleteCase() {
    if (!confirm(`Delete "${c.name}"? This removes all its blocks and cards.`)) return;
    await update((db) => {
      const next = { ...db };
      const blocksToRemove = c.blocks;
      blocksToRemove.forEach((bid: string) => {
        const block = next.blocks[bid];
        if (block) block.cards.forEach((cid: string) => { delete next.cards[cid]; });
        delete next.blocks[bid];
      });
      delete next.cases[c.id];
      return next;
    });
    setView({ kind: 'home' });
  }

  return (
    <div className="px-6 py-4 glass-elevated flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium ${c.side === 'aff' ? 'badge-aff' : 'badge-neg'}`}>
            {c.side}
          </span>
          {mode === 'round' && <span className="text-[10px] text-ink/40 uppercase tracking-wider">read-only</span>}
        </div>
        {editing ? (
          <input
            autoFocus
            className="input text-lg font-semibold w-80"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditing(false); }}
          />
        ) : (
          <h1 className="text-lg font-semibold">{c.name}</h1>
        )}
        <div className="text-xs text-ink/40 mt-1">{blockCount} blocks · {cardCount} cards</div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          className="btn btn-icon w-7 h-7"
          title="Share this case"
          onClick={() => setShareOpen(true)}
        >
          <ShareIcon />
        </button>
        {mode === 'prep' && (
          <>
            <button className="btn btn-icon w-7 h-7" title="Rename" onClick={() => setEditing(true)}><EditIcon /></button>
            <button className={`btn btn-icon w-7 h-7 ${dangerCls}`} title="Delete" onClick={deleteCase}><TrashIcon /></button>
          </>
        )}
      </div>
      {shareOpen && (
        <SharePanel
          type="case"
          id={c.id}
          name={c.name}
          getData={async () => ({
            case: c,
            blocks: Object.fromEntries(
              c.blocks.map((id: string) => [id, db.blocks[id]]).filter(([, b]: any) => b)
            ),
          })}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12 10a2 2 0 0 0-1.6.8L5.9 8.4A2 2 0 0 0 6 8a2 2 0 0 0-.1-.4l4.5-2.3A2 2 0 1 0 9.9 3.4L5.4 5.7A2 2 0 1 0 5.4 10.3l4.5 2.3A2 2 0 1 0 12 10z"/>
    </svg>
  );
}

function BlockGroup({ label, blocks, type, caseId }: { label: string; blocks: Block[]; type: BlockType; caseId: string }) {
  const { mode } = useApp();
  if (blocks.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="label mb-2">{label}</div>
      <div className="space-y-1">
        {blocks.map((b) => <BlockRow key={b.id} block={b} caseId={caseId} />)}
      </div>
    </div>
  );
}

function BlockRow({ block, caseId }: { block: Block; caseId: string }) {
  const { db, update, setView, mode } = useApp();
  const dangerCls = useDangerBtnClass();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(block.title);
  const cardCount = block.cards.length;
  const outdatedCount = block.cards.filter((id) => {
    const card = db.cards[id];
    return card && new Date().getFullYear() - card.year > 4;
  }).length;

  async function saveTitle() {
    if (!title.trim()) return setEditing(false);
    const now = new Date().toISOString();
    await update((db) => ({ ...db, blocks: { ...db.blocks, [block.id]: { ...block, title: title.trim(), updatedAt: now } } }));
    setEditing(false);
  }

  async function deleteBlock() {
    if (!confirm(`Delete "${block.title}"?`)) return;
    await update((db) => {
      const next = { ...db };
      block.cards.forEach((id) => { delete next.cards[id]; });
      delete next.blocks[block.id];
      next.cases[caseId] = { ...next.cases[caseId], blocks: next.cases[caseId].blocks.filter((id) => id !== block.id) };
      return next;
    });
  }

  return (
    <div className="flex items-center gap-2 group glass-card rounded-sm px-3 py-2 hover:border-ink/30 transition">
      <button className="flex-1 text-left min-w-0" onClick={() => setView({ kind: 'block', blockId: block.id })}>
        {editing ? (
          <input
            autoFocus
            className="input w-full text-sm"
            value={title}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditing(false); }}
          />
        ) : (
          <span className="text-sm font-medium truncate block">{block.title}</span>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-ink/40">{cardCount} card{cardCount !== 1 ? 's' : ''}</span>
          {outdatedCount > 0 && (
            <span className="text-[10px] px-1 py-0 bg-warn/10 text-warn rounded-sm">
              {outdatedCount} outdated
            </span>
          )}
        </div>
      </button>
      {mode === 'prep' && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
          <button className="btn btn-icon w-7 h-7" title="Edit" onClick={(e) => { e.stopPropagation(); setEditing(true); }}><EditIcon /></button>
          <button className={`btn btn-icon w-7 h-7 ${dangerCls}`} title="Delete" onClick={(e) => { e.stopPropagation(); deleteBlock(); }}><TrashIcon /></button>
        </div>
      )}
      <span className="text-ink/30">›</span>
    </div>
  );
}

function AddBlockForm({ caseId }: { caseId: string }) {
  const { update } = useApp();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<BlockType>('answer');

  async function create() {
    if (!title.trim()) return;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const block: Block = { id, caseId, title: title.trim(), type, cards: [], createdAt: now, updatedAt: now };
    await update((db) => ({
      ...db,
      blocks: { ...db.blocks, [id]: block },
      cases: { ...db.cases, [caseId]: { ...db.cases[caseId], blocks: [...db.cases[caseId].blocks, id] } },
    }));
    setTitle('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button className="btn text-sm w-full border-dashed text-ink/50 hover:text-ink hover:bg-white/70" onClick={() => setOpen(true)}>
        + Add block
      </button>
    );
  }

  return (
    <div className="glass-card rounded-sm p-3 space-y-2">
      <div className="label">New block</div>
      <input
        autoFocus
        className="input w-full"
        placeholder="e.g. A2 NFU CP"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setOpen(false); }}
      />
      <div className="flex gap-2">
        <select className="input flex-1" value={type} onChange={(e) => setType(e.target.value as BlockType)}>
          {BLOCK_TYPES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <button className="btn-primary" onClick={create}>Add</button>
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function NotFound() {
  const { setView } = useApp();
  return (
    <div className="p-8 text-sm text-ink/50">
      Case not found. <button className="underline" onClick={() => setView({ kind: 'home' })}>Go home</button>
    </div>
  );
}
