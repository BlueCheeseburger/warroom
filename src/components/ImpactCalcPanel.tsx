import React, { useState } from 'react';
import { useApp } from '../store/appStore';

interface ImpactItem {
  claim: string;
  magnitude: 'extinction' | 'existential' | 'major' | 'moderate' | 'minor';
  probability: 'high' | 'medium' | 'low';
  timeframe: 'immediate' | 'short' | 'medium' | 'long';
  reversibility: 'irreversible' | 'difficult' | 'reversible';
}

interface ImpactClash {
  claimA: string | null;
  claimB: string | null;
  winner: 'A' | 'B' | 'even';
  reasoning: string;
  dimension: string;
}

interface ImpactCalcResult {
  summary: string;
  docA: { label: string; impacts: ImpactItem[] };
  docB: { label: string; impacts: ImpactItem[] };
  clashes: ImpactClash[];
  verdict: 'A' | 'B' | 'even';
  verdictReason: string;
}

function magnitudeColor(m: ImpactItem['magnitude']): string {
  if (m === 'extinction' || m === 'existential') return 'var(--danger-color, #c0392b)';
  if (m === 'major') return '#d97706';
  if (m === 'moderate') return '#ca8a04';
  return 'var(--nav-inactive-color)';
}

function winnerLabel(w: 'A' | 'B' | 'even') {
  if (w === 'A') return 'A wins';
  if (w === 'B') return 'B wins';
  return 'Even';
}

function winnerColor(w: 'A' | 'B' | 'even') {
  if (w === 'A') return '#16a34a';
  if (w === 'B') return '#2563eb';
  return 'var(--nav-inactive-color)';
}

function verdictBg(v: 'A' | 'B' | 'even') {
  if (v === 'A') return 'rgba(22,163,74,0.12)';
  if (v === 'B') return 'rgba(37,99,235,0.12)';
  return 'var(--bg-hover)';
}

function verdictBorder(v: 'A' | 'B' | 'even') {
  if (v === 'A') return '#16a34a';
  if (v === 'B') return '#2563eb';
  return 'var(--border-subtle)';
}

function ImpactBadge({ item }: { item: ImpactItem }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 6, padding: '7px 10px', marginBottom: 6,
    }}>
      <div style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 4, lineHeight: 1.4 }}>
        {item.claim}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: magnitudeColor(item.magnitude), background: `${magnitudeColor(item.magnitude)}18`, borderRadius: 3, padding: '1px 5px' }}>
          {item.magnitude}
        </span>
        <span style={{ fontSize: 10, color: 'var(--nav-inactive-color)', background: 'var(--bg-hover)', borderRadius: 3, padding: '1px 5px' }}>
          {item.probability} prob
        </span>
        <span style={{ fontSize: 10, color: 'var(--nav-inactive-color)', background: 'var(--bg-hover)', borderRadius: 3, padding: '1px 5px' }}>
          {item.timeframe}
        </span>
        <span style={{ fontSize: 10, color: 'var(--nav-inactive-color)', background: 'var(--bg-hover)', borderRadius: 3, padding: '1px 5px' }}>
          {item.reversibility}
        </span>
      </div>
    </div>
  );
}

function ClashCard({ clash }: { clash: ImpactClash }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 8, padding: '10px 12px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: winnerColor(clash.winner),
          background: `${winnerColor(clash.winner)}18`,
          borderRadius: 4, padding: '2px 7px',
        }}>
          {winnerLabel(clash.winner)}
        </span>
        <span style={{ fontSize: 10, color: 'var(--nav-inactive-color)', background: 'var(--bg-hover)', borderRadius: 3, padding: '1px 5px' }}>
          {clash.dimension}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center', marginBottom: 7 }}>
        <div style={{ fontSize: 11, color: 'var(--ink)', lineHeight: 1.35 }}>
          {clash.claimA ?? <span style={{ color: 'var(--nav-inactive-color)' }}>No direct impact</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--nav-inactive-color)', fontWeight: 600 }}>vs</div>
        <div style={{ fontSize: 11, color: 'var(--ink)', lineHeight: 1.35, textAlign: 'right' }}>
          {clash.claimB ?? <span style={{ color: 'var(--nav-inactive-color)' }}>No direct impact</span>}
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--nav-inactive-color)', lineHeight: 1.45, borderTop: '1px solid var(--border-subtle)', paddingTop: 6 }}>
        {clash.reasoning}
      </div>
    </div>
  );
}

interface SpeechDocRecent { path: string; name: string; }

function DocPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { db } = useApp();
  const cases = Object.values(db.cases);

  const speechDocRecents: SpeechDocRecent[] = (() => {
    try {
      const raw = localStorage.getItem('warroom-speech-doc-recents');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  })();

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nav-inactive-color)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 13,
          color: value ? 'var(--ink)' : 'var(--nav-inactive-color)',
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        <option value="">Select a case or speech doc…</option>
        {cases.map((c) => (
          <option key={c.id} value={`case:${c.id}`}>📁 {c.name}</option>
        ))}
        {speechDocRecents.map((r) => (
          <option key={r.path} value={`speechdoc:${encodeURIComponent(r.path)}`}>📝 {r.name}</option>
        ))}
      </select>
    </div>
  );
}

