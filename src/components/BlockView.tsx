import React, { useState } from 'react';
import { useApp, useDangerBtnClass } from '../store/appStore';
import { Card } from '../types';
import ImportCards from './ImportCards';
import { EditIcon, TrashIcon } from './Spinner';
import { linkifyText } from '../lib/linkify';

const CURRENT_YEAR = new Date().getFullYear();
const OUTDATED_THRESHOLD = 4;

function isOutdated(year: number) {
  return CURRENT_YEAR - year > OUTDATED_THRESHOLD;
}

export default function BlockView() {
  const { db, view, mode } = useApp();
  if (view.kind !== 'block') return null;
  const block = db.blocks[view.blockId];
  if (!block) return <NotFound />;
  const parentCase = db.cases[block.caseId];
  const cards = block.cards.map((id) => db.cards[id]).filter(Boolean);

  return (
    <div className="flex flex-col h-full">
      <BlockHeader block={block} parentCase={parentCase} cardCount={cards.length} />
      {mode === 'round' ? (
        <RoundCardList cards={cards} />
      ) : (
        <PrepCardList block={block} cards={cards} />
      )}
    </div>
  );
}

function BlockHeader({ block, parentCase, cardCount }: any) {
  const { update, setView, mode } = useApp();
  const dangerCls = useDangerBtnClass();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(block.title);

  async function saveTitle() {
    if (!title.trim()) return setEditing(false);
    await update((db) => ({
      ...db,
      blocks: { ...db.blocks, [block.id]: { ...block, title: title.trim(), updatedAt: new Date().toISOString() } },
    }));
    setEditing(false);
  }

  async function deleteBlock() {
    if (!confirm(`Delete "${block.title}" and all its cards?`)) return;
    await update((db) => {
      const next = { ...db };
      block.cards.forEach((id: string) => { delete next.cards[id]; });
      delete next.blocks[block.id];
      if (next.cases[block.caseId]) {
        next.cases[block.caseId] = {
          ...next.cases[block.caseId],
          blocks: next.cases[block.caseId].blocks.filter((id: string) => id !== block.id),
        };
      }
      return next;
    });
    setView({ kind: 'case', caseId: block.caseId });
  }

  return (
    <div className="px-6 py-4 glass-elevated flex items-start justify-between gap-4">
      <div className="min-w-0">
        <button
          onClick={() => setView({ kind: 'case', caseId: block.caseId })}
          className="text-xs text-ink/40 hover:text-ink mb-1 flex items-center gap-1"
        >
          ← {parentCase?.name ?? 'Case'}
        </button>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] uppercase tracking-wider text-ink/40 border border-line px-1.5 py-0.5 rounded-sm">
            {block.type}
          </span>
        </div>
        {editing ? (
          <input
            autoFocus
            className="input text-lg font-semibold w-96"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditing(false); }}
          />
        ) : (
          <h1 className="text-lg font-semibold">{block.title}</h1>
        )}
        <div className="text-xs text-ink/40 mt-1">{cardCount} card{cardCount !== 1 ? 's' : ''}</div>
      </div>
      {mode === 'prep' && (
        <div className="flex gap-2 pt-1 shrink-0">
          <button className="btn btn-icon w-7 h-7" title="Rename" onClick={() => setEditing(true)}><EditIcon /></button>
          <button className={`btn btn-icon w-7 h-7 ${dangerCls}`} title="Delete" onClick={deleteBlock}><TrashIcon /></button>
        </div>
      )}
    </div>
  );
}

function PrepCardList({ block, cards }: { block: any; cards: Card[] }) {
  return (
    <div className="flex-1 overflow-y-auto scroll-thin p-6 space-y-3">
      {cards.length === 0 && (
        <div className="text-sm text-ink/40 italic">No cards yet.</div>
      )}
      {cards.map((card) => (
        <CardRow key={card.id} card={card} blockId={block.id} />
      ))}
      <div className="flex flex-col gap-2 pt-1">
        <AddCardForm blockId={block.id} />
        <ImportCards blockId={block.id} onDone={() => {}} />
      </div>
    </div>
  );
}

