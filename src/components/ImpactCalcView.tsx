import React, { useState } from 'react';
import { useApp } from '../store/appStore';

const SAVES_KEY = 'impact_calc_saves';
const MAX_SAVES = 20;

export interface SavedImpactCalc {
  id: string;
  labelA: string;
  labelB: string;
  savedAt: number;
  result: any;
}

export async function loadImpactCalcSaves(): Promise<SavedImpactCalc[]> {
  try {
    const raw = await (window.warroom as any).storage.read(SAVES_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

export async function saveImpactCalc(entry: Omit<SavedImpactCalc, 'id' | 'savedAt'>): Promise<SavedImpactCalc> {
  const saves = await loadImpactCalcSaves();
  const newEntry: SavedImpactCalc = { ...entry, id: crypto.randomUUID(), savedAt: Date.now() };
  const updated = [newEntry, ...saves].slice(0, MAX_SAVES);
  await (window.warroom as any).storage.write(SAVES_KEY, updated);
  return newEntry;
}

export async function deleteImpactCalcSave(id: string): Promise<void> {
  const saves = await loadImpactCalcSaves();
  await (window.warroom as any).storage.write(SAVES_KEY, saves.filter((s) => s.id !== id));
}

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

// ── Markdown emphasis renderer ─────────────────────────────────────────────────
// Supports **bold**, *italic*, __underline__, and `code` inline.
function RichText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const parts: React.ReactNode[] = [];
  // Pattern: **bold**, __underline__, *italic*, `code`
  const re = /(\*\*(.+?)\*\*|__(.+?)__|`(.+?)`|\*(.+?)\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const full = match[0];
    if (full.startsWith('**')) parts.push(<strong key={key++}>{match[2]}</strong>);
    else if (full.startsWith('__')) parts.push(<u key={key++}>{match[3]}</u>);
    else if (full.startsWith('`')) parts.push(<code key={key++} style={{ fontFamily: 'monospace', fontSize: '0.9em', background: 'var(--bg-hover)', borderRadius: 3, padding: '1px 4px' }}>{match[4]}</code>);
    else parts.push(<em key={key++}>{match[5]}</em>);
    last = match.index + full.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span style={style}>{parts}</span>;
}

// ── Color helpers ──────────────────────────────────────────────────────────────

function magnitudeColor(m: ImpactItem['magnitude']) {
  if (m === 'extinction' || m === 'existential') return '#ef4444';
  if (m === 'major') return '#f97316';
  if (m === 'moderate') return '#eab308';
  return 'var(--nav-inactive-color)';
}

function magnitudeRank(m: ImpactItem['magnitude']) {
  return { extinction: 5, existential: 4, major: 3, moderate: 2, minor: 1 }[m] ?? 0;
}

function winnerColor(w: 'A' | 'B' | 'even') {
  return w === 'A' ? '#16a34a' : w === 'B' ? '#2563eb' : 'var(--nav-inactive-color)';
}

function Tag({ children, color, bg }: { children: React.ReactNode; color?: string; bg?: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, borderRadius: 4, padding: '2px 7px',
      color: color ?? 'var(--nav-inactive-color)',
      background: bg ?? 'var(--bg-hover)',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

// ── Impact badge ───────────────────────────────────────────────────────────────

function ImpactBadge({ item }: { item: ImpactItem }) {
  const mc = magnitudeColor(item.magnitude);
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 8, padding: '10px 12px', marginBottom: 8,
      borderLeft: `3px solid ${mc}`,
    }}>
      <div style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 7, lineHeight: 1.45, fontWeight: 500 }}>
        <RichText text={item.claim} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        <Tag color={mc} bg={`${mc}18`}>{item.magnitude}</Tag>
        <Tag>{item.probability} prob</Tag>
        <Tag>{item.timeframe}</Tag>
        <Tag>{item.reversibility}</Tag>
      </div>
    </div>
  );
}

// ── Clash card ─────────────────────────────────────────────────────────────────

function ClashCard({ clash, labelA, labelB }: { clash: ImpactClash; labelA: string; labelB: string }) {
  const wc = winnerColor(clash.winner);
  const winnerName = clash.winner === 'A' ? labelA : clash.winner === 'B' ? labelB : 'Even';

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 10, padding: '14px 16px', marginBottom: 10,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: wc,
          background: `${wc}15`, borderRadius: 5, padding: '3px 9px',
        }}>
          {clash.winner === 'even' ? 'Even' : `${winnerName} wins`}
        </span>
        <Tag>{clash.dimension}</Tag>
      </div>

      {/* Claims side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 28px 1fr', gap: 8, alignItems: 'start', marginBottom: 12 }}>
        <div style={{
          background: 'var(--bg-main)', borderRadius: 6, padding: '8px 10px',
          border: `1px solid ${clash.winner === 'A' ? '#16a34a40' : 'var(--border-subtle)'}`,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{labelA}</div>
          <div style={{ fontSize: 11, color: 'var(--ink)', lineHeight: 1.4 }}>
            {clash.claimA
              ? <RichText text={clash.claimA} />
              : <span style={{ color: 'var(--nav-inactive-color)', fontStyle: 'italic' }}>No direct impact</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--nav-inactive-color)', fontSize: 11, fontWeight: 600, paddingTop: 20 }}>vs</div>
        <div style={{
          background: 'var(--bg-main)', borderRadius: 6, padding: '8px 10px',
          border: `1px solid ${clash.winner === 'B' ? '#2563eb40' : 'var(--border-subtle)'}`,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{labelB}</div>
          <div style={{ fontSize: 11, color: 'var(--ink)', lineHeight: 1.4 }}>
            {clash.claimB
              ? <RichText text={clash.claimB} />
              : <span style={{ color: 'var(--nav-inactive-color)', fontStyle: 'italic' }}>No direct impact</span>}
          </div>
        </div>
      </div>

      {/* Reasoning */}
      <div style={{
        fontSize: 12, lineHeight: 1.6, color: 'var(--ink)',
        borderTop: '1px solid var(--border-subtle)', paddingTop: 10,
      }}>
        <RichText text={clash.reasoning} />
      </div>
    </div>
  );
}