export default function ImpactCalcPanel() {
  const { db } = useApp();
  const [valueA, setValueA] = useState('');
  const [valueB, setValueB] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImpactCalcResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setValueA('');
    setValueB('');
    setResult(null);
    setError(null);
  }

  async function extractText(value: string): Promise<{ text: string; label: string }> {
    if (value.startsWith('case:')) {
      const caseId = value.slice('case:'.length);
      const c = db.cases[caseId];
      if (!c) throw new Error('Case not found');
      const label = c.name;
      let text = `Case: ${c.name}\n\n`;
      for (const blockId of c.blocks) {
        const block = db.blocks[blockId];
        if (!block) continue;
        text += `${block.title}\n`;
        for (const cardId of block.cards) {
          const card = db.cards[cardId];
          if (!card) continue;
          text += `${card.tag ?? ''}\n${card.cite ?? ''}\n${card.body ?? ''}\n\n`;
        }
      }
      return { text, label };
    } else if (value.startsWith('speechdoc:')) {
      const path = decodeURIComponent(value.slice('speechdoc:'.length));
      const res = await (window.warroom as any).speechdoc.extract(path);
      if (!res?.ok) throw new Error(res?.error ?? 'Failed to extract speech doc');
      const name = path.split('/').pop()?.split('\\').pop()?.replace(/\.docx$/i, '') ?? path;
      return { text: res.data.full, label: name };
    }
    throw new Error('Invalid selection');
  }

  async function analyze() {
    if (!valueA || !valueB) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const [docA, docB] = await Promise.all([extractText(valueA), extractText(valueB)]);
      const res = await (window.warroom as any).ai.compareImpactsText(docA.text, docB.text, docA.label, docB.label);
      if (res?.ok && res.result) {
        setResult(res.result);
      } else {
        setError(res?.error ?? 'Analysis failed.');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error.');
    } finally {
      setLoading(false);
    }
  }

  const canAnalyze = !!valueA && !!valueB && !loading;

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 14px 0' }}>
        <DocPicker label="Your Doc" value={valueA} onChange={(v) => { setValueA(v); setResult(null); setError(null); }} />
        <DocPicker label="Their Doc" value={valueB} onChange={(v) => { setValueB(v); setResult(null); setError(null); }} />

        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <button
            onClick={reset}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--nav-inactive-color)', textDecoration: 'underline',
              padding: 0,
            }}
          >
            Reset
          </button>
        </div>

        <button
          onClick={analyze}
          disabled={!canAnalyze}
          style={{
            width: '100%', marginBottom: 14,
            padding: '8px 0', borderRadius: 7, border: 'none', cursor: canAnalyze ? 'pointer' : 'not-allowed',
            background: canAnalyze ? 'var(--nav-active-color)' : 'var(--bg-hover)',
            color: canAnalyze ? '#fff' : 'var(--nav-inactive-color)',
            fontWeight: 600, fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            transition: 'background 0.15s',
          }}
        >
          {loading && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          )}
          {loading ? 'Analyzing…' : 'Analyze Impact Calc'}
        </button>

        {error && (
          <div style={{
            background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)',
            borderRadius: 7, padding: '10px 12px', marginBottom: 12,
            fontSize: 12, color: 'var(--danger-color, #c0392b)', lineHeight: 1.5,
          }}>
            {error}
          </div>
        )}

        {result && (
          <div style={{ paddingBottom: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, marginBottom: 12 }}>
              {result.summary}
            </div>

            <div style={{
              background: verdictBg(result.verdict),
              border: `1px solid ${verdictBorder(result.verdict)}`,
              borderRadius: 8, padding: '10px 12px', marginBottom: 16,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: winnerColor(result.verdict), marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {result.verdict === 'A' ? `${result.docA.label} wins` : result.verdict === 'B' ? `${result.docB.label} wins` : 'Even'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.5 }}>
                {result.verdictReason}
              </div>
            </div>

            {result.clashes.length > 0 && (
              <section style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nav-inactive-color)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  Impact Clashes
                </div>
                {result.clashes.map((clash, i) => (
                  <ClashCard key={i} clash={clash} />
                ))}
              </section>
            )}

            <section>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nav-inactive-color)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Individual Impacts
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{result.docA.label}</div>
                  {result.docA.impacts.map((item, i) => <ImpactBadge key={i} item={item} />)}
                  {result.docA.impacts.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--nav-inactive-color)' }}>No impacts found.</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{result.docB.label}</div>
                  {result.docB.impacts.map((item, i) => <ImpactBadge key={i} item={item} />)}
                  {result.docB.impacts.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--nav-inactive-color)' }}>No impacts found.</div>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