function RoundCardList({ cards }: { cards: Card[] }) {
  return (
    <div className="flex-1 overflow-y-auto scroll-thin p-8 space-y-8 max-w-3xl">
      {cards.length === 0 && <div className="text-base text-ink/40 italic">No cards in this block.</div>}
      {cards.map((card) => (
        <div key={card.id} className="space-y-2">
          <div className="text-base font-semibold leading-snug">{card.tag}</div>
          <div className="text-sm text-ink/60 font-medium">{card.cite}</div>
          <div className="text-sm text-ink/80 leading-relaxed whitespace-pre-wrap">{card.body}</div>
          {isOutdated(card.year) && (
            <span className="inline-block text-[11px] px-1.5 py-0.5 bg-warn/10 text-warn rounded-sm">
              Outdated — {card.year}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function CardRow({ card, blockId }: { card: Card; blockId: string }) {
  const { update } = useApp();
  const dangerCls = useDangerBtnClass();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const outdated = isOutdated(card.year);

  async function deleteCard() {
    await update((db) => {
      const next = { ...db };
      delete next.cards[card.id];
      next.blocks[blockId] = {
        ...next.blocks[blockId],
        cards: next.blocks[blockId].cards.filter((id) => id !== card.id),
        updatedAt: new Date().toISOString(),
      };
      return next;
    });
  }

  if (editing) {
    return <CardEditor card={card} blockId={blockId} onDone={() => setEditing(false)} />;
  }

  const bodyPreview = card.body.length > 280 ? card.body.slice(0, 280) + '…' : card.body;

  return (
    <div className="glass-card rounded-sm p-3 group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold">{card.tag}</span>
            {outdated && (
              <span className="text-[10px] px-1.5 py-0 bg-warn/10 text-warn rounded-sm shrink-0">
                Outdated — {card.year}
              </span>
            )}
          </div>
          <div className="text-xs text-ink/50 font-medium mb-2">{card.cite}</div>
          <div className="text-xs text-ink/70 leading-relaxed whitespace-pre-wrap">
            {linkifyText(expanded ? card.body : bodyPreview, card.id)}
          </div>
          {card.body.length > 280 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-ink/40 hover:text-ink mt-1"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
          <button className="btn btn-icon w-7 h-7" title="Edit" onClick={() => setEditing(true)}><EditIcon /></button>
          <button className={`btn btn-icon w-7 h-7 ${dangerCls}`} title="Delete" onClick={deleteCard}><TrashIcon /></button>
        </div>
      </div>
    </div>
  );
}

function AddCardForm({ blockId }: { blockId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="btn text-sm w-full border-dashed text-ink/50 hover:text-ink hover:bg-white/70" onClick={() => setOpen(true)}>
        + Add card
      </button>
    );
  }
  return <CardEditor blockId={blockId} onDone={() => setOpen(false)} />;
}

function CardEditor({ card, blockId, onDone }: { card?: Card; blockId: string; onDone: () => void }) {
  const { update } = useApp();
  const [tag, setTag] = useState(card?.tag ?? '');
  const [cite, setCite] = useState(card?.cite ?? '');
  const [body, setBody] = useState(card?.body ?? '');
  const [year, setYear] = useState(card?.year ?? new Date().getFullYear());

  async function save() {
    if (!tag.trim() || !cite.trim() || !body.trim()) return;
    if (card) {
      await update((db) => ({
        ...db,
        cards: { ...db.cards, [card.id]: { ...card, tag, cite, body, year: Number(year), flagged: isOutdated(Number(year)) } },
      }));
    } else {
      const id = crypto.randomUUID();
      const newCard: Card = {
        id, blockId, tag, cite, body,
        year: Number(year),
        flagged: isOutdated(Number(year)),
        createdAt: new Date().toISOString(),
      };
      await update((db) => ({
        ...db,
        cards: { ...db.cards, [id]: newCard },
        blocks: {
          ...db.blocks,
          [blockId]: {
            ...db.blocks[blockId],
            cards: [...db.blocks[blockId].cards, id],
            updatedAt: new Date().toISOString(),
          },
        },
      }));
    }
    onDone();
  }

  return (
    <div className="border border-ink/20 rounded-sm glass-card p-3 space-y-2">
      <div className="label">{card ? 'Edit card' : 'New card'}</div>
      <input className="input w-full" placeholder="Tag — one-line argumentative claim" value={tag} onChange={(e) => setTag(e.target.value)} />
      <div className="flex gap-2">
        <input className="input flex-1" placeholder="Cite — Author Year, Source" value={cite} onChange={(e) => setCite(e.target.value)} />
        <input
          className="input w-20"
          type="number"
          placeholder="Year"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          min={1990}
          max={2099}
        />
      </div>
      <textarea
        className="input w-full h-36 resize-y text-xs font-mono"
        placeholder="Card body text…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex gap-2">
        <button className="btn-primary" onClick={save}>{card ? 'Save' : 'Add card'}</button>
        <button className="btn" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function NotFound() {
  const { setView } = useApp();
  return (
    <div className="p-8 text-sm text-ink/50">
      Block not found. <button className="underline" onClick={() => setView({ kind: 'home' })}>Go home</button>
    </div>
  );
}
