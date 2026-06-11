import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../store/appStore';
import { Judge, JudgeRound } from '../types';
import { Dots } from './Spinner';
import SharedNotesEditor from './SharedNotesEditor';

const NSDA_RE = /The paradigms published on Tabroom\.com/i;
const isBoilerplate = (p: string | null) => !!p && NSDA_RE.test(p);

type TabKind = 'paradigm' | 'record';

export default function JudgeProfile() {
  const { db, update, view, setView } = useApp();

  const isSaved = (view as any).kind === 'judge';
  const judgeId: string | undefined = isSaved ? (view as any).judgeId : undefined;
  const savedJudge: Judge | undefined = judgeId ? db.judges?.[judgeId] : undefined;

  const previewPersonId: string    = isSaved ? '' : (view as any).personId ?? '';
  const previewName: string        = isSaved ? '' : (view as any).name ?? '';
  const previewInstitution: string = isSaved ? '' : (view as any).institution ?? '';

  const personId         = savedJudge?.personId ?? previewPersonId;
  const judgeName        = savedJudge?.name ?? previewName;
  const judgeInstitution = savedJudge?.institution ?? previewInstitution;
  const tabroomUrl       = savedJudge?.tabroomUrl
    ?? `https://www.tabroom.com/index/paradigm.mhtml?judge_person_id=${personId}`;

  const rawSavedParadigm = savedJudge?.paradigm ?? null;
  const initialParadigm  = isBoilerplate(rawSavedParadigm) ? null : rawSavedParadigm;

  const [tab, setTab]               = useState<TabKind>('paradigm');
  const [notes, setNotes]           = useState(savedJudge?.notes ?? '');
  const [paradigm, setParadigm]     = useState<string | null>(initialParadigm);
  const [record, setRecord]         = useState<JudgeRound[]>(savedJudge?.record ?? []);
  const [fetchedAt, setFetchedAt]   = useState<string | null>(
    isBoilerplate(rawSavedParadigm) ? null : (savedJudge?.paradigmFetchedAt ?? null),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [expanded, setExpanded]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didFetch   = useRef(false);

  useEffect(() => {
    const raw   = savedJudge?.paradigm ?? null;
    const clean = isBoilerplate(raw) ? null : raw;
    setNotes(savedJudge?.notes ?? '');
    setParadigm(clean);
    setRecord(savedJudge?.record ?? []);
    setFetchedAt(isBoilerplate(raw) ? null : (savedJudge?.paradigmFetchedAt ?? null));
    setExpanded(false);
    setRefreshError('');
    setTab('paradigm');
    didFetch.current = false;
  }, [judgeId]);

  // Always auto-fetch on first view so paradigm is never stale
  useEffect(() => {
    if (!personId || didFetch.current) return;
    didFetch.current = true;
    doRefresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [judgeId, previewPersonId]);

  if (!personId) {
    return (
      <div className="flex items-center justify-center h-full text-ink/40 text-sm italic">
        Judge not found.
      </div>
    );
  }

  async function doRefresh() {
    setRefreshing(true); setRefreshError('');
    try {
      const res = await window.warroom.tabroom.fetchParadigm(personId);
      if (!res.ok) { setRefreshError(res.error ?? 'Failed to fetch'); return; }
      const newParadigm       = res.paradigm ?? null;
      const newRecord         = (res as any).record ?? [];
      const newFetchedAt      = new Date().toISOString();
      const newLastReviewedAt = (res as any).lastReviewedAt ?? null;
      setParadigm(newParadigm);
      setRecord(newRecord);
      setFetchedAt(newFetchedAt);
      if (judgeId) {
        await update((db) => ({
          ...db,
          judges: {
            ...db.judges,
            [judgeId]: {
              ...db.judges[judgeId],
              paradigm: newParadigm,
              record: newRecord,
              paradigmFetchedAt: newFetchedAt,
              paradigmLastReviewedAt: newLastReviewedAt,
            },
          },
        }));
      }
    } catch (e: any) {
      setRefreshError(e?.message ?? 'Network error');
    } finally { setRefreshing(false); }
  }

  function handleNotesChange(val: string) {
    setNotes(val);
    if (!judgeId) return;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      update((db) => ({
        ...db,
        judges: { ...db.judges, [judgeId]: { ...db.judges[judgeId], notes: val } },
      }));
    }, 600);
  }

  async function saveJudge() {
    if (saving || isSaved) return;
    setSaving(true);
    try {
      const id = crypto.randomUUID();
      const judge: Judge = {
        id, personId, name: judgeName, institution: judgeInstitution,
        paradigm, record, notes, tabroomUrl,
        savedAt: new Date().toISOString(), paradigmFetchedAt: fetchedAt,
      };
      await update((db) => ({ ...db, judges: { ...(db.judges ?? {}), [id]: judge } }));
      setView({ kind: 'judge', judgeId: id });
    } finally { setSaving(false); }
  }

  const PREVIEW_LEN = 600;
  const truncated   = paradigm && paradigm.length > PREVIEW_LEN && !expanded;
  const display     = truncated ? paradigm!.slice(0, PREVIEW_LEN) + '…' : paradigm;

  const fetchedAgo = fetchedAt ? (() => {
    const diff = Date.now() - new Date(fetchedAt).getTime();
    const days = Math.floor(diff / 86400000);
    return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
  })() : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto scroll-thin">
      {/* Header */}
      <div className="px-6 py-4 flex-shrink-0 flex items-center gap-3"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
        <button className="btn text-xs" onClick={() => setView({ kind: 'opponents' })}>← Back</button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-ink truncate">{judgeName}</h1>
          {judgeInstitution && <div className="text-xs text-ink/50 truncate">{judgeInstitution}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isSaved && (
            <button className="btn-primary text-xs" onClick={saveJudge} disabled={saving}>
              {saving ? <Dots /> : '★ Save judge'}
            </button>
          )}
          <button className="btn text-xs" onClick={doRefresh} disabled={refreshing}>
            {refreshing ? <><Dots />&nbsp;Fetching…</> : 'Refresh'}
          </button>
          <a href="#" onClick={(e) => { e.preventDefault(); window.warroom.shell.openExternal(tabroomUrl); }}
            className="text-xs text-accent hover:underline" title="Open on Tabroom">
            Tabroom ↗
          </a>
        </div>
      </div>

      {/* Tab bar */}
      <div className="px-6 pt-3 pb-0 flex gap-1 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {(['paradigm', 'record'] as TabKind[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="text-xs px-4 py-1.5 rounded-t transition font-medium capitalize"
            style={{
              background: tab === t ? 'var(--bg-elevated)' : 'transparent',
              color: tab === t ? 'var(--ink-color)' : 'var(--label-color)',
              borderBottom: tab === t ? '2px solid var(--accent-color, #6366f1)' : '2px solid transparent',
            }}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 p-6 space-y-4 overflow-y-auto scroll-thin">
        {refreshError && (
          <div className="text-xs text-danger flex items-start gap-1">
            <span>⚠</span><span>{refreshError}</span>
          </div>
        )}

        {tab === 'paradigm' && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="label">Paradigm</span>
              {fetchedAgo && <span className="text-xs text-ink/30">fetched {fetchedAgo}</span>}
            </div>
            {paradigm ? (
              <div className="glass-card rounded-md p-4 text-sm text-ink/80 whitespace-pre-wrap leading-relaxed"
                style={{ fontSize: '0.82rem' }}>
                {display}
                {paradigm.length > PREVIEW_LEN && (
                  <button className="mt-2 block text-xs text-accent hover:underline"
                    onClick={() => setExpanded((x) => !x)}>
                    {expanded ? 'Show less' : 'Show full paradigm'}
                  </button>
                )}
              </div>
            ) : refreshing ? (
              <div className="glass-card rounded-md p-4 text-sm text-ink/35 italic flex items-center gap-2">
                <Dots /> Fetching paradigm…
              </div>
            ) : (
              <div className="glass-card rounded-md p-4 text-sm text-ink/35 italic">
                No paradigm written yet.{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); window.warroom.shell.openExternal(tabroomUrl); }}
                  className="text-accent hover:underline not-italic">Check Tabroom ↗</a>
              </div>
            )}

            {isSaved && (
              <div className="mt-4">
                <SharedNotesEditor
                  entityType="judge"
                  entityId={personId}
                  entityName={judgeName}
                  localNotes={notes}
                  onLocalChange={(val) => setNotes(val)}
                  onLocalSave={(val) => handleNotesChange(val)}
                />
              </div>
            )}
          </section>
        )}

        {tab === 'record' && (
          <section>
            <div className="label mb-2">Judging Record ({record.length} rounds)</div>
            {refreshing ? (
              <div className="text-sm text-ink/35 italic flex items-center gap-2"><Dots /> Loading…</div>
            ) : record.length === 0 ? (
              <div className="text-sm text-ink/35 italic">No judging record found.</div>
            ) : (
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
                    {record.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        className="hover:bg-white/5 transition">
                        <td className="py-1.5 pr-3 text-ink/75 max-w-[180px] truncate">{r.tournament}</td>
                        <td className="py-1.5 pr-3 text-ink/50 whitespace-nowrap">{r.date}</td>
                        <td className="py-1.5 pr-3 text-ink/60 whitespace-nowrap">{r.event}</td>
                        <td className="py-1.5 pr-3 text-ink/60 whitespace-nowrap">{r.round}</td>
                        <td className="py-1.5 pr-3 text-ink/70 max-w-[120px] truncate">{r.aff}</td>
                        <td className="py-1.5 pr-3 text-ink/70 max-w-[120px] truncate">{r.neg}</td>
                        <td className="py-1.5 pr-3 font-medium whitespace-nowrap"
                          style={{ color: r.vote?.toLowerCase().startsWith('a') ? '#34d399' : r.vote?.toLowerCase().startsWith('n') ? '#f87171' : 'var(--ink-color)' }}>
                          {r.vote}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
