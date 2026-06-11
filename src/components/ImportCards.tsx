import React, { useState } from 'react';
import { useApp } from '../store/appStore';
import { Card, ExtractedCard } from '../types';
import { Dots } from './Spinner';
import { humanizeGeminiError } from '../utils/geminiError';

interface Props {
  blockId: string;
  onDone: () => void;
}

type Step = 'idle' | 'loading' | 'review' | 'error';

export default function ImportCards({ blockId, onDone }: Props) {
  const { update } = useApp();
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [extracted, setExtracted] = useState<ExtractedCard[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  async function pickFile() {
    const filePath = await window.warroom.dialog.openFile(['pdf', 'docx']);
    if (!filePath) return;
    setStep('loading');
    setError('');
    try {
      const cards = await window.warroom.ai.extractCards(filePath);
      if (!Array.isArray(cards) || cards.length === 0) {
        setError('No cards found in the file.');
        setStep('error');
        return;
      }
      setExtracted(cards);
      setChecked(new Set(cards.map((_, i) => i)));
      setStep('review');
    } catch (e: any) {
      setError(humanizeGeminiError(e?.message));
      setStep('error');
    }
  }

  async function confirm() {
    const toImport = extracted.filter((_, i) => checked.has(i));
    if (toImport.length === 0) return onDone();
    const now = new Date().toISOString();
    await update((db) => {
      const newCards: Record<string, Card> = {};
      const ids: string[] = [];
      toImport.forEach((ec) => {
        const id = crypto.randomUUID();
        ids.push(id);
        newCards[id] = {
          id,
          blockId,
          tag: ec.tag,
          cite: ec.cite,
          body: ec.body,
          year: ec.year,
          flagged: new Date().getFullYear() - ec.year > 4,
          createdAt: now,
        };
      });
      return {
        ...db,
        cards: { ...db.cards, ...newCards },
        blocks: {
          ...db.blocks,
          [blockId]: {
            ...db.blocks[blockId],
            cards: [...db.blocks[blockId].cards, ...ids],
            updatedAt: now,
          },
        },
      };
    });
    onDone();
  }

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  if (step === 'idle') {
    return (
      <button className="btn text-sm border-dashed text-ink/50 hover:text-ink" onClick={pickFile}>
        Import from file (.pdf / .docx)
      </button>
    );
  }

  if (step === 'loading') {
    return (
      <div className="border border-line rounded-sm glass-card p-3 text-sm text-ink/50 flex items-center gap-2">
        Extracting cards with AI <Dots />
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="border border-danger/30 rounded-sm bg-danger/5 p-3 text-sm space-y-2">
        <div className="text-danger">{error}</div>
        <button className="btn text-xs" onClick={() => setStep('idle')}>Dismiss</button>
      </div>
    );
  }

  // review step
  return (
    <div className="border border-line rounded-sm glass-card">
      <div className="px-3 py-2 border-b border-line flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">{extracted.length} cards extracted</span>
          <span className="text-xs text-ink/40 ml-2">{checked.size} selected</span>
        </div>
        <div className="flex gap-2">
          <button className="btn text-xs" onClick={() => setChecked(new Set(extracted.map((_, i) => i)))}>All</button>
          <button className="btn text-xs" onClick={() => setChecked(new Set())}>None</button>
        </div>
      </div>
      <div className="max-h-96 overflow-y-auto scroll-thin divide-y divide-line">
        {extracted.map((card, i) => (
          <label key={i} className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-panel">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={checked.has(i)}
              onChange={() => toggle(i)}
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold">{card.tag}</div>
              <div className="text-[11px] text-ink/50">{card.cite}</div>
              <div className="text-[11px] text-ink/60 mt-1 line-clamp-2">{card.body}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-line flex gap-2">
        <button className="btn-primary text-xs" onClick={confirm}>
          Import {checked.size} card{checked.size !== 1 ? 's' : ''}
        </button>
        <button className="btn text-xs" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

