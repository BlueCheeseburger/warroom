import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../store/appStore';
import type { OutweighDifficulty, OutweighScenario, OutweighJudgment } from '../types';

// ─── Markdown emphasis renderer (mirrors ImpactCalcView's RichText) ────────────
function RichText({ text, style }: { text: string; style?: React.CSSProperties }) {
  text = typeof text === 'string' ? text : String(text ?? '');
  const parts: React.ReactNode[] = [];
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

const DIFF_META: Record<OutweighDifficulty, { label: string; color: string }> = {
  novice:  { label: 'Novice',  color: '#16a34a' },
  jv:      { label: 'JV',      color: '#2563eb' },
  varsity: { label: 'Varsity', color: '#dc2626' },
};

const FINAL_SHOT_SECONDS = 60;

type Phase = 'loading-scenario' | 'your-impact' | 'loading-rebuttal' | 'rebuttal' | 'loading-judge' | 'result' | 'error';

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, borderRadius: 4, padding: '2px 7px', color: 'var(--nav-inactive-color)', background: 'var(--bg-hover)', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '64px 0', color: 'var(--nav-inactive-color)' }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <div style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}

export default function OutweighGame() {
  const { view, setView } = useApp();
  const difficulty: OutweighDifficulty = view.kind === 'outweigh-game' ? view.difficulty : 'jv';
  const meta = DIFF_META[difficulty];

  const [phase, setPhase] = useState<Phase>('loading-scenario');
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<OutweighScenario | null>(null);

  const [userImpact, setUserImpact] = useState('');
  const [userCalc, setUserCalc] = useState('');
  const [rebuttal, setRebuttal] = useState('');
  const [userFinal, setUserFinal] = useState('');
  const [judgment, setJudgment] = useState<OutweighJudgment | null>(null);

  // Final-shot countdown (visual urgency, not auto-submit)
  const [secondsLeft, setSecondsLeft] = useState(FINAL_SHOT_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ai = (window.warroom as any).ai;

  const loadScenario = useCallback(async () => {
    setPhase('loading-scenario');
    setError(null);
    try {
      const res = await ai.outweighScenario(difficulty);
      if (res?.ok && res.scenario?.aiImpact) {
        setScenario(res.scenario);
        setPhase('your-impact');
      } else {
        setError(res?.error ?? 'Could not generate a scenario.');
        setPhase('error');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error.');
      setPhase('error');
    }
  }, [difficulty]);

  useEffect(() => { loadScenario(); }, [loadScenario]);

  // Run the countdown only while writing the final shot.
  useEffect(() => {
    if (phase === 'rebuttal') {
      setSecondsLeft(FINAL_SHOT_SECONDS);
      timerRef.current = setInterval(() => {
        setSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
      }, 1000);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [phase]);

  async function submitImpact() {
    if (!userImpact.trim() || !userCalc.trim() || !scenario) return;
    setPhase('loading-rebuttal');
    setError(null);
    try {
      const res = await ai.outweighRebuttal({ difficulty, scenario, userImpact, userCalc });
      if (res?.ok && res.speech) {
        setRebuttal(res.speech);
        setPhase('rebuttal');
      } else {
        setError(res?.error ?? 'Could not generate a rebuttal.');
        setPhase('error');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error.');
      setPhase('error');
    }
  }

  async function submitFinal() {
    if (!scenario) return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setPhase('loading-judge');
    setError(null);
    try {
      const res = await ai.outweighJudge({ difficulty, scenario, userImpact, userCalc, rebuttal, userFinal });
      if (res?.ok && res.result) {
        setJudgment(res.result);
        setPhase('result');
      } else {
        setError(res?.error ?? 'Could not judge the round.');
        setPhase('error');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error.');
      setPhase('error');
    }
  }

  function playAgain() {
    setScenario(null);
    setUserImpact(''); setUserCalc(''); setRebuttal(''); setUserFinal('');
    setJudgment(null);
    loadScenario();
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto scroll-thin" style={{ background: 'var(--bg-main)' }}>
      <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', padding: '24px 32px 56px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <button
            onClick={() => setView({ kind: 'impact-hub' })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)', fontSize: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
            Impact Calc
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--nav-inactive-color)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>The Outweigh Game</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: `${meta.color}18`, borderRadius: 5, padding: '3px 9px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{meta.label}</span>
          </div>
        </div>

        {/* Progress steps */}
        {phase !== 'error' && <StepBar phase={phase} />}

        {phase === 'loading-scenario' && <Spinner label="Warroom AI is drawing an impact…" />}
        {phase === 'loading-rebuttal' && <Spinner label="Warroom AI is writing its rebuttal…" />}
        {phase === 'loading-judge' && <Spinner label="The judge is deciding…" />}

        {phase === 'error' && (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--danger-color, #c0392b)', marginBottom: 16, lineHeight: 1.6 }}>{error}</div>
            <button onClick={loadScenario} className="btn-primary" style={{ fontSize: 13, padding: '8px 18px' }}>Try again</button>
          </div>
        )}

        {/* ── Scenario + your impact ── */}
        {scenario && (phase === 'your-impact' || phase === 'rebuttal' || phase === 'result') && (
          <ScenarioCard scenario={scenario} />
        )}

        {phase === 'your-impact' && scenario && (
          <div style={{ marginTop: 18 }}>
            <FieldLabel>Your impact</FieldLabel>
            <input
              value={userImpact}
              onChange={(e) => setUserImpact(e.target.value)}
              placeholder="e.g. Economic collapse triggers global instability and mass deaths"
              style={inputStyle}
            />
            <FieldLabel style={{ marginTop: 14 }}>Your impact calculus <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— why yours outweighs (1–2 short paragraphs)</span></FieldLabel>
            <textarea
              value={userCalc}
              onChange={(e) => setUserCalc(e.target.value)}
              placeholder="Weigh against their impact on magnitude, probability, timeframe, or reversibility. Give warranted reasons, not just assertions."
              rows={6}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
            />
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={submitImpact}
                disabled={!userImpact.trim() || !userCalc.trim()}
                className="btn-primary"
                style={{ fontSize: 13, padding: '9px 20px' }}
              >
                Send to Warroom AI →
              </button>
            </div>
          </div>
        )}

        {/* ── Rebuttal + final shot ── */}
        {(phase === 'rebuttal' || phase === 'result') && (
          <>
            <YourTurnRecap impact={userImpact} calc={userCalc} />
            <div style={{ marginTop: 18 }}>
              <FieldLabel>Warroom AI's rebuttal</FieldLabel>
              <div style={{
                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${meta.color}`,
                borderRadius: 10, padding: '16px 18px', fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-wrap',
              }}>
                <RichText text={rebuttal} />
              </div>
            </div>
          </>
        )}

        {phase === 'rebuttal' && (
          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <FieldLabel style={{ marginBottom: 0 }}>Your final shot <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— the last word</span></FieldLabel>
              <span style={{
                fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                color: secondsLeft <= 10 ? '#dc2626' : 'var(--nav-inactive-color)',
              }}>
                ⏱ 0:{String(secondsLeft).padStart(2, '0')}
              </span>
            </div>
            <textarea
              value={userFinal}
              onChange={(e) => setUserFinal(e.target.value)}
              placeholder="Crystallize the calc. Tell the judge the one reason your impact comes first."
              rows={4}
              autoFocus
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
            />
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={submitFinal}
                className="btn-primary"
                style={{ fontSize: 13, padding: '9px 20px' }}
              >
                Lock it in — get the decision
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--nav-inactive-color)', textAlign: 'right', marginTop: 6 }}>
              The timer is just for pressure — take as long as you need.
            </div>
          </div>
        )}

        {/* ── Result ── */}
        {phase === 'result' && judgment && (
          <ResultCard
            judgment={judgment}
            userFinal={userFinal}
            onPlayAgain={playAgain}
            onHub={() => setView({ kind: 'impact-hub' })}
          />
        )}

      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-main)', border: '1px solid var(--border-med)',
  borderRadius: 9, padding: '10px 12px', fontSize: 13, color: 'var(--ink)', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
};

function FieldLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nav-inactive-color)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, ...style }}>
      {children}
    </div>
  );
}

function StepBar({ phase }: { phase: Phase }) {
  const order: Phase[] = ['your-impact', 'rebuttal', 'result'];
  const labels = ['Your impact', 'AI rebuttal', 'Decision'];
  // Map loading states to the step they precede.
  const activeIdx =
    phase === 'loading-scenario' || phase === 'your-impact' ? 0
    : phase === 'loading-rebuttal' || phase === 'rebuttal' ? 1
    : 2;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24 }}>
      {order.map((_, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%', fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: i <= activeIdx ? 'var(--accent)' : 'var(--bg-hover)',
              color: i <= activeIdx ? '#fff' : 'var(--nav-inactive-color)',
            }}>{i + 1}</div>
            <span style={{ fontSize: 12, fontWeight: i === activeIdx ? 700 : 500, color: i <= activeIdx ? 'var(--ink)' : 'var(--nav-inactive-color)' }}>{labels[i]}</span>
          </div>
          {i < order.length - 1 && <div style={{ flex: 1, height: 1.5, background: i < activeIdx ? 'var(--accent)' : 'var(--border-subtle)' }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: OutweighScenario }) {
  const imp = scenario.aiImpact;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '18px 20px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nav-inactive-color)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
        The setup
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6, marginBottom: 14 }}>
        <RichText text={scenario.context} />
      </div>
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#dc262618', borderRadius: 5, padding: '3px 9px' }}>
            Warroom AI reads
          </span>
          {scenario.side && <Tag>{scenario.side}</Tag>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 6 }}>
          <RichText text={imp.claim} />
        </div>
        {imp.warrant && (
          <div style={{ fontSize: 12.5, color: 'var(--nav-inactive-color)', lineHeight: 1.6, marginBottom: 12, fontStyle: 'italic' }}>
            <RichText text={imp.warrant} />
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          <Tag>{imp.magnitude}</Tag>
          <Tag>{imp.probability} prob</Tag>
          <Tag>{imp.timeframe}</Tag>
          <Tag>{imp.reversibility}</Tag>
        </div>
      </div>
    </div>
  );
}

function YourTurnRecap({ impact, calc }: { impact: string; calc: string }) {
  return (
    <div style={{ marginTop: 18 }}>
      <FieldLabel>You read</FieldLabel>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--accent)',
        borderRadius: 10, padding: '14px 16px',
      }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.5, marginBottom: calc ? 8 : 0 }}>{impact}</div>
        {calc && <div style={{ fontSize: 12.5, color: 'var(--nav-inactive-color)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{calc}</div>}
      </div>
    </div>
  );
}

function winnerStyle(winner: OutweighJudgment['winner']) {
  if (winner === 'user') return { label: 'You win the impact debate', color: '#16a34a' };
  if (winner === 'ai') return { label: 'Warroom AI wins this one', color: '#dc2626' };
  return { label: "It's a wash", color: 'var(--nav-inactive-color)' };
}

function ResultCard({ judgment, userFinal, onPlayAgain, onHub }: {
  judgment: OutweighJudgment; userFinal: string; onPlayAgain: () => void; onHub: () => void;
}) {
  const ws = winnerStyle(judgment.winner);
  const score = Math.max(0, Math.min(10, Number(judgment.score) || 0));
  return (
    <>
      {userFinal && (
        <div style={{ marginTop: 18 }}>
          <FieldLabel>Your final shot</FieldLabel>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--accent)',
            borderRadius: 10, padding: '14px 16px', fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.6, whiteSpace: 'pre-wrap',
          }}>{userFinal}</div>
        </div>
      )}

      <div style={{
        marginTop: 22, background: `${ws.color}0e`, border: `1.5px solid ${ws.color}40`,
        borderRadius: 12, padding: '20px 22px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: ws.color, letterSpacing: '-0.01em' }}>{ws.label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: ws.color, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
            <span style={{ fontSize: 12, color: 'var(--nav-inactive-color)', fontWeight: 600 }}>/ 10</span>
          </div>
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.7 }}>
          <RichText text={judgment.verdict} />
        </div>
      </div>

      {Array.isArray(judgment.feedback) && judgment.feedback.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <FieldLabel>Dimension feedback</FieldLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {judgment.feedback.map((f, i) => (
              <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 9, padding: '11px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{f.dimension}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.6 }}><RichText text={f.note} /></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(judgment.tips) && judgment.tips.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <FieldLabel>Do this next time</FieldLabel>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {judgment.tips.map((t, i) => (
              <li key={i} style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.6 }}><RichText text={t} /></li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 28, display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button onClick={onPlayAgain} className="btn-primary" style={{ fontSize: 13, padding: '9px 22px' }}>Play again</button>
        <button onClick={onHub} className="btn" style={{ fontSize: 13, padding: '9px 22px' }}>Back to Impact Calc</button>
      </div>
    </>
  );
}
