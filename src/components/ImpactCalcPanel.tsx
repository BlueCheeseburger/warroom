import React, { useState } from 'react';
import { useApp } from '../store/appStore';

interface SpeechDocRecent { path: string; name: string; }

function DocPicker({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  const { db } = useApp();
  const cases = Object.values(db.cases);
  const recents: SpeechDocRecent[] = (() => {
    try { return JSON.parse(localStorage.getItem('warroom-speech-doc-recents') ?? '[]'); } catch { return []; }
  })();

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nav-inactive-color)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {label}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          background: 'var(--bg-main)',
          border: `1px solid ${value ? 'var(--accent)' : 'var(--border-subtle)'}`,
          borderRadius: 7,
          padding: '7px 10px',
          fontSize: 13,
          color: value ? 'var(--ink)' : 'var(--nav-inactive-color)',
          cursor: 'pointer',
          outline: 'none',
          transition: 'border-color 0.15s',
        }}
      >
        <option value="">Select a case or speech doc…</option>
        {cases.length > 0 && (
          <optgroup label="Cases">
            {cases.map((c) => (
              <option key={c.id} value={`case:${c.id}`}>📁 {c.name}</option>
            ))}
          </optgroup>
        )}
        {recents.length > 0 && (
          <optgroup label="Speech Docs">
            {recents.map((r) => (
              <option key={r.path} value={`speechdoc:${encodeURIComponent(r.path)}`}>📝 {r.name.replace(/\.docx$/i, '')}</option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

export default function ImpactCalcPanel() {
  const { db, setView } = useApp();
  const [valueA, setValueA] = useState('');
  const [valueB, setValueB] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() { setValueA(''); setValueB(''); setError(null); }

  async function extractText(value: string): Promise<{ text: string; label: string }> {
    if (value.startsWith('case:')) {
      const c = db.cases[value.slice(5)];
      if (!c) throw new Error('Case not found');
      let text = `Case: ${c.name}\n\n`;
      for (const bid of c.blocks) {
        const b = db.blocks[bid]; if (!b) continue;
        text += `[${b.title}]\n`;
        for (const cid of b.cards) {
          const card = db.cards[cid]; if (!card) continue;
          text += `${card.tag}\n${card.cite}\n${card.body}\n\n`;
        }
      }
      return { text, label: c.name };
    }
    if (value.startsWith('speechdoc:')) {
      const path = decodeURIComponent(value.slice(10));
      const res = await (window.warroom as any).speechdoc.extract(path);
      if (!res?.ok) throw new Error(res?.error ?? 'Failed to extract doc');
      const label = path.split('/').pop()?.replace(/\.docx$/i, '') ?? path;
      return { text: res.data.full, label };
    }
    throw new Error('Invalid selection');
  }

  async function analyze() {
    if (!valueA || !valueB || loading) return;
    setLoading(true);
    setError(null);
    try {
      const [docA, docB] = await Promise.all([extractText(valueA), extractText(valueB)]);
      const res = await (window.warroom as any).ai.compareImpactsText(docA.text, docB.text, docA.label, docB.label);
      if (res?.ok && res.result) {
        setView({ kind: 'impact-calc', result: res.result, labelA: docA.label, labelB: docB.label });
      } else {
        setError(res?.error ?? 'Analysis failed — check your API key in Settings.');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error.');
    } finally {
      setLoading(false);
    }
  }

  const canAnalyze = !!valueA && !!valueB && !loading;

  return (
    <div style={{ padding: '0 4px 4px' }}>
      <DocPicker label="Your doc" value={valueA} onChange={(v) => { setValueA(v); setError(null); }} />
      <DocPicker label="Their doc" value={valueB} onChange={(v) => { setValueB(v); setError(null); }} />

      {(valueA || valueB) && (
        <div style={{ textAlign: 'right', marginBottom: 6 }}>
          <button onClick={reset} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--nav-inactive-color)', textDecoration: 'underline', padding: 0 }}>
            Reset
          </button>
        </div>
      )}

      <button
        onClick={analyze}
        disabled={!canAnalyze}
        className="btn-primary"
        style={{ width: '100%', padding: '9px 0', fontSize: 13, gap: 7 }}
      >
        {loading ? (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Analyzing…
          </>
        ) : 'Analyze Impact Calc'}
      </button>

      {error && (
        <div style={{ marginTop: 10, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.25)', borderRadius: 7, padding: '9px 12px', fontSize: 12, color: 'var(--danger-color, #c0392b)', lineHeight: 1.5 }}>
          {error}
        </div>
      )}
    </div>
  );
}
