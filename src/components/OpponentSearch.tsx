import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../store/appStore';
import { Opponent, Judge } from '../types';
import { Dots } from './Spinner';

// Compute the current debate season year suffix (e.g. 25 for 2025-26).
// Sep–Dec → current year; Jan–Aug → previous year.
function seasonYearSuffix(): string {
  const now = new Date();
  const yr = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return yr.toString().slice(-2);
}

const YR = seasonYearSuffix(); // e.g. "25"

const FALLBACK_CASELISTS = [
  { value: `hspolicy${YR}`, label: 'HS Policy (NDCA)' },
  { value: `ndtceda${YR}`, label: 'NDT/CEDA' },
  { value: `hsld${YR}`, label: 'HS LD' },
  { value: `hspf${YR}`, label: 'HS PF' },
];

const CASELIST_LABEL_MAP: Record<string, string> = {
  hspolicy: 'HS Policy (NDCA)',
  ndtceda: 'NDT/CEDA',
  hsld: 'HS LD',
  hspf: 'HS PF',
  nfald: 'NFA LD',
  college: 'College Policy',
};

function labelForCaselist(name: string): string {
  const base = name.replace(/\d+$/, '');
  return CASELIST_LABEL_MAP[base] ?? name;
}

function isRelevantCaselist(name: string): boolean {
  const base = name.replace(/\d+$/, '');
  return base in CASELIST_LABEL_MAP;
}

function isAuthError(err: string) {
  return err.includes('AUTH_REQUIRED') || err.includes('401') || err.includes('Unauthorized') || err.includes('403');
}

interface SearchHit {
  caselist: string; school: string; team: string; displayName: string; [k: string]: any;
}

interface JudgeHit {
  personId: string;
  name: string;
  institution: string;
}

function shardMatchesEvent(shardValue: string, ev: 'policy' | 'pf' | 'ld'): boolean {
  const base = shardValue.replace(/\d+$/, '');
  if (ev === 'pf') return base === 'hspf';
  if (ev === 'ld') return base === 'hsld' || base === 'nfald';
  return base === 'hspolicy' || base === 'ndtceda';
}

function eventForShard(shardValue: string): 'policy' | 'pf' | 'ld' | null {
  const base = shardValue.replace(/\d+$/, '');
  if (base === 'hspf') return 'pf';
  if (base === 'hsld' || base === 'nfald') return 'ld';
  if (base === 'hspolicy' || base === 'ndtceda') return 'policy';
  return null;
}

// ─── Opponents tab ────────────────────────────────────────────────────────────

