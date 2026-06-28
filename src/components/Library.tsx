import React, { useState, useMemo } from 'react';
import { useApp } from '../store/appStore';
import { Card, ExtractedCard } from '../types';
import { linkifyText } from '../lib/linkify';
import { Dots } from './Spinner';
import { humanizeGeminiError } from '../utils/geminiError';

const CURRENT_YEAR = new Date().getFullYear();

// Cards cut from imported PDFs land in a dedicated case/block so they always show
// up in the "All cards" view and can be re-filed into real cases later.
const CUT_CASE_ID = '__cut__';
const CUT_BLOCK_ID = '__cut_inbox__';

export default function Library() {
  const { db } = useApp();
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);

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
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold">Cards</h1>
          <button
            className="btn-primary text-xs flex items-center gap-1.5"
            onClick={() => setImporting(true)}
            title="Import a PDF and let Warroom AI cut cards from it"
          >
            <span className="text-sm leading-none">＋</span> Cut from PDF
          </button>
        </div>
        <div className="flex items-center gap-4">
          <input
            className="input flex-1"
            placeholder="Search by tag, cite, or body…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
            No cards yet. Click <span className="text-ink/60">＋ Cut from PDF</span> to import a website PDF and let Warroom AI cut cards for you.
          </div>
        )}
        {results.length === 0 && allCards.length > 0 && (
          <div className="text-sm text-ink/40 italic">No results for "{query}".</div>
        )}
        {results.map((card) => (
          <LibraryCard key={card.id} card={card} />
        ))}
      </div>

      {importing && <CutFromPdfModal onClose={() => setImporting(false)} />}
    </div>
  );
}

