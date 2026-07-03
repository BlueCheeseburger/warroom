import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../store/appStore';
import type { DB, ImpactLibraryEntry, ImpactLibraryDraft, ImpactLibraryReview, ImpactLibraryEvent } from '../types';

// ─── Markdown emphasis renderer ────────────────────────────────────────────────
function RichText({ text }: { text: string }) {
  const s = typeof text === 'string' ? text : String(text ?? '');
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|__(.+?)__|`(.+?)`|\*(.+?)\*)/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const f = m[0];
    if (f.startsWith('**')) parts.push(<strong key={k++}>{m[2]}</strong>);
    else if (f.startsWith('__')) parts.push(<u key={k++}>{m[3]}</u>);
    else if (f.startsWith('`')) parts.push(<code key={k++} style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>{m[4]}</code>);
    else parts.push(<em key={k++}>{m[5]}</em>);
    last = m.index + f.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return <>{parts}</>;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const EVENTS: { key: ImpactLibraryEvent; label: string }[] = [
  { key: 'policy', label: 'Policy' },
  { key: 'pf', label: 'PF' },
  { key: 'ld', label: 'LD' },
  { key: 'general', label: 'General' },
];
const MAGNITUDE_OPTS = ['extinction', 'existential', 'major', 'moderate', 'minor'];
const PROBABILITY_OPTS = ['high', 'medium', 'low'];
const TIMEFRAME_OPTS = ['immediate', 'short', 'medium', 'long'];
const REVERSIBILITY_OPTS = ['irreversible', 'difficult', 'reversible'];

const LIKE_REASONS = ['Well warranted', 'Great answers', 'Accurate ratings', 'Useful in-round'];
const DISLIKE_REASONS = ['Overstated', 'Outdated evidence', 'Wrong ratings', 'AI error', 'Low quality'];

type SortKey = 'top' | 'new' | 'saved' | 'mine';

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-main)', border: '1px solid var(--border-med)',
  borderRadius: 8, padding: '8px 11px', fontSize: 13, color: 'var(--ink)', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
};

function magnitudeColor(m: string) {
  if (m === 'extinction' || m === 'existential') return '#ef4444';
  if (m === 'major') return '#f97316';
  if (m === 'moderate') return '#eab308';
  return 'var(--nav-inactive-color)';
}

function Tag({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap',
      color: color ?? 'var(--nav-inactive-color)', background: color ? `${color}18` : 'var(--bg-hover)',
    }}>{children}</span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nav-inactive-color)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{children}</div>;
}

// Extract source text from a picked case or speech doc (mirrors OutweighGame).
async function extractDoc(value: string, db: DB): Promise<string> {
  if (value.startsWith('case:')) {
    const c = db.cases[value.slice(5)]; if (!c) return '';
    let text = `Case: ${c.name}\n\n`;
    for (const bid of c.blocks) {
      const b = db.blocks[bid]; if (!b) continue;
      text += `[${b.title}]\n`;
      for (const cid of b.cards) { const card = db.cards[cid]; if (!card) continue; text += `${card.tag}\n${card.cite}\n${card.body}\n\n`; }
    }
    return text;
  }
  if (value.startsWith('speechdoc:')) {
    const path = decodeURIComponent(value.slice(10));
    const res = await (window.warroom as any).speechdoc.extract(path);
    return res?.ok ? (res.data.full ?? '') : '';
  }
  return '';
}

// ─── Main ───────────────────────────────────────────────────────────────────────

type Screen = 'browse' | 'contribute';

