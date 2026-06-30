import React, { useState, useMemo, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { Card, CardRun } from '../types';
import { linkifyText } from '../lib/linkify';
import { FormattedBody, CardImages } from './CardBody';
import CardCutter from './CardCutter';
import { HIGHLIGHT_CSS } from '../utils/cardFormat';

const CURRENT_YEAR = new Date().getFullYear();

function shortCite(cite: string): string {
  const comma = cite.indexOf(',');
  return (comma > 0 ? cite.slice(0, comma) : cite).trim();
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function runToHtml(r: CardRun): string {
  const styles: string[] = [`font-size:${r.fontSize ?? 11}pt`];
  if (r.fontSize && r.fontSize < 11) styles.push('opacity:0.6');
  let html = `<span style="${styles.join(';')}">${escHtml(r.text)}</span>`;
  if (r.highlight) html = `<span style="background-color:${HIGHLIGHT_CSS[r.highlight]}">${html}</span>`;
  if (r.underline) html = `<u>${html}</u>`;
  return html;
}

export async function copyCardToClipboard(card: Card): Promise<void> {
  const bodyHtml = card.bodyRuns && card.bodyRuns.length > 0
    ? card.bodyRuns.map(runToHtml).join('')
    : escHtml(card.body);
  const html = [
    `<p style="font-size:12pt;font-weight:bold;margin:0 0 4px">${escHtml(card.tag)}</p>`,
    `<p style="font-size:8pt;margin:0 0 8px;color:#555">${escHtml(card.cite)}</p>`,
    `<p style="font-size:11pt;margin:0;white-space:pre-wrap">${bodyHtml}</p>`,
  ].join('');
  const plain = `${card.tag}\n${card.cite}\n\n${card.body}`;
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    }),
  ]);
}

type ViewMode = 'full' | 'compact';

