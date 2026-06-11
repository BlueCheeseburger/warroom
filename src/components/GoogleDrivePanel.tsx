import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { renderAsync } from 'docx-preview';
import * as XLSX from 'xlsx';
import { DriveFile } from '../types';
import gdriveLogo from '../assets/gdrive-logo.png';

// ── Icons ─────────────────────────────────────────────────────────────────────

function IcoBack() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 4L7 10l6 6"/>
    </svg>
  );
}

function IcoRefresh() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10a6 6 0 1 1 1.5 4"/>
      <path d="M4 14v-4H8"/>
    </svg>
  );
}

function IcoSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8.5" r="5.5"/>
      <path d="M13 13l4 4"/>
    </svg>
  );
}

function IcoDriveDoc() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"/>
      <path d="M12 3v4h4"/>
      <path d="M7 11h6M7 13.5h4"/>
    </svg>
  );
}

function IcoDriveSheet() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="14" height="14" rx="1"/>
      <path d="M3 8h14M3 13h14M8 3v14"/>
    </svg>
  );
}

function IcoClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 5l10 10M15 5L5 15"/>
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function isDocx(f: DriveFile) { return f.mimeType === DOCX_MIME; }

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtSize(bytes: string | undefined): string {
  if (!bytes) return '';
  const n = parseInt(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Spreadsheet renderer ──────────────────────────────────────────────────────

function SpreadsheetViewer({ base64 }: { base64: string }) {
  const [activeSheet, setActiveSheet] = useState(0);

  // Parse the workbook exactly once per file (not on every tab switch).
  const parsed = useMemo(() => {
    try {
      const buf = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      return { wb: XLSX.read(buf, { type: 'array' }), error: '' };
    } catch (e: any) {
      return { wb: null as XLSX.WorkBook | null, error: e?.message ?? 'Failed to read spreadsheet' };
    }
  }, [base64]);

  const { wb, error: err } = parsed;
  const sheets = wb?.SheetNames ?? [];

  // Clamp if a previous file had more sheets than this one.
  const safeIdx = activeSheet < sheets.length ? activeSheet : 0;

  const rows = useMemo<(string | number | boolean | null)[][]>(() => {
    if (!wb || !sheets[safeIdx]) return [];
    return XLSX.utils.sheet_to_json(wb.Sheets[sheets[safeIdx]], { header: 1, defval: '' }) as any[][];
  }, [wb, safeIdx]);

  if (err) return <div className="p-8 text-sm" style={{ color: 'var(--danger, #ef4444)' }}>Error: {err}</div>;
  if (!sheets.length) return <div className="p-8 text-sm" style={{ color: 'var(--placeholder)' }}>Empty spreadsheet</div>;

  // Spread (Math.max(...arr)) overflows the call stack on very large sheets — reduce instead.
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 1);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-main)' }}>
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex gap-1 px-4 pt-3 pb-0 overflow-x-auto">
          {sheets.map((s, i) => (
            <button key={s} onClick={() => setActiveSheet(i)}
              className="px-3 py-1.5 text-xs rounded-t-lg font-medium transition shrink-0"
              style={{
                background: i === safeIdx ? 'var(--bg-card, white)' : 'var(--nav-hover-bg)',
                color: i === safeIdx ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
                border: '1px solid var(--border-subtle)',
                borderBottom: i === safeIdx ? '1px solid var(--bg-card, white)' : undefined,
              }}>
              {s}
            </button>
          ))}
        </div>
      )}
      {/* Table */}
      <div className="flex-1 overflow-auto p-4">
        <table className="text-xs border-collapse" style={{ borderColor: 'var(--border-subtle)' }}>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'var(--bg-input, rgba(0,0,0,0.03))' }}>
                {Array.from({ length: colCount }, (_, ci) => (
                  <td key={ci}
                    className="px-2 py-1 border whitespace-pre-wrap"
                    style={{
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--nav-active-color)',
                      maxWidth: 300,
                      fontWeight: ri === 0 ? 600 : undefined,
                    }}>
                    {row[ci] != null ? String(row[ci]) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Word document renderer ────────────────────────────────────────────────────

function WordViewer({ base64 }: { base64: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const buf = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
        if (!cancelled && containerRef.current) {
          await renderAsync(buf as ArrayBuffer, containerRef.current, undefined, {
            inWrapper: false,
            ignoreWidth: true,
            ignoreHeight: true,
            ignoreFonts: false,
          });
        }
      } catch (e: any) {
        if (!cancelled) setErr(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [base64]);

  if (err) return <div className="p-8 text-sm" style={{ color: 'var(--danger, #ef4444)' }}>Error rendering document: {err}</div>;

  return (
    <div className="flex-1 overflow-auto px-8 py-6" style={{ background: 'var(--bg-main)' }}>
      <div ref={containerRef}
        className="docx-container mx-auto"
        style={{ maxWidth: 780, background: 'white', borderRadius: 6, padding: '32px 48px', boxShadow: '0 1px 6px rgba(0,0,0,0.10)', minHeight: 400 }}
      />
    </div>
  );
}

// ── File viewer wrapper ───────────────────────────────────────────────────────

function FileViewer({ file, onBack }: { file: DriveFile; onBack: () => void }) {
  const [base64, setBase64] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(''); setBase64(null);
    window.warroom.gdrive.fetchFile(file.id).then(res => {
      if (cancelled) return;
      if (res.ok && res.base64) setBase64(res.base64);
      else setErr(res.error ?? 'Failed to load file');
      setLoading(false);
    }).catch(e => { if (!cancelled) { setErr(e?.message ?? 'Failed to load file'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [file.id]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-medium transition rounded-lg px-2 py-1.5"
          style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; (e.currentTarget as HTMLElement).style.color = 'var(--nav-active-color)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}>
          <IcoBack />
          Back
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span style={{ color: isDocx(file) ? '#1a73e8' : '#0f9d58' }}>
            {isDocx(file) ? <IcoDriveDoc /> : <IcoDriveSheet />}
          </span>
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--nav-active-color)' }}>
            {file.name}
          </span>
        </div>
      </div>

      {/* Content */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm" style={{ color: 'var(--placeholder)' }}>Loading file…</div>
        </div>
      )}
      {err && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-sm text-center" style={{ color: 'var(--danger, #ef4444)' }}>
            <div className="font-medium mb-1">Failed to load file</div>
            <div className="opacity-70">{err}</div>
          </div>
        </div>
      )}
      {!loading && !err && base64 && (
        isDocx(file)
          ? <WordViewer base64={base64} />
          : <SpreadsheetViewer base64={base64} />
      )}
    </div>
  );
}

// ── Setup panel ───────────────────────────────────────────────────────────────

function SetupPanel({ onConfigured }: { onConfigured: () => void }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setSaving(true);
    await window.warroom.secure.set('gdrive_client_id', clientId.trim());
    await window.warroom.secure.set('gdrive_client_secret', clientSecret.trim());
    setSaving(false); setSaved(true);
    setTimeout(onConfigured, 600);
  }

  return (
    <div className="p-8 max-w-lg">
      <div className="label mb-1">Google Drive</div>
      <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--nav-active-color)' }}>Setup required</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--nav-inactive-color)' }}>
        Google Drive requires a free OAuth credential from Google Cloud. One-time setup.
      </p>
      <div className="glass-card rounded-xl p-4 mb-5 text-xs space-y-1.5" style={{ color: 'var(--nav-inactive-color)' }}>
        <div className="font-semibold mb-2" style={{ color: 'var(--nav-active-color)' }}>How to get credentials</div>
        <div>1. Go to <span className="font-medium" style={{ color: 'var(--nav-active-color)' }}>console.cloud.google.com</span></div>
        <div>2. Create a project → enable <span className="font-medium" style={{ color: 'var(--nav-active-color)' }}>Google Drive API</span></div>
        <div>3. Credentials → Create → <span className="font-medium" style={{ color: 'var(--nav-active-color)' }}>OAuth 2.0 Client ID</span> → type: <span className="font-medium" style={{ color: 'var(--nav-active-color)' }}>Desktop app</span></div>
        <div>4. Paste the Client ID and Secret below</div>
      </div>
      <div className="space-y-3">
        <div>
          <div className="label mb-1">Client ID</div>
          <input className="input w-full font-mono text-xs" type="text" placeholder="…apps.googleusercontent.com"
            value={clientId} onChange={e => setClientId(e.target.value)} />
        </div>
        <div>
          <div className="label mb-1">Client Secret</div>
          <input className="input w-full font-mono text-xs" type="password" placeholder="GOCSPX-…"
            value={clientSecret} onChange={e => setClientSecret(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()} />
        </div>
        <button className="btn-primary" onClick={save}
          disabled={saving || !clientId.trim() || !clientSecret.trim()}>
          {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save & continue'}
        </button>
      </div>
    </div>
  );
}

// ── File list ─────────────────────────────────────────────────────────────────

function FileList({
  files, loading, error, onSelect, onRefresh, nextPageToken, onLoadMore, searchQuery, onSearchChange,
}: {
  files: DriveFile[];
  loading: boolean;
  error: string;
  onSelect: (f: DriveFile) => void;
  onRefresh: () => void;
  nextPageToken?: string;
  onLoadMore: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
          <span style={{ color: 'var(--placeholder)' }}><IcoSearch /></span>
          <input
            type="text"
            placeholder="Search files…"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="flex-1 text-xs bg-transparent outline-none"
            style={{ color: 'var(--nav-active-color)' }}
          />
          {searchQuery && (
            <button onClick={() => onSearchChange('')} style={{ color: 'var(--placeholder)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
              <IcoClose />
            </button>
          )}
        </div>
        <button
          onClick={onRefresh}
          title="Refresh"
          className="flex items-center justify-center w-8 h-8 rounded-lg transition"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
          <IcoRefresh />
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto scroll-thin">
        {error && (
          <div className="m-3 px-3 py-2 rounded-lg text-xs" style={{ color: 'var(--danger, #ef4444)', background: 'rgba(239,68,68,0.08)' }}>
            {error}
          </div>
        )}
        {loading && files.length === 0 && (
          <div className="flex items-center justify-center h-24 text-sm" style={{ color: 'var(--placeholder)' }}>
            Loading…
          </div>
        )}
        {!loading && !error && files.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-sm" style={{ color: 'var(--placeholder)' }}>
            <div>{searchQuery ? 'No matching files' : 'No Word docs or spreadsheets found in Drive'}</div>
          </div>
        )}
        {files.map(f => (
          <button
            key={f.id}
            onClick={() => onSelect(f)}
            className="w-full text-left flex items-center gap-3 px-4 py-3 transition"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
            <span style={{ color: isDocx(f) ? '#1a73e8' : '#0f9d58', flexShrink: 0 }}>
              {isDocx(f) ? <IcoDriveDoc /> : <IcoDriveSheet />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: 'var(--nav-active-color)' }}>{f.name}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>
                {fmtDate(f.modifiedTime)}{f.size ? ` · ${fmtSize(f.size)}` : ''}
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--placeholder)', flexShrink: 0 }}>
              <path d="M7 4l6 6-6 6"/>
            </svg>
          </button>
        ))}
        {nextPageToken && !searchQuery && (
          <div className="flex justify-center py-4">
            <button onClick={onLoadMore}
              className="text-xs font-medium px-4 py-2 rounded-lg transition"
              style={{ color: 'var(--nav-inactive-color)', background: 'var(--nav-hover-bg)', border: 'none', cursor: 'pointer' }}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type PanelState = 'checking' | 'no-credentials' | 'not-connected' | 'connecting' | 'browsing';

export default function GoogleDrivePanel() {
  const [panelState, setPanelState] = useState<PanelState>('checking');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [connectErr, setConnectErr] = useState('');
  const [listErr, setListErr] = useState('');
  const [openFile, setOpenFile] = useState<DriveFile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  // Monotonic request id: only the most recently issued list/search request is
  // allowed to apply its results, so a slow search response can't clobber a
  // later clear/refresh (or vice versa).
  const reqIdRef = useRef(0);

  const checkStatus = useCallback(async () => {
    const [clientId, clientSecret, status] = await Promise.all([
      window.warroom.secure.get('gdrive_client_id'),
      window.warroom.secure.get('gdrive_client_secret'),
      window.warroom.gdrive.status(),
    ]);
    if (!clientId || !clientSecret) { setPanelState('no-credentials'); return; }
    if (!status.connected) { setPanelState('not-connected'); return; }
    setPanelState('browsing');
    fetchFiles(true);
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  async function fetchFiles(reset = false) {
    const myId = ++reqIdRef.current;
    setLoadingFiles(true);
    try {
      const res = await window.warroom.gdrive.listFiles(reset ? undefined : nextPageToken);
      if (myId !== reqIdRef.current) return; // superseded by a newer request
      if (!res.ok) {
        if (res.error === 'not_connected') setPanelState('not-connected');
        else setListErr(res.error ?? 'Could not load files');
        return;
      }
      setListErr('');
      setFiles(prev => reset ? (res.files ?? []) : [...prev, ...(res.files ?? [])]);
      setNextPageToken(res.nextPageToken);
    } catch (e: any) {
      if (myId === reqIdRef.current) setListErr(e?.message ?? 'Could not load files');
    } finally {
      if (myId === reqIdRef.current) setLoadingFiles(false);
    }
  }

  async function doSearch(q: string) {
    const myId = ++reqIdRef.current;
    setLoadingFiles(true);
    try {
      const res = await window.warroom.gdrive.searchFiles(q);
      if (myId !== reqIdRef.current) return; // superseded
      if (!res.ok) {
        if (res.error === 'not_connected') setPanelState('not-connected');
        else setListErr(res.error ?? 'Search failed');
        return;
      }
      setListErr('');
      setFiles(res.files ?? []);
      setNextPageToken(undefined);
    } catch (e: any) {
      if (myId === reqIdRef.current) setListErr(e?.message ?? 'Search failed');
    } finally {
      if (myId === reqIdRef.current) setLoadingFiles(false);
    }
  }

  function handleSearchChange(q: string) {
    setSearchQuery(q);
    clearTimeout(searchTimer.current);
    if (!q.trim()) { fetchFiles(true); return; }
    searchTimer.current = setTimeout(() => doSearch(q.trim()), 400);
  }

  async function connect() {
    setPanelState('connecting'); setConnectErr('');
    try {
      const res = await window.warroom.gdrive.connect();
      if (!res.ok) {
        setConnectErr(res.error === 'no_credentials' ? 'No credentials configured.' : (res.error ?? 'Connection failed'));
        setPanelState(res.error === 'no_credentials' ? 'no-credentials' : 'not-connected');
        return;
      }
      setPanelState('browsing');
      fetchFiles(true);
    } catch (e: any) {
      setConnectErr(e?.message ?? 'Connection failed');
      setPanelState('not-connected');
    }
  }

  async function disconnect() {
    try { await window.warroom.gdrive.disconnect(); } catch {}
    setFiles([]); setOpenFile(null); setNextPageToken(undefined); setSearchQuery('');
    setPanelState('not-connected');
  }

  // ── File viewer ──
  if (openFile) {
    return <FileViewer file={openFile} onBack={() => setOpenFile(null)} />;
  }

  // ── States ──
  if (panelState === 'checking') {
    return (
      <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--placeholder)' }}>
        Checking connection…
      </div>
    );
  }

  if (panelState === 'no-credentials') {
    return <SetupPanel onConfigured={checkStatus} />;
  }

  if (panelState === 'not-connected' || panelState === 'connecting') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <img src={gdriveLogo} width="48" height="48" alt="Google Drive" />
        <div className="text-center">
          <div className="text-base font-semibold mb-1" style={{ color: 'var(--nav-active-color)' }}>Connect to Google Drive</div>
          <p className="text-sm" style={{ color: 'var(--nav-inactive-color)' }}>
            Access your Word docs and spreadsheets directly in Warroom.
          </p>
        </div>
        {connectErr && (
          <div className="text-xs text-center px-4 py-2 rounded-lg" style={{ color: 'var(--danger, #ef4444)', background: 'rgba(239,68,68,0.08)' }}>
            {connectErr}
          </div>
        )}
        <div className="flex flex-col items-center gap-2">
          <button className="btn-primary" onClick={connect} disabled={panelState === 'connecting'}>
            {panelState === 'connecting' ? 'Opening browser…' : 'Connect Google Drive'}
          </button>
          {panelState === 'connecting' && (
            <p className="text-xs text-center" style={{ color: 'var(--placeholder)' }}>
              Complete sign-in in your browser, then return here.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <img src={gdriveLogo} width="20" height="20" alt="Google Drive" />
          <span className="text-sm font-semibold" style={{ color: 'var(--nav-active-color)' }}>Google Drive</span>
        </div>
        <button
          onClick={disconnect}
          className="text-xs transition px-2 py-1 rounded"
          style={{ color: 'var(--nav-inactive-color)', background: 'none', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--danger, #ef4444)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}>
          Disconnect
        </button>
      </div>

      <FileList
        files={files}
        loading={loadingFiles}
        error={listErr}
        onSelect={setOpenFile}
        onRefresh={() => { setSearchQuery(''); setListErr(''); fetchFiles(true); }}
        nextPageToken={nextPageToken}
        onLoadMore={() => fetchFiles(false)}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
      />
    </div>
  );
}