export default function ImpactLibrary() {
  const { setView, setChatOpen, db } = useApp();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [entries, setEntries] = useState<ImpactLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('browse');

  const [query, setQuery] = useState('');
  const [eventFilter, setEventFilter] = useState<ImpactLibraryEvent | ''>('');
  const [sort, setSort] = useState<SortKey>('top');

  const impactlib = (window.warroom as any).impactlib;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const session = await (window.warroom as any).chat.getSession();
      if (!session?.ok || !session.data) { setAuthed(false); setLoading(false); return; }
      setAuthed(true);
      const res = await impactlib.list();
      if (res?.ok) { setEntries(res.data.entries); setUid(res.data.uid); }
      else setError(res?.error ?? 'Could not load the library.');
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    let list = entries.slice();
    if (eventFilter) list = list.filter((e) => e.event === eventFilter);
    if (sort === 'saved') list = list.filter((e) => e.saved);
    if (sort === 'mine') list = list.filter((e) => e.author_id === uid);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((e) =>
        [e.title, e.claim, ...(e.tags ?? []), ...(e.answers ?? []), e.magnitude, e.probability, e.timeframe, e.reversibility]
          .join(' ').toLowerCase().includes(q));
    }
    if (sort === 'new') list.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    else list.sort((a, b) => (b.like_count - b.dislike_count) - (a.like_count - a.dislike_count) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    return list;
  }, [entries, eventFilter, sort, query, uid]);

  function patchEntry(id: string, patch: Partial<ImpactLibraryEntry>) {
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e));
  }

  async function handleVote(entry: ImpactLibraryEntry, vote: 1 | -1, reason?: string | null) {
    const next = entry.my_vote === vote && reason === undefined ? 0 : vote; // clicking same button clears
    // optimistic
    patchEntry(entry.id, { my_vote: next as any, my_vote_reason: next === 0 ? null : (reason ?? entry.my_vote_reason ?? null) });
    const res = await impactlib.vote(entry.id, next, next === 0 ? null : (reason ?? entry.my_vote_reason ?? null));
    if (res?.ok && res.data) patchEntry(entry.id, { like_count: res.data.like_count, dislike_count: res.data.dislike_count });
    else if (!res?.ok) load(); // resync on failure
  }

  async function handleSave(entry: ImpactLibraryEntry) {
    const next = !entry.saved;
    patchEntry(entry.id, { saved: next });
    const res = await impactlib.save(entry.id, next);
    if (!res?.ok) patchEntry(entry.id, { saved: !next });
  }

  async function handleDelete(entry: ImpactLibraryEntry) {
    if (!confirm('Delete your library entry? This can\'t be undone.')) return;
    const res = await impactlib.delete(entry.id);
    if (res?.ok) setEntries((prev) => prev.filter((e) => e.id !== entry.id));
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto scroll-thin" style={{ background: 'var(--bg-main)' }}>
      <div style={{ maxWidth: 860, width: '100%', margin: '0 auto', padding: '24px 32px 56px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <button
            onClick={() => screen === 'contribute' ? setScreen('browse') : setView({ kind: 'impact-hub' })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)', fontSize: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
            {screen === 'contribute' ? 'Library' : 'Impact Calc'}
          </button>
          {authed && screen === 'browse' && (
            <button onClick={() => setScreen('contribute')} className="btn-primary" style={{ fontSize: 12, padding: '7px 15px' }}>+ Contribute</button>
          )}
        </div>

        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>📚 Impact Library</h1>
          <p style={{ fontSize: 13, color: 'var(--nav-inactive-color)', margin: 0, lineHeight: 1.55 }}>
            A shared pool of impacts, built by everyone using Warroom. Each entry is AI-structured by dimension with the standard answers.
          </p>
        </div>

        {authed === false && (
          <SignInPrompt onOpenChat={() => setChatOpen(true)} />
        )}

        {authed && screen === 'contribute' && (
          <Contribute db={db} entries={entries} onDone={() => { setScreen('browse'); load(); }} />
        )}

        {authed && screen === 'browse' && (
          <>
            {/* Search + filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search impacts, tags, answers…"
                style={{ ...inputStyle, flex: 1, minWidth: 200 }}
              />
              <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value as any)} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>
                <option value="">All events</option>
                {EVENTS.map((ev) => <option key={ev.key} value={ev.key}>{ev.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
              {([['top', 'Top'], ['new', 'Newest'], ['saved', 'Saved'], ['mine', 'Mine']] as [SortKey, string][]).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
                    border: '1px solid ' + (sort === k ? 'var(--accent)' : 'var(--border-subtle)'),
                    background: sort === k ? 'var(--nav-active-bg)' : 'transparent',
                    color: sort === k ? 'var(--accent)' : 'var(--nav-inactive-color)',
                  }}
                >{label}</button>
              ))}
            </div>

            {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--nav-inactive-color)', fontSize: 13 }}>Loading…</div>}
            {error && <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.25)', color: 'var(--danger-color, #c0392b)', fontSize: 12 }}>{error}</div>}
            {!loading && !error && visible.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--nav-inactive-color)', fontSize: 13, lineHeight: 1.6 }}>
                {entries.length === 0 ? <>The library is empty. Be the first — hit <strong>+ Contribute</strong>.</> : 'Nothing matches these filters.'}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {visible.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  isMine={e.author_id === uid}
                  onVote={handleVote}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sign-in prompt ─────────────────────────────────────────────────────────────

function SignInPrompt({ onOpenChat }: { onOpenChat: () => void }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 14 }}>
      <div style={{ fontSize: 34, marginBottom: 12 }}>🔒</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Sign in to use the Impact Library</div>
      <p style={{ fontSize: 13, color: 'var(--nav-inactive-color)', margin: '0 auto 18px', maxWidth: 400, lineHeight: 1.6 }}>
        The library is shared across everyone using Warroom, so it uses your chat account. Sign in (or create one) in the chat panel, then come back.
      </p>
      <button onClick={onOpenChat} className="btn-primary" style={{ fontSize: 13, padding: '9px 20px' }}>Open chat to sign in</button>
    </div>
  );
}

// ─── Entry card ─────────────────────────────────────────────────────────────────

function EntryCard({ entry, isMine, onVote, onSave, onDelete }: {
  entry: ImpactLibraryEntry;
  isMine: boolean;
  onVote: (e: ImpactLibraryEntry, v: 1 | -1, reason?: string | null) => void;
  onSave: (e: ImpactLibraryEntry) => void;
  onDelete: (e: ImpactLibraryEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reasonFor, setReasonFor] = useState<null | 1 | -1>(null);
  const mc = magnitudeColor(entry.magnitude);
  const author = entry.anonymous ? 'Anonymous' : (entry.author_name || 'Anonymous');
  const eventLabel = EVENTS.find((e) => e.key === entry.event)?.label ?? entry.event;

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '15px 17px', borderLeft: `3px solid ${mc}` }}>
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 3 }}><RichText text={entry.title} /></div>
          <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, opacity: 0.9 }}><RichText text={entry.claim} /></div>
        </div>
        <Tag>{eventLabel}</Tag>
      </div>

      {/* Dimension tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
        <Tag color={mc}>{entry.magnitude}</Tag>
        <Tag>{entry.probability} prob</Tag>
        <Tag>{entry.timeframe}</Tag>
        <Tag>{entry.reversibility}</Tag>
        {(entry.tags ?? []).slice(0, 4).map((t, i) => <Tag key={i}>#{t}</Tag>)}
      </div>

      {/* Expandable detail */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginBottom: 12 }}>
          <DimRow label="Magnitude" value={entry.magnitude} note={entry.magnitude_note} />
          <DimRow label="Probability" value={entry.probability} note={entry.probability_note} />
          <DimRow label="Timeframe" value={entry.timeframe} note={entry.timeframe_note} />
          <DimRow label="Reversibility" value={entry.reversibility} note={entry.reversibility_note} />
          {(entry.answers ?? []).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Label>How to beat it</Label>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {entry.answers.map((a, i) => <li key={i} style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.55 }}><RichText text={a} /></li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <VoteButton active={entry.my_vote === 1} count={entry.like_count} kind="like"
          onClick={() => { onVote(entry, 1); setReasonFor(entry.my_vote === 1 ? null : 1); }} />
        <VoteButton active={entry.my_vote === -1} count={entry.dislike_count} kind="dislike"
          onClick={() => { onVote(entry, -1); setReasonFor(entry.my_vote === -1 ? null : -1); }} />
        <button
          onClick={() => onSave(entry)}
          title={entry.saved ? 'Saved' : 'Save'}
          style={{ ...pillBtn, color: entry.saved ? 'var(--accent)' : 'var(--nav-inactive-color)', borderColor: entry.saved ? 'var(--accent)' : 'var(--border-subtle)' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill={entry.saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
          {entry.saved ? 'Saved' : 'Save'}
        </button>

        <button onClick={() => setExpanded((v) => !v)} style={{ ...pillBtn, marginLeft: 'auto' }}>
          {expanded ? 'Less' : 'Details'}
        </button>
        {isMine && (
          <button onClick={() => onDelete(entry)} title="Delete" style={{ ...pillBtn, color: 'var(--danger-color, #c0392b)', borderColor: 'transparent' }}>✕</button>
        )}
      </div>

      {/* Reason chips (appear after voting) */}
      {reasonFor && (
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--nav-inactive-color)' }}>{reasonFor === 1 ? 'Why the like?' : 'Why the dislike?'}</span>
          {(reasonFor === 1 ? LIKE_REASONS : DISLIKE_REASONS).map((r) => (
            <button
              key={r}
              onClick={() => { onVote(entry, reasonFor, r); setReasonFor(null); }}
              style={{
                fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 12, cursor: 'pointer',
                border: '1px solid ' + (entry.my_vote_reason === r ? 'var(--accent)' : 'var(--border-subtle)'),
                background: entry.my_vote_reason === r ? 'var(--nav-active-bg)' : 'transparent',
                color: entry.my_vote_reason === r ? 'var(--accent)' : 'var(--nav-inactive-color)',
              }}
            >{r}</button>
          ))}
          <button onClick={() => setReasonFor(null)} style={{ fontSize: 11, color: 'var(--nav-inactive-color)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>skip</button>
        </div>
      )}

      {/* Author + score */}
      <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--nav-inactive-color)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span>by {author}{isMine ? ' (you)' : ''}</span>
        {entry.my_vote_reason && <span>· your tag: {entry.my_vote_reason}</span>}
      </div>
    </div>
  );
}

const pillBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
  padding: '5px 11px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--nav-inactive-color)',
};

function VoteButton({ active, count, kind, onClick }: { active: boolean; count: number; kind: 'like' | 'dislike'; onClick: () => void }) {
  const color = kind === 'like' ? '#16a34a' : '#dc2626';
  return (
    <button onClick={onClick} style={{ ...pillBtn, color: active ? color : 'var(--nav-inactive-color)', borderColor: active ? color : 'var(--border-subtle)' }}>
      {kind === 'like'
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" /></svg>}
      {count}
    </button>
  );
}

function DimRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 7 }}>
      <div style={{ width: 92, flexShrink: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--nav-inactive-color)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: label === 'Magnitude' ? magnitudeColor(value) : 'var(--ink)' }}>{value || '—'}</div>
      </div>
      {note && <div style={{ flex: 1, fontSize: 12, color: 'var(--nav-inactive-color)', lineHeight: 1.5 }}><RichText text={note} /></div>}
    </div>
  );
}

// ─── Contribute wizard ──────────────────────────────────────────────────────────

type WizardStep = 'source' | 'edit' | 'review';

function emptyDraft(): ImpactLibraryDraft {
  return {
    title: '', claim: '', magnitude: 'major', magnitude_note: '', probability: 'medium', probability_note: '',
    timeframe: 'medium', timeframe_note: '', reversibility: 'difficult', reversibility_note: '',
    answers: [], tags: [], event: 'general', anonymous: true,
  };
}

function Contribute({ db, entries, onDone }: { db: DB; entries: ImpactLibraryEntry[]; onDone: () => void }) {
  const impactlib = (window.warroom as any).impactlib;
  const ai = (window.warroom as any).ai;

  const [step, setStep] = useState<WizardStep>('source');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // source step
  const [docValue, setDocValue] = useState('');
  const [ideaText, setIdeaText] = useState('');
  const [event, setEvent] = useState<ImpactLibraryEvent>('general');
  const [sourceText, setSourceText] = useState('');

  // edit step
  const [draft, setDraft] = useState<ImpactLibraryDraft>(emptyDraft());
  const [anonymous, setAnonymous] = useState(true);

  // review step
  const [review, setReview] = useState<ImpactLibraryReview | null>(null);

  const cases = Object.values(db.cases);
  const recents: { path: string; name: string }[] = (() => {
    try { return JSON.parse(localStorage.getItem('warroom-speech-doc-recents') ?? '[]'); } catch { return []; }
  })();

  async function draftWithAI() {
    setBusy(true); setErr(null);
    try {
      let src = ideaText.trim();
      if (docValue) {
        const docText = await extractDoc(docValue, db);
        src = docText + (src ? `\n\nUser note: ${src}` : '');
      }
      setSourceText(src);
      const res = await ai.impactLibraryDraft({ source: src, event });
      if (res?.ok && res.draft) {
        setDraft({ ...emptyDraft(), ...res.draft, event, anonymous });
        setStep('edit');
      } else setErr(res?.error ?? 'Could not draft the impact.');
    } catch (e: any) { setErr(e?.message ?? 'Unknown error.'); }
    finally { setBusy(false); }
  }

  async function reviewWithAI() {
    setBusy(true); setErr(null);
    try {
      const existing = entries.map((e) => ({ id: e.id, title: e.title, claim: e.claim }));
      const res = await ai.impactLibraryReview({ entry: draft, source: sourceText, existing });
      if (res?.ok && res.review) {
        setReview(res.review);
        // adopt the regenerated answers/tags into the draft
        setDraft((d) => ({
          ...d,
          answers: Array.isArray(res.review.answers) && res.review.answers.length ? res.review.answers : d.answers,
          tags: Array.isArray(res.review.tags) && res.review.tags.length ? res.review.tags : d.tags,
        }));
        setStep('review');
      } else setErr(res?.error ?? 'Could not review the impact.');
    } catch (e: any) { setErr(e?.message ?? 'Unknown error.'); }
    finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await impactlib.submit({ ...draft, event, anonymous });
      if (res?.ok) onDone();
      else setErr(res?.error ?? 'Could not submit.');
    } catch (e: any) { setErr(e?.message ?? 'Unknown error.'); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <ContribSteps step={step} />
      {err && <div style={{ margin: '0 0 14px', padding: '10px 12px', borderRadius: 8, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.25)', color: 'var(--danger-color, #c0392b)', fontSize: 12 }}>{err}</div>}

      {step === 'source' && (
        <div>
          <Label>Pull from a case or speech doc <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></Label>
          <select value={docValue} onChange={(e) => setDocValue(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 14 }}>
            <option value="">None — I'll type it below</option>
            {cases.length > 0 && <optgroup label="Cases">{cases.map((c) => <option key={c.id} value={`case:${c.id}`}>📁 {c.name}</option>)}</optgroup>}
            {recents.length > 0 && <optgroup label="Speech Docs">{recents.map((r) => <option key={r.path} value={`speechdoc:${encodeURIComponent(r.path)}`}>📝 {r.name.replace(/\.docx$/i, '')}</option>)}</optgroup>}
          </select>

          <Label>…or paste a card / describe the impact</Label>
          <textarea value={ideaText} onChange={(e) => setIdeaText(e.target.value)} rows={6}
            placeholder="Paste the card text, or just describe the impact in your own words. The AI will structure it."
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55, marginBottom: 14 }} />

          <Label>Event</Label>
          <select value={event} onChange={(e) => setEvent(e.target.value as any)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 18 }}>
            {EVENTS.map((ev) => <option key={ev.key} value={ev.key}>{ev.label}</option>)}
          </select>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={draftWithAI} disabled={busy || (!docValue && !ideaText.trim())} className="btn-primary" style={{ fontSize: 13, padding: '9px 20px' }}>
              {busy ? 'Drafting…' : 'Draft with AI →'}
            </button>
          </div>
        </div>
      )}

      {step === 'edit' && (
        <EditDraft draft={draft} setDraft={setDraft} busy={busy} onBack={() => setStep('source')} onNext={reviewWithAI} />
      )}

      {step === 'review' && review && (
        <ReviewStep
          draft={draft} setDraft={setDraft} review={review}
          anonymous={anonymous} setAnonymous={setAnonymous}
          busy={busy} onBack={() => setStep('edit')} onSubmit={submit}
        />
      )}
    </div>
  );
}

function ContribSteps({ step }: { step: WizardStep }) {
  const order: WizardStep[] = ['source', 'edit', 'review'];
  const labels = ['Source', 'Edit draft', 'Review & submit'];
  const idx = order.indexOf(step);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 22 }}>
      {order.map((_, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', background: i <= idx ? 'var(--accent)' : 'var(--bg-hover)', color: i <= idx ? '#fff' : 'var(--nav-inactive-color)' }}>{i + 1}</div>
            <span style={{ fontSize: 12, fontWeight: i === idx ? 700 : 500, color: i <= idx ? 'var(--ink)' : 'var(--nav-inactive-color)' }}>{labels[i]}</span>
          </div>
          {i < order.length - 1 && <div style={{ flex: 1, height: 1.5, background: i < idx ? 'var(--accent)' : 'var(--border-subtle)' }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function ListEditor({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <Label>{label}</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <input value={item} onChange={(e) => { const n = items.slice(); n[i] = e.target.value; onChange(n); }} style={inputStyle} />
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} style={{ ...pillBtn, borderColor: 'transparent', color: 'var(--nav-inactive-color)' }}>✕</button>
          </div>
        ))}
        <button onClick={() => onChange([...items, ''])} style={{ ...pillBtn, alignSelf: 'flex-start' }}>+ Add</button>
      </div>
      {items.length === 0 && <div style={{ fontSize: 11, color: 'var(--nav-inactive-color)', marginTop: 4 }}>{placeholder}</div>}
    </div>
  );
}

function DimEdit({ label, value, opts, onValue, note, onNote }: {
  label: string; value: string; opts: string[]; onValue: (v: string) => void; note: string; onNote: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Label>{label}</Label>
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={value} onChange={(e) => onValue(e.target.value)} style={{ ...inputStyle, width: 150, cursor: 'pointer' }}>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input value={note} onChange={(e) => onNote(e.target.value)} placeholder="one-sentence warrant" style={inputStyle} />
      </div>
    </div>
  );
}

function EditDraft({ draft, setDraft, busy, onBack, onNext }: {
  draft: ImpactLibraryDraft; setDraft: React.Dispatch<React.SetStateAction<ImpactLibraryDraft>>; busy: boolean; onBack: () => void; onNext: () => void;
}) {
  const set = (patch: Partial<ImpactLibraryDraft>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <div>
      <p style={{ fontSize: 12.5, color: 'var(--nav-inactive-color)', margin: '0 0 16px', lineHeight: 1.6 }}>
        Warroom AI structured your source below. Fix anything it got wrong, then have it review, answer, tag, and dupe-check your edited version.
      </p>
      <Label>Title</Label>
      <input value={draft.title} onChange={(e) => set({ title: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }} placeholder="Short impact label" />
      <Label>Claim</Label>
      <textarea value={draft.claim} onChange={(e) => set({ claim: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, marginBottom: 14 }} placeholder="What the harm is and its terminal" />

      <DimEdit label="Magnitude" value={draft.magnitude} opts={MAGNITUDE_OPTS} onValue={(v) => set({ magnitude: v })} note={draft.magnitude_note} onNote={(v) => set({ magnitude_note: v })} />
      <DimEdit label="Probability" value={draft.probability} opts={PROBABILITY_OPTS} onValue={(v) => set({ probability: v })} note={draft.probability_note} onNote={(v) => set({ probability_note: v })} />
      <DimEdit label="Timeframe" value={draft.timeframe} opts={TIMEFRAME_OPTS} onValue={(v) => set({ timeframe: v })} note={draft.timeframe_note} onNote={(v) => set({ timeframe_note: v })} />
      <DimEdit label="Reversibility" value={draft.reversibility} opts={REVERSIBILITY_OPTS} onValue={(v) => set({ reversibility: v })} note={draft.reversibility_note} onNote={(v) => set({ reversibility_note: v })} />

      <ListEditor label="How to beat it (answers)" items={draft.answers} onChange={(v) => set({ answers: v })} placeholder="The AI will fill these in on review if you leave them empty." />
      <ListEditor label="Tags" items={draft.tags} onChange={(v) => set({ tags: v })} placeholder="The AI will suggest tags on review." />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <button onClick={onBack} className="btn" style={{ fontSize: 13, padding: '9px 18px' }}>Back</button>
        <button onClick={onNext} disabled={busy || !draft.title.trim() || !draft.claim.trim()} className="btn-primary" style={{ fontSize: 13, padding: '9px 20px' }}>
          {busy ? 'Reviewing…' : 'Review with AI →'}
        </button>
      </div>
    </div>
  );
}

function ReviewStep({ draft, setDraft, review, anonymous, setAnonymous, busy, onBack, onSubmit }: {
  draft: ImpactLibraryDraft; setDraft: React.Dispatch<React.SetStateAction<ImpactLibraryDraft>>; review: ImpactLibraryReview;
  anonymous: boolean; setAnonymous: (v: boolean) => void; busy: boolean; onBack: () => void; onSubmit: () => void;
}) {
  const drift = review.driftWarnings ?? [];
  const dupes = review.duplicates ?? [];
  return (
    <div>
      {drift.length > 0 && (
        <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 10, background: 'rgba(217,119,6,0.09)', border: '1px solid rgba(217,119,6,0.3)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309', marginBottom: 6 }}>⚠ Doesn't match the source</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {drift.map((d, i) => <li key={i} style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.5 }}><RichText text={d} /></li>)}
          </ul>
        </div>
      )}
      {dupes.length > 0 && (
        <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 10, background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Possible duplicates already in the library</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {dupes.map((d, i) => <li key={i} style={{ fontSize: 12, color: 'var(--nav-inactive-color)', lineHeight: 1.5 }}><strong style={{ color: 'var(--ink)' }}>{d.title}</strong> — <RichText text={d.why} /></li>)}
          </ul>
          <div style={{ fontSize: 11, color: 'var(--nav-inactive-color)', marginTop: 6 }}>If one of these is really the same impact, consider going back rather than adding a duplicate.</div>
        </div>
      )}
      {drift.length === 0 && dupes.length === 0 && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', fontSize: 12, color: '#15803d' }}>
          ✓ Checks out against your source, and no obvious duplicates in the library.
        </div>
      )}

      <ListEditor label="Answers (AI-refreshed — edit freely)" items={draft.answers} onChange={(v) => setDraft((d) => ({ ...d, answers: v }))} placeholder="" />
      <ListEditor label="Tags (AI-refreshed)" items={draft.tags} onChange={(v) => setDraft((d) => ({ ...d, tags: v }))} placeholder="" />

      {/* Credit toggle */}
      <div style={{ marginTop: 6, marginBottom: 18, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
        <Label>Attribution</Label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink)' }}>
          <input type="checkbox" checked={!anonymous} onChange={(e) => setAnonymous(!e.target.checked)} />
          Credit me by name (uses your chat display name)
        </label>
        <div style={{ fontSize: 11, color: 'var(--nav-inactive-color)', marginTop: 5 }}>
          Off by default — your contribution shows as “Anonymous” unless you opt in.
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={onBack} className="btn" style={{ fontSize: 13, padding: '9px 18px' }}>Back</button>
        <button onClick={onSubmit} disabled={busy} className="btn-primary" style={{ fontSize: 13, padding: '9px 22px' }}>
          {busy ? 'Submitting…' : 'Add to library'}
        </button>
      </div>
    </div>
  );
}
