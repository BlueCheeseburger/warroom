import React, { useState } from 'react';
import { useApp } from '../store/appStore';
import { Tournament } from '../types';
import DatePicker from './DatePicker';
import { Spinner } from './Spinner';

function parseTournId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  // Normalise: add https://www. if the string looks like a bare domain URL
  let normalized = trimmed;
  if (/^tabroom\.com/i.test(normalized)) normalized = 'https://www.' + normalized;
  else if (/^www\.tabroom\.com/i.test(normalized)) normalized = 'https://' + normalized;
  try {
    const url = new URL(normalized);
    return url.searchParams.get('tourn_id') ?? null;
  } catch {
    return null;
  }
}

function defaultEventType(e: string): string {
  if (e === 'pf') return 'PF';
  if (e === 'ld') return 'LD';
  return 'Policy';
}

export default function TournamentList() {
  const { db, update, setView, event } = useApp();
  const tournaments = Object.values(db.tournaments).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const [open, setOpen] = useState(false);
  const [importInput, setImportInput] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [importError, setImportError] = useState('');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');
  const [eventType, setEventType] = useState(() => defaultEventType(event));
  const [tabroomId, setTabroomId] = useState('');

  function resetForm() {
    setOpen(false);
    setImportInput(''); setImportStatus('idle'); setImportError('');
    setName(''); setStartDate(''); setEndDate(''); setLocation('');
    setEventType(defaultEventType(event)); setTabroomId('');
  }

  async function handleImport() {
    const tid = parseTournId(importInput);
    if (!tid) {
      setImportStatus('error');
      setImportError("That doesn't look like a valid Tabroom URL or ID — try something like 12345 or the full Tabroom URL");
      return;
    }
    setImportStatus('loading');
    setImportError('');
    try {
      const res = await window.warroom.tabroom.fetchTournament(tid);
      if (!res.success || !res.tournament) {
        setImportStatus('error');
        setImportError('Could not fetch tournament data — fill in manually');
        return;
      }
      const t = res.tournament;
      // Tabroom returns "YYYY-MM-DD HH:MM:SS" (space) or ISO "YYYY-MM-DDTHH:…" — normalise both.
      const parseDate = (d: string | null) => d ? d.split(/[T ]/)[0] : '';
      const parsedStart = parseDate(t.start);
      // Block past tournaments entirely.
      if (parsedStart) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (new Date(parsedStart) < today) {
          setImportStatus('error');
          setImportError('This tournament has already passed — only upcoming tournaments can be imported');
          return;
        }
      }
      if (t.name) setName(t.name);
      if (parsedStart) setStartDate(parsedStart);
      const parsedEnd = parseDate(t.end);
      if (parsedEnd) setEndDate(parsedEnd);
      const loc = [t.city, t.state].filter(Boolean).join(', ');
      if (loc) setLocation(loc);
      setTabroomId(tid);
      const events: any[] = t.events ?? [];
      const hasPolicy = events.some((e: any) =>
        /policy|cx/i.test(String(e.name ?? '')) || /policy|cx/i.test(String(e.type ?? ''))
      );
      if (hasPolicy) setEventType('Policy');
      setImportStatus('success');
    } catch {
      setImportStatus('error');
      setImportError('Could not fetch tournament data — fill in manually');
    }
  }

  async function create() {
    if (!name.trim() || !startDate) return;
    const id = crypto.randomUUID();
    const t: Tournament = {
      id,
      name: name.trim(),
      date: startDate,
      start: startDate,
      rounds: [],
      ...(endDate ? { end: endDate } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(eventType ? { event_type: eventType } : {}),
      ...(tabroomId.trim() ? { tabroom_id: tabroomId.trim() } : {}),
    };
    await update((db) => ({ ...db, tournaments: { ...db.tournaments, [id]: t } }));
    const newId = id;
    resetForm();
    setView({ kind: 'tournament', tournamentId: newId });
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="label mb-1">Tournaments</div>
      <h1 className="text-lg font-semibold mb-6">All tournaments</h1>

      {tournaments.length === 0 && <div className="text-sm text-ink/40 italic mb-4">No tournaments yet.</div>}

      <div className="space-y-2 mb-4">
        {tournaments.map((t) => (
          <button
            key={t.id}
            onClick={() => setView({ kind: 'tournament', tournamentId: t.id })}
            className="w-full text-left glass-card rounded-sm px-4 py-3 hover:border-ink/30 transition"
          >
            <div className="text-sm font-medium">{t.name}</div>
            <div className="flex gap-3 mt-0.5">
              <span className="text-xs text-ink/50">{t.date ? new Date(t.date + 'T12:00:00').toLocaleDateString() : ''}</span>
              <span className="text-xs text-ink/40">{t.rounds.length} round{t.rounds.length !== 1 ? 's' : ''}</span>
            </div>
          </button>
        ))}
      </div>

      {!open ? (
        <button className="btn" onClick={() => setOpen(true)}>+ New tournament</button>
      ) : (
        <div className="glass-card rounded-sm p-3 space-y-2">
          <div className="label">New tournament</div>

          {/* Import row */}
          <div>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Paste Tabroom URL or tournament ID"
                value={importInput}
                onChange={(e) => { setImportInput(e.target.value); setImportStatus('idle'); setImportError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleImport(); }}
              />
              <button
                className="btn text-xs shrink-0 flex items-center gap-1.5"
                onClick={handleImport}
                disabled={!importInput.trim() || importStatus === 'loading'}
              >
                {importStatus === 'loading' ? (
                  <><Spinner className="w-3 h-3" />Fetching from Tabroom…</>
                ) : (
                  'Import'
                )}
              </button>
            </div>
            {importStatus === 'success' && (
              <div className="text-xs mt-1" style={{ color: '#16a34a' }}>Imported ✓</div>
            )}
            {importStatus === 'error' && importError && (
              <div className="text-xs text-danger mt-1">{importError}</div>
            )}
            <div className="text-xs text-ink/40 mt-1">or fill in manually ↓</div>
          </div>

          {/* Manual fields */}
          <input
            className="input w-full"
            placeholder="Tournament name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <DatePicker value={startDate} onChange={setStartDate} placeholder="Start date" />
          <DatePicker value={endDate} onChange={setEndDate} placeholder="End date (optional)" />
          <input
            className="input w-full"
            placeholder="Location (e.g. Houston, TX)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <select
            className="input w-full"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          >
            <option value="">Event type (optional)</option>
            <option value="Policy">Policy / CX</option>
            <option value="LD">Lincoln-Douglas</option>
            <option value="PF">Public Forum</option>
          </select>

          <div className="flex gap-2">
            <button className="btn-primary" onClick={create} disabled={!name.trim() || !startDate}>Create</button>
            <button className="btn" onClick={resetForm}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