export default function Library() {
  const { db, cardCutterOpen, setCardCutterOpen } = useApp();
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('full');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const allCards: (Card & { blockTitle: string; caseName: string })[] = useMemo(() => {
    return Object.values(db.cards).map((card) => {
      const block = db.blocks[card.blockId];
      const c = block ? db.cases[block.caseId] : undefined;
      return { ...card, blockTitle: block?.title ?? '—', caseName: c?.name ?? '—' };
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

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  function cancelSelect() {
    setSelectMode(false);
    setSelected(new Set());
    setExportError('');
  }

  function selectAll() {
    setSelected(new Set(results.map((c) => c.id)));
  }

  async function exportSelected() {
    if (!selected.size) return;
    setExporting(true);
    setExportError('');
    try {
      const cards = [...selected]
        .map((id) => db.cards[id])
        .filter(Boolean)
        .map((c) => ({ tag: c.tag, cite: c.cite, body: c.body, bodyRuns: c.bodyRuns }));
      const res = await window.warroom.exportCardsToDocx(cards);
      if (!res.ok && !res.canceled) setExportError(res.error || 'Export failed.');
      else if (res.ok) cancelSelect();
    } catch (e: any) {
      setExportError(e?.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 glass-elevated">
        <h1 className="text-lg font-semibold mb-3">Cards</h1>
        <div className="flex items-center gap-2">
          <input
            className="input flex-1"
            placeholder="Search by tag, cite, or body…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!selectMode && (
            <>
              <button
                className="btn text-xs shrink-0 opacity-60 hover:opacity-100"
                onClick={() => { setSelectMode(true); setSelected(new Set()); }}
                title="Select cards to export to Word"
              >
                Select
              </button>
              <button
                className={`btn text-xs shrink-0 ${viewMode === 'compact' ? 'opacity-100' : 'opacity-60'}`}
                onClick={() => setViewMode((v) => (v === 'full' ? 'compact' : 'full'))}
                title={viewMode === 'full' ? 'Compact view' : 'Full view'}
              >
                {viewMode === 'full' ? 'Compact' : 'Full'}
              </button>
            </>
          )}
          <div className="text-xs text-ink/40 shrink-0">
            {results.length}/{allCards.length}
            {outdatedCount > 0 && <span className="ml-1 text-warn">· {outdatedCount} old</span>}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin p-6 space-y-2">
        {allCards.length === 0 && (
          <div className="text-sm text-ink/40 italic">
            No cards yet. Use the <span className="text-ink/60">＋</span> next to "Cards" in the sidebar to cut a card.
          </div>
        )}
        {results.length === 0 && allCards.length > 0 && (
          <div className="text-sm text-ink/40 italic">No results for "{query}".</div>
        )}
        {results.map((card) => (
          <LibraryCard
            key={card.id}
            card={card}
            viewMode={viewMode}
            selectMode={selectMode}
            selected={selected.has(card.id)}
            onToggleSelect={() => toggleSelect(card.id)}
          />
        ))}
      </div>

      {/* Multi-select export bar */}
      {selectMode && (
        <div className="shrink-0 border-t border-line px-6 py-3 flex items-center gap-3 glass-elevated">
          <button
            className="btn-primary text-sm"
            disabled={!selected.size || exporting}
            onClick={exportSelected}
          >
            {exporting ? 'Exporting…' : `Export ${selected.size} card${selected.size !== 1 ? 's' : ''} to Word`}
          </button>
          <button className="btn text-sm" onClick={selectAll} disabled={exporting}>
            Select all ({results.length})
          </button>
          <button className="btn text-sm" onClick={cancelSelect} disabled={exporting}>Cancel</button>
          {exportError && <span className="text-xs text-danger ml-2">{exportError}</span>}
        </div>
      )}

      {cardCutterOpen && <CardCutter onClose={() => setCardCutterOpen(false)} />}
    </div>
  );
}

interface LibraryCardProps {
  card: Card & { blockTitle: string; caseName: string };
  viewMode: ViewMode;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}

function LibraryCard({ card, viewMode, selectMode, selected, onToggleSelect }: LibraryCardProps) {
  const { setView } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const outdated = CURRENT_YEAR - card.year > 4;
  const preview = card.body.length > 220 ? card.body.slice(0, 220) + '…' : card.body;
  const hasRuns = Array.isArray(card.bodyRuns) && card.bodyRuns.length > 0;

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    await copyCardToClipboard(card);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleCardClick() {
    if (selectMode) { onToggleSelect(); return; }
    setView({ kind: 'block', blockId: card.blockId });
  }

  if (viewMode === 'compact') {
    return (
      <div
        className={`glass-card rounded-sm px-3 py-2 cursor-pointer hover:border-ink/30 transition flex items-center gap-3`}
        style={selectMode && selected ? { borderColor: 'var(--accent)' } : {}}
        onClick={handleCardClick}
      >
        {selectMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate">{card.tag}</span>
            {outdated && <span className="text-[10px] px-1.5 bg-warn/10 text-warn rounded-sm shrink-0">{card.year}</span>}
          </div>
          <div className="text-[11px] text-ink/45 truncate">{shortCite(card.cite)}</div>
        </div>
        {!selectMode && (
          <button
            onClick={handleCopy}
            className="text-[11px] text-ink/30 hover:text-ink/70 shrink-0 transition"
            title="Copy card to clipboard (paste into Word with formatting)"
          >
            {copied ? '✓' : '⎘'}
          </button>
        )}
        <div className="text-[10px] text-ink/30 shrink-0 text-right truncate max-w-[120px]">{card.caseName}</div>
      </div>
    );
  }

  return (
    <div
      className={`glass-card rounded-sm p-3 cursor-pointer hover:border-ink/30 transition group/card ${selectMode && selected ? 'border-ink/40' : ''}`}
      onClick={handleCardClick}
    >
      <div className="flex items-start gap-3">
        {selectMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-semibold">{card.tag}</span>
            {outdated && <span className="text-[10px] px-1.5 py-0 bg-warn/10 text-warn rounded-sm">Outdated — {card.year}</span>}
          </div>
          <div className="text-xs text-ink/50 font-medium mb-1.5">{card.cite}</div>
          <div className="text-xs text-ink/60">
            {expanded
              ? (hasRuns ? <FormattedBody runs={card.bodyRuns!} /> : <div className="leading-relaxed whitespace-pre-wrap">{linkifyText(card.body, card.id)}</div>)
              : <div className="leading-relaxed whitespace-pre-wrap">{linkifyText(preview, card.id)}</div>}
          </div>
          {expanded && (card.images?.length ?? 0) > 0 && <CardImages images={card.images!} />}
          <div className="flex items-center gap-3 mt-1">
            {(card.body.length > 220 || hasRuns || (card.images?.length ?? 0) > 0) && (
              <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="text-[11px] text-ink/40 hover:text-ink">
                {expanded ? 'Collapse' : 'Expand'}
              </button>
            )}
            {!selectMode && (
              <button
                onClick={handleCopy}
                className="text-[11px] text-ink/30 hover:text-ink/70 transition ml-auto"
                title="Copy card to clipboard (paste into Word with formatting)"
              >
                {copied ? '✓ Copied' : '⎘ Copy'}
              </button>
            )}
          </div>
        </div>
        {!selectMode && (
          <div className="text-right shrink-0">
            <div className="text-[10px] text-ink/40 truncate max-w-[140px]">{card.caseName}</div>
            <div className="text-[10px] text-ink/30 truncate max-w-[140px]">{card.blockTitle}</div>
          </div>
        )}
      </div>
    </div>
  );
}