function OpponentsTab() {
  const { db, update, setView, event, setEvent } = useApp();
  const [query, setQuery] = useState('');
  const [caselists, setCaselists] = useState(FALLBACK_CASELISTS);
  const [shard, setShard] = useState(() => {
    const match = FALLBACK_CASELISTS.find((c) => shardMatchesEvent(c.value, event));
    return match?.value ?? FALLBACK_CASELISTS[0].value;
  });
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);
  const [error, setError] = useState('');
  const opponents = Object.values(db.opponents);

  useEffect(() => {
    const match = caselists.find((c) => shardMatchesEvent(c.value, event));
    if (match) setShard(match.value);
  }, [event, caselists]);

  useEffect(() => {
    window.warroom.opencaselist.caselists().then((res: any) => {
      if (!res.ok) return;
      const list: any[] = res.data ?? [];
      const relevant = list
        .filter((c: any) => isRelevantCaselist(c.name ?? ''))
        .sort((a: any, b: any) => {
          const aYear = parseInt((a.name ?? '').match(/(\d+)$/)?.[1] ?? '0');
          const bYear = parseInt((b.name ?? '').match(/(\d+)$/)?.[1] ?? '0');
          return bYear - aYear;
        });
      if (relevant.length === 0) return;
      const seen = new Set<string>();
      const deduped = relevant.filter((c: any) => {
        const base = (c.name ?? '').replace(/\d+$/, '');
        if (seen.has(base)) return false;
        seen.add(base);
        return true;
      });
      const mapped = deduped.map((c: any) => ({ value: c.name, label: labelForCaselist(c.name) }));
      setCaselists(mapped);
      setShard(mapped[0].value);
    }).catch(() => { /* stay with fallback */ });
  }, []);

  async function search() {
    if (!query.trim()) return;
    setLoading(true); setError(''); setResults([]);
    try {
      const res = await window.warroom.opencaselist.search(query.trim(), shard);
      if (!res.ok) {
        if (isAuthError(res.error ?? '')) {
          setError('OpenCaselist requires login — go to Settings and enter your opencaselist.com credentials.');
        } else {
          setError(`Search failed: ${res.error ?? 'unknown error'}. Make sure you are logged in via Settings.`);
        }
        return;
      }
      const data = res.data;
      const list: any[] = Array.isArray(data)
        ? data
        : data?.teams ?? data?.results ?? data?.data ?? [];
      const hits: SearchHit[] = list.map((r: any, i: number) => {
        const school = r.school ?? r.schoolSlug ?? r.schoolName ?? r.name ?? '';
        const team = r.team ?? r.teamSlug ?? r.teamName ?? r.code ?? r.teamSlug ?? '';
        const display = r.displayName ?? r.name ?? ([school, team].filter(Boolean).join(' ') || `Result ${i + 1}`);
        return { caselist: r.caselist ?? r.caselistSlug ?? shard, school: school || display, team: team || school || display, displayName: display, ...r };
      }).filter((h) => h.displayName);
      setResults(hits);
      if (hits.length === 0) {
        setError('No teams found matching that school name. Try a shorter search term or check your OpenCaselist credentials in Settings.');
      }
    } catch (e: any) {
      setError(`Unexpected error: ${e?.message ?? e}`);
    } finally { setLoading(false); }
  }

  function savedFor(hit: SearchHit): Opponent | undefined {
    return Object.values(db.opponents).find(
      (o) => o.teamId === hit.team || (o.school === hit.school && o.teamName === hit.displayName)
    );
  }

  async function toggleStar(hit: SearchHit) {
    const existing = savedFor(hit);
    if (existing) {
      await update((db) => {
        const { [existing.id]: _removed, ...rest } = db.opponents;
        return { ...db, opponents: rest };
      });
    } else {
      const id = crypto.randomUUID();
      const opp: Opponent = {
        id, teamId: hit.team, teamName: hit.displayName, school: hit.school,
        notes: '', disclosures: {}, roundsAgainst: [],
      };
      await update((db) => ({ ...db, opponents: { ...db.opponents, [id]: opp } }));
    }
  }

  async function pullTeam(hit: SearchHit) {
    setPulling(hit.team); setError('');
    try {
      const [roundsRes, citesRes] = await Promise.all([
        window.warroom.opencaselist.rounds(hit.caselist, hit.school, hit.team),
        window.warroom.opencaselist.cites(hit.caselist, hit.school, hit.team),
      ]);

      if (!roundsRes.ok && isAuthError(roundsRes.error ?? '')) {
        setError('OpenCaselist requires login — go to Settings.');
        return;
      }

      const rounds: any[] = roundsRes.ok
        ? (Array.isArray(roundsRes.data) ? roundsRes.data : roundsRes.data?.rounds ?? [])
        : [];
      const cites: any[] = citesRes.ok
        ? (Array.isArray(citesRes.data) ? citesRes.data : citesRes.data?.cites ?? [])
        : [];

      const affCites = cites.filter((c: any) => (c.side ?? '').toLowerCase().startsWith('a'));
      const negCites = cites.filter((c: any) => (c.side ?? '').toLowerCase().startsWith('n'));
      const affRounds = rounds.filter((r: any) => (r.side ?? '').toLowerCase().startsWith('a'));
      const negRoundNames = Array.from(new Set(
        rounds
          .filter((r: any) => (r.side ?? '').toLowerCase().startsWith('n'))
          .map((r: any) => r.position ?? r.report ?? '')
          .filter(Boolean)
      ));

      const aff = affCites.length
        ? { name: affCites[0].title ?? affCites[0].cites?.slice(0, 100) ?? 'Aff' }
        : affRounds.length ? { name: 'Aff' } : undefined;
      const neg = affCites.length || negCites.length
        ? Array.from(new Set(negCites.map((c: any) => c.title ?? c.cites?.slice(0, 100) ?? '').filter(Boolean)))
            .map((name) => ({ name: String(name).slice(0, 200) }))
        : negRoundNames.map((name) => ({ name: String(name).slice(0, 200) }));

      const existing = Object.values(db.opponents).find(
        (o) => o.teamId === hit.team || (o.school === hit.school && o.teamName === hit.displayName)
      );
      const id = existing?.id ?? crypto.randomUUID();
      const opp: Opponent = {
        id, teamId: hit.team, teamName: hit.displayName, school: hit.school,
        caselist: hit.caselist,
        notes: existing?.notes ?? '',
        disclosures: {
          pulledAt: new Date().toISOString(),
          roundsDisclosed: rounds.length,
          aff, neg,
          rawRounds: rounds.slice(0, 200),
          rawCites: cites.slice(0, 200),
        },
        roundsAgainst: existing?.roundsAgainst ?? [],
      };
      await update((db) => ({ ...db, opponents: { ...db.opponents, [id]: opp } }));
      setView({ kind: 'opponent', opponentId: id });
    } catch (e: any) {
      setError(`Pull failed: ${e?.message ?? e}`);
    } finally { setPulling(null); }
  }

  return (
    <>
      <div className="px-4 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex gap-2">
          <select
            className="input w-40"
            value={shard}
            onChange={(e) => {
              const v = e.target.value;
              setShard(v);
              const ev = eventForShard(v);
              if (ev) setEvent(ev);
            }}
          >
            {caselists.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input
            className="input flex-1"
            placeholder="Search by school or team name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <button className="btn-primary" onClick={search} disabled={loading}>
            {loading ? <Dots /> : 'Search'}
          </button>
        </div>
        {error && (
          <div className="mt-2 text-xs flex items-start gap-1.5 text-danger">
            <span className="shrink-0 mt-0.5">⚠</span>
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin">
        {results.length > 0 && (
          <div className="p-4">
            <div className="label mb-2">Results ({results.length})</div>
            <div className="space-y-1">
              {results.map((r, i) => {
                const starred = !!savedFor(r);
                return (
                  <div key={i} className="glass-card rounded-sm flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => toggleStar(r)}
                        title={starred ? 'Remove from sidebar' : 'Add to sidebar'}
                        className="shrink-0 transition"
                        style={{ color: starred ? '#f59e0b' : 'var(--label-color)', fontSize: 16, lineHeight: 1 }}
                        onMouseEnter={(e) => { if (!starred) (e.currentTarget as HTMLButtonElement).style.color = '#f59e0b'; }}
                        onMouseLeave={(e) => { if (!starred) (e.currentTarget as HTMLButtonElement).style.color = 'var(--label-color)'; }}
                      >
                        {starred ? '★' : '☆'}
                      </button>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink truncate">{r.displayName}</div>
                        <div className="text-xs truncate text-ink/45">{r.school} · {r.caselist}</div>
                      </div>
                    </div>
                    <button className="btn text-xs shrink-0 ml-2" onClick={() => pullTeam(r)} disabled={pulling === r.team}>
                      {pulling === r.team ? <Dots /> : 'Pull disclosure'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="p-4">
          <div className="label mb-2">Saved opponents ({opponents.length})</div>
          {opponents.length === 0 ? (
            <div className="text-sm italic text-ink/35">No opponents saved yet.</div>
          ) : (
            <div className="space-y-1">
              {opponents.map((o) => (
                <div key={o.id} className="glass-card rounded-sm flex items-center px-3 py-2 hover:shadow-sm transition">
                  <button
                    onClick={() => update((db) => {
                      const { [o.id]: _removed, ...rest } = db.opponents;
                      return { ...db, opponents: rest };
                    })}
                    title="Remove from sidebar"
                    className="shrink-0 mr-2 transition"
                    style={{ color: '#f59e0b', fontSize: 16, lineHeight: 1 }}
                    onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.color = '#d97706'}
                    onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.color = '#f59e0b'}
                  >
                    ★
                  </button>
                  <button
                    onClick={() => setView({ kind: 'opponent', opponentId: o.id })}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="text-sm font-medium text-ink truncate">{o.teamName}</div>
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-xs text-ink/45">{o.school}</span>
                      {(o.disclosures as any)?.roundsDisclosed != null && (
                        <span className="text-xs text-ink/35">
                          {(o.disclosures as any).roundsDisclosed} rounds
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Judges tab ───────────────────────────────────────────────────────────────

import { JudgeRound } from '../types';

const NSDA_RE = /The paradigms published on Tabroom\.com/i;

function JudgeResultRow({ r, savedJudge, onStar, onUnsave }: {
  r: JudgeHit;
  savedJudge?: Judge;
  onStar: () => void;
  onUnsave: () => void;
}) {
  const isSaved = !!savedJudge;
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab]           = useState<'paradigm' | 'record'>('paradigm');
  const [paradigm, setParadigm] = useState<string | null>(() => {
    const p = savedJudge?.paradigm ?? null;
    return NSDA_RE.test(p ?? '') ? null : p;
  });
  const [record, setRecord]     = useState<JudgeRound[]>(savedJudge?.record ?? []);
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState('');
  const didFetchRef             = useRef(false);

  // Fetch paradigm + record on first expand
  useEffect(() => {
    if (!expanded || didFetchRef.current) return;
    didFetchRef.current = true;
    setFetching(true); setFetchErr('');
    window.warroom.tabroom.fetchParadigm(r.personId)
      .then((res: any) => {
        if (res.ok) {
          setParadigm(res.paradigm ?? null);
          setRecord(res.record ?? []);
        } else {
          setFetchErr(res.error ?? 'Failed to fetch');
        }
      })
      .catch((e: any) => setFetchErr(e?.message ?? 'Error'))
      .finally(() => setFetching(false));
  }, [expanded]);

  return (
    <div className="glass-card rounded-sm overflow-hidden">
      {/* Header row */}
      <div className="flex items-center px-3 py-2 cursor-pointer select-none"
        onClick={() => setExpanded((x) => !x)}>
        <button className="shrink-0 mr-2 transition"
          style={{ color: isSaved ? '#f59e0b' : 'var(--label-color)', fontSize: 16, lineHeight: 1 }}
          onClick={(e) => { e.stopPropagation(); isSaved ? onUnsave() : onStar(); }}
          title={isSaved ? 'Remove saved judge' : 'Save judge'}>
          {isSaved ? '★' : '☆'}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-ink truncate">{r.name}</div>
          {r.institution && <div className="text-xs text-ink/45 truncate">{r.institution}</div>}
        </div>
        <span className="ml-2 text-xs text-ink/30 shrink-0">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-white/5">
          {/* Tab bar */}
          <div className="flex gap-1 px-3 pt-2">
            {(['paradigm', 'record'] as const).map((t) => (
              <button key={t} onClick={(e) => { e.stopPropagation(); setTab(t); }}
                className="text-xs px-3 py-1 rounded transition font-medium capitalize"
                style={{
                  background: tab === t ? 'var(--bg-elevated)' : 'transparent',
                  color: tab === t ? 'var(--ink-color)' : 'var(--label-color)',
                  borderBottom: tab === t ? '2px solid var(--accent-color, #6366f1)' : '2px solid transparent',
                }}>
                {t}
              </button>
            ))}
          </div>

          <div className="px-3 pb-3 pt-2">
            {fetching ? (
              <div className="text-xs text-ink/40 italic flex items-center gap-1"><Dots /> Fetching…</div>
            ) : fetchErr ? (
              <div className="text-xs text-danger">⚠ {fetchErr}</div>
            ) : tab === 'paradigm' ? (
              paradigm
                ? <p className="text-xs text-ink/75 leading-relaxed whitespace-pre-wrap">{paradigm.slice(0, 1200)}{paradigm.length > 1200 ? '…' : ''}</p>
                : <div className="text-xs text-ink/35 italic">No paradigm written yet.</div>
            ) : (
              record.length === 0
                ? <div className="text-xs text-ink/35 italic">No judging record found.</div>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          {['Tournament', 'Date', 'Ev', 'Rd', 'Aff', 'Neg', 'Vote'].map((h) => (
                            <th key={h} className="text-left py-1.5 pr-3 font-medium text-ink/50 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {record.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td className="py-1.5 pr-3 text-ink/75 max-w-[160px] truncate">{row.tournament}</td>
                            <td className="py-1.5 pr-3 text-ink/50 whitespace-nowrap">{row.date}</td>
                            <td className="py-1.5 pr-3 text-ink/60 whitespace-nowrap">{row.event}</td>
                            <td className="py-1.5 pr-3 text-ink/60 whitespace-nowrap">{row.round}</td>
                            <td className="py-1.5 pr-3 text-ink/70 max-w-[100px] truncate">{row.aff}</td>
                            <td className="py-1.5 pr-3 text-ink/70 max-w-[100px] truncate">{row.neg}</td>
                            <td className="py-1.5 pr-3 font-medium whitespace-nowrap"
                              style={{ color: row.vote?.toLowerCase().startsWith('a') ? '#34d399' : row.vote?.toLowerCase().startsWith('n') ? '#f87171' : 'var(--ink-color)' }}>
                              {row.vote}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function JudgesTab() {
  const { db, update, setView } = useApp();
  const [query, setQuery]   = useState('');
  const [results, setResults] = useState<JudgeHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const judges = Object.values(db.judges ?? {});

  function savedJudgeFor(hit: JudgeHit): Judge | undefined {
    return judges.find((j) => j.personId === hit.personId);
  }

  async function search() {
    if (!query.trim()) return;
    setLoading(true); setError(''); setResults([]);
    try {
      const res = await window.warroom.tabroom.searchJudges(query.trim());
      if (!res.ok) { setError(res.error ?? 'Search failed'); return; }
      const hits = res.results ?? [];
      setResults(hits);
      if (hits.length === 0) setError('No judges found. Make sure your Tabroom credentials are saved in Settings.');
    } catch (e: any) {
      setError(`Unexpected error: ${e?.message ?? e}`);
    } finally { setLoading(false); }
  }

  async function starJudge(hit: JudgeHit) {
    const id = crypto.randomUUID();
    const judge: Judge = {
      id, personId: hit.personId, name: hit.name, institution: hit.institution,
      paradigm: null, notes: '',
      tabroomUrl: `https://www.tabroom.com/index/paradigm.mhtml?judge_person_id=${hit.personId}`,
      savedAt: new Date().toISOString(), paradigmFetchedAt: null,
    };
    await update((db) => ({ ...db, judges: { ...(db.judges ?? {}), [id]: judge } }));
  }

  async function unsaveJudge(hit: JudgeHit) {
    const existing = savedJudgeFor(hit);
    if (!existing) return;
    await update((db) => {
      const { [existing.id]: _r, ...rest } = db.judges ?? {};
      return { ...db, judges: rest };
    });
    if (setView && (db as any)?.view?.kind === 'judge' && (db as any)?.view?.judgeId === existing.id) {
      setView({ kind: 'opponents' });
    }
  }

  return (
    <>
      <div className="px-4 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Search judge by name…"
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()} />
          <button className="btn-primary" onClick={search} disabled={loading}>
            {loading ? <Dots /> : 'Search'}
          </button>
        </div>
        {error && (
          <div className="mt-2 text-xs flex items-start gap-1.5 text-danger">
            <span className="shrink-0 mt-0.5">⚠</span><span>{error}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin">
        {results.length > 0 && (
          <div className="p-4">
            <div className="label mb-2">Results ({results.length}) — click to expand paradigm</div>
            <div className="space-y-1">
              {results.map((r) => (
                <JudgeResultRow key={r.personId} r={r} savedJudge={savedJudgeFor(r)}
                  onStar={() => starJudge(r)}
                  onUnsave={() => unsaveJudge(r)} />
              ))}
            </div>
          </div>
        )}

        <div className="p-4">
          <div className="label mb-2">Saved judges ({judges.length})</div>
          {judges.length === 0 ? (
            <div className="text-sm italic text-ink/35">No judges saved yet.</div>
          ) : (
            <div className="space-y-1">
              {judges.map((j) => (
                <div key={j.id} className="glass-card rounded-sm flex items-center px-3 py-2 hover:shadow-sm transition">
                  <button onClick={() => update((db) => { const { [j.id]: _r, ...rest } = db.judges ?? {}; return { ...db, judges: rest }; })}
                    title="Remove saved judge" className="shrink-0 mr-2 transition"
                    style={{ color: '#f59e0b', fontSize: 16, lineHeight: 1 }}
                    onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.color = '#d97706'}
                    onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.color = '#f59e0b'}>★</button>
                  <button onClick={() => setView({ kind: 'judge', judgeId: j.id })} className="flex-1 text-left min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{j.name}</div>
                    <div className="flex gap-3 mt-0.5">
                      {j.institution && <span className="text-xs text-ink/45 truncate">{j.institution}</span>}
                      <span className="text-xs text-ink/30">{j.paradigm && !NSDA_RE.test(j.paradigm) ? 'Has paradigm' : 'No paradigm'}</span>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Main container with tab switcher ────────────────────────────────────────

type Tab = 'opponents' | 'judges';

export default function OpponentSearch() {
  const [tab, setTab] = useState<Tab>('opponents');

  return (
    <div className="flex flex-col h-full">
      {/* Header + tab switcher */}
      <div
        className="px-6 py-4 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
        }}
      >
        <h1 className="text-lg font-semibold mb-3 text-ink">Scouting</h1>
        <div className="flex gap-1 p-0.5 rounded-md" style={{ background: 'var(--bg-sunken)', width: 'fit-content' }}>
          {(['opponents', 'judges'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="text-sm px-4 py-1 rounded transition font-medium capitalize"
              style={{
                background: tab === t ? 'var(--bg-elevated)' : 'transparent',
                color: tab === t ? 'var(--ink-color)' : 'var(--label-color)',
                boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content — fills remaining height */}
      <div className="flex flex-col flex-1 min-h-0">
        {tab === 'opponents' ? <OpponentsTab /> : <JudgesTab />}
      </div>
    </div>
  );
}
