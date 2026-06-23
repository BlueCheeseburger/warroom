import React, { useState } from 'react';
import { useApp } from '../store/appStore';

interface SpeechDocRecent { path: string; name: string; }

// Strip HTML tags from flow cell content (mirrors GeminiPanel's stripCellHtml)
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function DocPicker({ label, value, onChange, disableFlows }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disableFlows: boolean;
}) {
  const { db, flowsIndex } = useApp();
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
        <option value="">Select a doc…</option>
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
        {flowsIndex.length > 0 && (
          <optgroup label={disableFlows ? 'Flows (one flow per comparison)' : 'Flows'}>
            {flowsIndex.map((f) => (
              <option key={f.id} value={`flow:${f.id}`} disabled={disableFlows}>
                {disableFlows ? '🚫' : '📊'} {f.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

export default function ImpactCalcPanel() {
  const { db, flowsIndex, setView } = useApp();
  const [valueA, setValueA] = useState('');
  const [valueB, setValueB] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() { setValueA(''); setValueB(''); setError(null); }

  const isFlow = (v: string) => v.startsWith('flow:');

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
    if (value.startsWith('flow:')) {
      const flowId = value.slice(5);
      const meta = flowsIndex.find((f) => f.id === flowId);
      if (!meta) throw new Error('Flow not found');
      const data: any = await (window.warroom as any).storage.read(`flow_data_${flowId}`);
      if (!data?.sheets?.length) return { text: `Flow: ${meta.name}\n(no content)`, label: meta.name };
      const lines: string[] = [`Flow: ${meta.name}`];
      for (const sheet of data.sheets) {
        lines.push(`\n[${sheet.name ?? 'Sheet'}]`);
        const cells = sheet.cells ?? {};
        const entries = Object.entries(cells) as [string, string][];
        const sorted = entries
          .map(([k, v]) => {
            const [r, c] = k.split('-').map(Number);
            return { r, c, v: stripHtml(String(v)) };
          })
          .filter((e) => e.v)
          .sort((a, b) => a.r - b.r || a.c - b.c);
        for (const { v } of sorted) lines.push(v);
      }
      return { text: lines.join('\n'), label: meta.name };
    }
    throw new Error('Invalid selection');
  }

  async function analyze() {
    if (!valueA || !valueB || loading) return;
    if (isFlow(valueA) && isFlow(valueB)) {
      setError('Only one flow can be compared at a time. Use a case or speech doc for the other side.');
      return;
    }
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
    <div style={{ padding: '0 16px 16px' }}>
      <DocPicker
        label="Your doc"
        value={valueA}
        onChange={(v) => { setValueA(v); setError(null); }}
        disableFlows={isFlow(valueB)}
      />
      <DocPicker
        label="Their doc"
        value={valueB}
        onChange={(v) => { setValueB(v); setError(null); }}
        disableFlows={isFlow(valueA)}
      />

      {(valueA || valueB) && (
        <div style={{ textAlign: 'right', marginBottom: 8 }}>
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
