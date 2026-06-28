import React from 'react';
import { useApp } from '../store/appStore';
import type { OutweighDifficulty } from '../types';
import ImpactCalcPanel from './ImpactCalcPanel';

// ─── The Impact Calc hub ───────────────────────────────────────────────────────
// A roomy home for everything impact-calc: the Outweigh practice game plus the
// doc/flow comparison tool. Impact Library and Head-to-head Matchups are stubbed
// here as "coming soon" so the menu reflects the planned shape of the section.

const DIFFICULTIES: { key: OutweighDifficulty; label: string; blurb: string; color: string }[] = [
  { key: 'novice',  label: 'Novice',  blurb: 'Concrete, intuitive impacts. Magnitude · probability · timeframe — no theory.', color: '#16a34a' },
  { key: 'jv',      label: 'JV',      blurb: 'Classic policy impacts. Engage scope, probability chains, and reversibility.', color: '#2563eb' },
  { key: 'varsity', label: 'Varsity', blurb: 'Extinction matchups & framework wars. Win the metric before the calc resolves.', color: '#dc2626' },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nav-inactive-color)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 14 }}>
      {children}
    </div>
  );
}

export default function ImpactHub() {
  const { setView } = useApp();

  return (
    <div className="flex flex-col h-full overflow-y-auto scroll-thin" style={{ background: 'var(--bg-main)' }}>
      <div style={{ maxWidth: 920, width: '100%', margin: '0 auto', padding: '28px 32px 56px' }}>

        {/* Back */}
        <button
          onClick={() => setView({ kind: 'home' })}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)', fontSize: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 20 }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          Home
        </button>

        {/* Title */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="3" x2="12" y2="21"/><path d="M5 21h14"/><path d="M5 7l7-4 7 4"/><path d="M5 7l-3 6h6l-3-6z"/><path d="M19 7l-3 6h6l-3-6z"/>
            </svg>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', margin: 0, letterSpacing: '-0.02em' }}>Impact Calc</h1>
          </div>
          <p style={{ fontSize: 13, color: 'var(--nav-inactive-color)', margin: 0, lineHeight: 1.6, maxWidth: 560 }}>
            Sharpen how you weigh impacts. Practice live against Warroom AI, or compare the impacts across your own docs and flows.
          </p>
        </div>

        {/* ── Practice ── */}
        <section style={{ marginBottom: 36 }}>
          <SectionLabel>Practice</SectionLabel>

          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
            borderRadius: 14, padding: '22px 24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>⚔️ The Outweigh Game</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--nav-inactive-color)', margin: '0 0 18px', lineHeight: 1.6, maxWidth: 600 }}>
              Warroom AI reads an impact. You build yours and write the calc. The AI fires back a short rebuttal — then
              you get the last word, and it judges who won with dimension-by-dimension feedback. Pick a difficulty:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.key}
                  onClick={() => setView({ kind: 'outweigh-game', difficulty: d.key })}
                  style={{
                    textAlign: 'left', cursor: 'pointer',
                    background: 'var(--bg-main)', border: '1px solid var(--border-subtle)',
                    borderRadius: 11, padding: '14px 15px', transition: 'border-color 0.15s, transform 0.1s',
                    borderLeft: `3px solid ${d.color}`,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = d.color; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'; (e.currentTarget as HTMLElement).style.borderLeftColor = d.color; }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700, color: d.color, marginBottom: 6 }}>{d.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--nav-inactive-color)', lineHeight: 1.5 }}>{d.blurb}</div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Tools ── */}
        <section>
          <SectionLabel>Tools</SectionLabel>

          {/* Compare two docs — the original impact-calc comparison */}
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
            borderRadius: 14, overflow: 'hidden', marginBottom: 14,
          }}>
            <div style={{ padding: '18px 20px 4px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>📊 Compare two docs</div>
              <p style={{ fontSize: 12.5, color: 'var(--nav-inactive-color)', margin: '0 0 8px', lineHeight: 1.55 }}>
                Run a full impact comparison across two cases, speech docs, or a flow — clash-by-clash, with an overall verdict.
              </p>
            </div>
            <ImpactCalcPanel />
          </div>

          {/* Coming-soon stubs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <ComingSoon
              icon="📚"
              title="Impact Library"
              desc="A searchable database of common impacts — magnitude, probability, timeframe, the standard block, and cards."
            />
            <ComingSoon
              icon="🥊"
              title="Head-to-head Matchups"
              desc="Impact brackets. Pit two impacts against each other and see who usually wins, how, and on what evidence."
            />
          </div>
        </section>

      </div>
    </div>
  );
}

function ComingSoon({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px dashed var(--border-med)',
      borderRadius: 14, padding: '18px 20px', opacity: 0.72,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{icon} {title}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
          color: 'var(--nav-inactive-color)', background: 'var(--bg-hover)', borderRadius: 4, padding: '2px 6px',
        }}>
          Coming soon
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--nav-inactive-color)', margin: 0, lineHeight: 1.55 }}>{desc}</p>
    </div>
  );
}