// ── Magnitude bar — visual comparison of impact strength ──────────────────────

function MagnitudeBar({ impacts, color }: { impacts: ImpactItem[]; color: string }) {
  const top = impacts.slice().sort((a, b) => magnitudeRank(b.magnitude) - magnitudeRank(a.magnitude))[0];
  if (!top) return null;
  const rank = magnitudeRank(top.magnitude);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} style={{
          flex: 1, height: 4, borderRadius: 2,
          background: n <= rank ? color : 'var(--border-subtle)',
          transition: 'background 0.2s',
        }} />
      ))}
      <span style={{ fontSize: 10, color: 'var(--nav-inactive-color)', whiteSpace: 'nowrap' }}>{top.magnitude}</span>
    </div>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────────

export default function ImpactCalcView() {
  const { view, setView } = useApp();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  if (view.kind !== 'impact-calc') return null;

  const { result, labelA, labelB } = view as { kind: 'impact-calc'; result: ImpactCalcResult; labelA: string; labelB: string };
  const { verdict, verdictReason, summary, docA, docB, clashes } = result;

  const verdictColor = winnerColor(verdict);
  const verdictName = verdict === 'A' ? labelA : verdict === 'B' ? labelB : null;

  async function handleSave() {
    if (saved || saving) return;
    setSaving(true);
    try {
      await saveImpactCalc({ labelA, labelB, result });
      setSaved(true);
    } catch (e) {
      console.error('Failed to save impact calc', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto scroll-thin" style={{ background: 'var(--bg-main)' }}>
      <div style={{ maxWidth: 860, width: '100%', margin: '0 auto', padding: '28px 32px 48px' }}>

        {/* Back + Save row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <button
            onClick={() => setView({ kind: 'home' })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)', fontSize: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
            Home
          </button>
          <button
            onClick={handleSave}
            disabled={saved || saving}
            className={saved ? '' : 'btn-primary'}
            style={{
              fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5,
              ...(saved ? { background: 'none', border: 'none', color: '#16a34a', fontWeight: 600, cursor: 'default' } : {}),
            }}
          >
            {saved ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                Saved
              </>
            ) : saving ? 'Saving…' : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                Save
              </>
            )}
          </button>
        </div>

        {/* Title */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nav-inactive-color)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Impact Calc</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: 0, lineHeight: 1.2 }}>
            <span style={{ color: '#16a34a' }}>{labelA}</span>
            <span style={{ color: 'var(--nav-inactive-color)', fontWeight: 400, fontSize: 16, margin: '0 10px' }}>vs</span>
            <span style={{ color: '#2563eb' }}>{labelB}</span>
          </h1>
        </div>

        {/* Verdict card */}
        <div style={{
          background: verdict === 'A' ? 'rgba(22,163,74,0.07)' : verdict === 'B' ? 'rgba(37,99,235,0.07)' : 'var(--bg-card)',
          border: `1.5px solid ${verdictColor}40`,
          borderRadius: 12, padding: '20px 24px', marginBottom: 28,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: verdictColor, letterSpacing: '-0.02em' }}>
              {verdictName ? `${verdictName} wins` : 'Even'}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: verdictColor, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              overall verdict
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.65 }}>
            <RichText text={verdictReason} />
          </div>

          {/* Magnitude comparison bars */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{labelA}</div>
              <MagnitudeBar impacts={docA.impacts} color="#16a34a" />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{labelB}</div>
              <MagnitudeBar impacts={docB.impacts} color="#2563eb" />
            </div>
          </div>
        </div>

        {/* Summary */}
        <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.7, marginBottom: 32 }}>
          <RichText text={summary} />
        </div>

        {/* Clashes */}
        {clashes.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nav-inactive-color)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 14 }}>
              Impact Clashes <span style={{ fontWeight: 400, opacity: 0.6 }}>({clashes.length})</span>
            </div>
            {clashes.map((clash, i) => (
              <ClashCard key={i} clash={clash} labelA={labelA} labelB={labelB} />
            ))}
          </section>
        )}

        {/* Individual impacts side by side */}
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nav-inactive-color)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 14 }}>
            Individual Impacts
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
                {labelA} <span style={{ fontWeight: 400, color: 'var(--nav-inactive-color)' }}>({docA.impacts.length})</span>
              </div>
              {docA.impacts.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--nav-inactive-color)', fontStyle: 'italic' }}>No impacts extracted.</div>
                : docA.impacts.map((item, i) => <ImpactBadge key={i} item={item} />)}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#2563eb', flexShrink: 0 }} />
                {labelB} <span style={{ fontWeight: 400, color: 'var(--nav-inactive-color)' }}>({docB.impacts.length})</span>
              </div>
              {docB.impacts.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--nav-inactive-color)', fontStyle: 'italic' }}>No impacts extracted.</div>
                : docB.impacts.map((item, i) => <ImpactBadge key={i} item={item} />)}
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