function LibraryCard({ card }: { card: any }) {
  const { setView } = useApp();
  const [expanded, setExpanded] = useState(false);
  const outdated = CURRENT_YEAR - card.year > 4;
  const preview = card.body.length > 220 ? card.body.slice(0, 220) + '…' : card.body;

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
          <div className="text-xs text-ink/60 leading-relaxed whitespace-pre-wrap">
            {linkifyText(expanded ? card.body : preview, card.id)}
          </div>
          {card.body.length > 220 && (
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

// ─── Cut from PDF ───────────────────────────────────────────────────────────────
// Pick a PDF (e.g. a website saved/printed to PDF) → Warroom AI cuts cards from it
// using the card_cutting skill → review/edit → save to the card library.

type CutStep = 'idle' | 'loading' | 'review' | 'error';

interface DraftCard extends ExtractedCard {
  checked: boolean;
}

function CutFromPdfModal({ onClose }: { onClose: () => void }) {
  const { update } = useApp();
  const [step, setStep] = useState<CutStep>('idle');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [saving, setSaving] = useState(false);

  async function pickAndCut() {
    let filePath: string | null = null;
    try {
      filePath = await window.warroom.dialog.openFile(['pdf']);
    } catch {/* dialog cancelled */}
    if (!filePath) return;
    setFileName(filePath.split(/[\\/]/).pop() || 'document.pdf');
    setStep('loading');
    setError('');
    try {
      const cards = await window.warroom.ai.cutCardsFromPdf(filePath);
      if (!Array.isArray(cards) || cards.length === 0) {
        setError('Warroom AI could not find any cuttable evidence in this PDF. Try a different source, or one with more substantive prose.');
        setStep('error');
        return;
      }
      setDrafts(cards.map((c) => ({ ...c, checked: true })));
      setStep('review');
    } catch (e: any) {
      setError(humanizeGeminiError(e?.message) || e?.message || 'Something went wrong cutting cards.');
      setStep('error');
    }
  }

  function patch(i: number, fields: Partial<DraftCard>) {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...fields } : d)));
  }

  const selectedCount = drafts.filter((d) => d.checked).length;

  async function save() {
    const toSave = drafts.filter((d) => d.checked && d.body.trim());
    if (toSave.length === 0) { onClose(); return; }
    setSaving(true);
    const now = new Date().toISOString();
    try {
      await update((db) => {
        const newCards: Record<string, Card> = {};
        const ids: string[] = [];
        toSave.forEach((d) => {
          const id = crypto.randomUUID();
          ids.push(id);
          const year = Number(d.year) || CURRENT_YEAR;
          newCards[id] = {
            id,
            blockId: CUT_BLOCK_ID,
            tag: (d.tag || 'Untitled card').trim(),
            cite: (d.cite || '').trim(),
            body: d.body.trim(),
            year,
            flagged: CURRENT_YEAR - year > 4,
            createdAt: now,
          };
        });
        const existingCase = db.cases[CUT_CASE_ID];
        const cutCase = existingCase
          ? (existingCase.blocks.includes(CUT_BLOCK_ID) ? existingCase : { ...existingCase, blocks: [...existingCase.blocks, CUT_BLOCK_ID] })
          : { id: CUT_CASE_ID, name: 'Cut Cards', side: 'aff' as const, blocks: [CUT_BLOCK_ID] };
        const existingBlock = db.blocks[CUT_BLOCK_ID];
        const cutBlock = existingBlock
          ? existingBlock
          : { id: CUT_BLOCK_ID, caseId: CUT_CASE_ID, title: 'Cut from PDF', type: 'text', cards: [] as string[], createdAt: now, updatedAt: now };
        return {
          ...db,
          cases: { ...db.cases, [CUT_CASE_ID]: cutCase },
          blocks: { ...db.blocks, [CUT_BLOCK_ID]: { ...cutBlock, cards: [...cutBlock.cards, ...ids], updatedAt: now } },
          cards: { ...db.cards, ...newCards },
        };
      });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to save cards.');
      setStep('error');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="glass-elevated rounded-md w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-line flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold">Cut cards from a PDF</h2>
            <p className="text-xs text-ink/40">Warroom AI reads the PDF and cuts debate cards using the card-cutting format.</p>
          </div>
          <button className="text-ink/40 hover:text-ink text-lg leading-none" onClick={onClose}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-5">
          {step === 'idle' && (
            <div className="text-center py-10 space-y-4">
              <div className="text-sm text-ink/60 max-w-md mx-auto">
                Save a web article as a PDF (in your browser: <span className="text-ink/80">Print → Save as PDF</span>), then import it here.
                Warroom AI will write the tag, format the cite, and trim the body for each card.
              </div>
              <button className="btn-primary text-sm" onClick={pickAndCut}>Choose a PDF…</button>
            </div>
          )}

          {step === 'loading' && (
            <div className="text-center py-12 text-sm text-ink/60 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">Warroom AI is cutting cards <Dots /></div>
              <div className="text-xs text-ink/40">Reading {fileName} — this can take up to a minute for long sources.</div>
            </div>
          )}

          {step === 'error' && (
            <div className="py-6 space-y-3">
              <div className="border border-danger/30 rounded-sm bg-danger/5 p-3 text-sm text-danger">{error}</div>
              <div className="flex gap-2">
                <button className="btn text-xs" onClick={() => { setStep('idle'); setError(''); }}>Try another PDF</button>
                <button className="btn text-xs" onClick={onClose}>Close</button>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-medium">{drafts.length} card{drafts.length !== 1 ? 's' : ''} cut</span>
                  <span className="text-ink/40 ml-2">from {fileName}</span>
                </div>
                <div className="flex gap-2">
                  <button className="btn text-xs" onClick={() => setDrafts((p) => p.map((d) => ({ ...d, checked: true })))}>All</button>
                  <button className="btn text-xs" onClick={() => setDrafts((p) => p.map((d) => ({ ...d, checked: false })))}>None</button>
                </div>
              </div>
              <div className="space-y-2">
                {drafts.map((d, i) => (
                  <DraftRow key={i} draft={d} onToggle={() => patch(i, { checked: !d.checked })} onPatch={(f) => patch(i, f)} />
                ))}
              </div>
            </div>
          )}
        </div>

        {step === 'review' && (
          <div className="px-5 py-3 border-t border-line flex items-center gap-2 shrink-0">
            <button className="btn-primary text-sm" disabled={saving || selectedCount === 0} onClick={save}>
              {saving ? 'Saving…' : `Save ${selectedCount} card${selectedCount !== 1 ? 's' : ''} to library`}
            </button>
            <button className="btn text-sm" onClick={onClose} disabled={saving}>Cancel</button>
            <div className="text-xs text-ink/40 ml-auto">Saved cards land in the “Cut Cards” case.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function DraftRow({ draft, onToggle, onPatch }: {
  draft: DraftCard;
  onToggle: () => void;
  onPatch: (fields: Partial<DraftCard>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const outdated = CURRENT_YEAR - (Number(draft.year) || CURRENT_YEAR) > 4;
  const preview = draft.body.length > 280 ? draft.body.slice(0, 280) + '…' : draft.body;

  return (
    <div className={`glass-card rounded-sm p-3 ${draft.checked ? '' : 'opacity-50'}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 shrink-0" checked={draft.checked} onChange={onToggle} />
        <div className="flex-1 min-w-0 space-y-1.5">
          <input
            className="input w-full text-sm font-semibold py-1"
            value={draft.tag}
            placeholder="Tag (the claim this card proves)"
            onChange={(e) => onPatch({ tag: e.target.value })}
          />
          <input
            className="input w-full text-xs py-1 text-ink/70"
            value={draft.cite}
            placeholder="Cite (author, date, title, URL)"
            onChange={(e) => onPatch({ cite: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-ink/40">Year</label>
            <input
              className="input w-20 text-xs py-1"
              type="number"
              value={draft.year}
              onChange={(e) => onPatch({ year: Number(e.target.value) || CURRENT_YEAR })}
            />
            {outdated && <span className="text-[10px] px-1.5 py-0 bg-warn/10 text-warn rounded-sm">Outdated</span>}
          </div>
          <div className="text-xs text-ink/60 leading-relaxed whitespace-pre-wrap">
            {expanded ? draft.body : preview}
          </div>
          {draft.body.length > 280 && (
            <button className="text-[11px] text-ink/40 hover:text-ink" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
