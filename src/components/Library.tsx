import React, { useState, useMemo } from 'react';
import { useApp } from '../store/appStore';
import { Card } from '../types';
import { linkifyText } from '../lib/linkify';
import { FormattedBody, CardImages } from './CardBody';
import CardCutter from './CardCutter';

const CURRENT_YEAR = new Date().getFullYear();

// "Borsari and Davis 25, Fellows at the…" → "Borsari and Davis 25"
function shortCite(cite: string): string {
  const comma = cite.indexOf(',');
  return (comma > 0 ? cite.slice(0, comma) : cite).trim();
}

type ViewMode = 'full' | 'compact';

export default function Library() {
  const { db, cardCutterOpen, setCardCutterOpen } = useApp();
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('full');

  const allCards: (Card & { blockTitle: string; caseName: string; blockId: string })[] = useMemo(() => {
    return Object.values(db.cards).map((card) => {
      const block = db.blocks[card.blockId];
      const c = block ? db.cases[block.caseId] : undefined;
      return {
        ...card,
        blockTitle: block?.title ?? '—',
        caseName: c?.name ?? '—',
        blockId: card.blockId,
      };
    });
  }, [db]);

  const results = useMemo(() => {
    if (!query.trim()) return allCards;
    const q = query.toLowerCase();
    return allCards.filter(
      (c) =>
        c.tag.toLowerCase().includes(q) ||
        c.cite.toLowerCase().includes(q) ||
        c.body.toLowerCase().includes(q)
    );
  }, [allCards, query]);

  const outdatedCount = allCards.filter((c) => CURRENT_YEAR - c.year > 4).length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 glass-elevated">
        <h1 className="text-lg font-semibold mb-3">Cards</h1>
        <div className="flex items-center gap-4">
          <input
            className="input flex-1"
            placeholder="Search by tag, cite, or body…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className={`btn text-xs shrink-0 ${viewMode === 'compact' ? 'opacity-100' : 'opacity-60'}`}
            onClick={() => setViewMode((v) => v === 'full' ? 'compact' : 'full')}
            title={viewMode === 'full' ? 'Switch to compact view (tag + author only)' : 'Switch to full view'}
          >
            {viewMode === 'full' ? 'Compact' : 'Full'}
          </button>
          <div className="text-xs text-ink/40 shrink-0">
            {results.length} / {allCards.length} cards
            {outdatedCount > 0 && (
              <span className="ml-2 text-warn">· {outdatedCount} outdated</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin p-6 space-y-2">
        {allCards.length === 0 && (
          <div className="text-sm text-ink/40 italic">
            No cards yet. Use the <span className="text-ink/60">＋</span> next to "Cards" in the sidebar to import a saved page or PDF and let Warroom AI cut a card for you.
          </div>
        )}
        {results.length === 0 && allCards.length > 0 && (
          <div className="text-sm text-ink/40 italic">No results for "{query}".</div>
        )}
        {results.map((card) => (
          <LibraryCard key={card.id} card={card} viewMode={viewMode} />
        ))}
      </div>

      {cardCutterOpen && <CardCutter onClose={() => setCardCutterOpen(false)} />}
    </div>
  );
}

function LibraryCard({ card, viewMode }: { card: any; viewMode: ViewMode }) {
  const { setView } = useApp();
  const [expanded, setExpanded] = useState(false);
  const outdated = CURRENT_YEAR - card.year > 4;
  const preview = card.body.length > 220 ? card.body.slice(0, 220) + '…' : card.body;
  const hasRuns = Array.isArray(card.bodyRuns) && card.bodyRuns.length > 0;

  if (viewMode === 'compact') {
    return (
      <div
        className="glass-card rounded-sm px-3 py-2 cursor-pointer hover:border-ink/30 transition flex items-center gap-3"
        onClick={() => setView({ kind: 'block', blockId: card.blockId })}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate">{card.tag}</span>
            {outdated && (
              <span className="text-[10px] px-1.5 py-0 bg-warn/10 text-warn rounded-sm shrink-0">
                {card.year}
              </span>
            )}
          </div>
          <div className="text-[11px] text-ink/45 truncate">{shortCite(card.cite)}</div>
        </div>
        <div className="text-[10px] text-ink/30 shrink-0 text-right truncate max-w-[120px]">{card.caseName}</div>
      </div>
    );
  }

  return (
    <div
      className="glass-card rounded-sm p-3 cursor-pointer hover:border-ink/30 transition"
      onClick={() => setView({ kind: 'block', blockId: card.blockId })}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-semibold">{card.tag}</span>
            {outdated && (
              <span className="text-[10px] px-1.5 py-0 bg-warn/10 text-warn rounded-sm">
                Outdated — {card.year}
              </span>
            )}
          </div>
          <div className="text-xs text-ink/50 font-medium mb-1.5">{card.cite}</div>
          <div className="text-xs text-ink/60">
            {expanded
              ? (hasRuns ? <FormattedBody runs={card.bodyRuns} /> : <div className="leading-relaxed whitespace-pre-wrap">{linkifyText(card.body, card.id)}</div>)
              : <div className="leading-relaxed whitespace-pre-wrap">{linkifyText(preview, card.id)}</div>}
          </div>
          {expanded && card.images?.length > 0 && <CardImages images={card.images} />}
          {(card.body.length > 220 || hasRuns || card.images?.length > 0) && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="text-[11px] text-ink/40 hover:text-ink mt-1"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-ink/40 truncate max-w-[140px]">{card.caseName}</div>
          <div className="text-[10px] text-ink/30 truncate max-w-[140px]">{card.blockTitle}</div>
        </div>
      </div>
    </div>
  );
}
