import React, { useEffect, useState } from 'react';
import type { UpdaterStatus } from '../types';

// Surfaces electron-updater's status (see electron/updater.ts) as a small,
// dismissible corner toast — the same visual slot/style as AiErrorToast, but
// mounted separately since the two are unrelated concerns. Silent by design
// for 'checking' / 'not-available' / 'error': a background update check
// failing (offline, dev build, unsigned mac build) is not something the user
// needs interrupted for. Only 'available' → 'downloading' → 'downloaded'
// produce visible UI, because those are the states where the user has an
// actual decision to make (download now? restart now?).
const DISMISSED_KEY = 'warroom-update-dismissed-version';

export default function UpdateToast() {
  const [status, setStatus] = useState<UpdaterStatus>({ state: 'idle' });
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(
    () => localStorage.getItem(DISMISSED_KEY),
  );

  useEffect(() => {
    window.warroom?.updater?.getStatus().then((s) => s && setStatus(s));
    const off = window.warroom?.updater?.onStatus((s) => setStatus(s));
    return () => off?.();
  }, []);

  async function download() {
    setStatus({ state: 'downloading', percent: 0 });
    await window.warroom?.updater.download();
  }

  function dismiss(version: string) {
    localStorage.setItem(DISMISSED_KEY, version);
    setDismissedVersion(version);
  }

  if (status.state === 'available' && status.version === dismissedVersion) return null;
  if (status.state !== 'available' && status.state !== 'downloading' && status.state !== 'downloaded') return null;

  return (
    <div
      style={{
        position: 'fixed', bottom: 16, right: 16,
        zIndex: 9998, pointerEvents: 'none',
      }}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-med)',
          borderLeft: '2px solid #4285F4',
          borderRadius: 8,
          padding: '10px 12px',
          width: 280,
          boxShadow: '0 2px 12px rgba(0,0,0,0.28)',
          fontSize: 12, lineHeight: 1.4,
          color: 'rgb(var(--ink-rgb))',
          pointerEvents: 'auto',
        }}
      >
        {status.state === 'available' && (
          <>
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="font-medium">Warroom {status.version} is available</span>
              <button
                onClick={() => dismiss(status.version)}
                className="text-ink/40 hover:text-ink shrink-0"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
                aria-label="Dismiss"
              >✕</button>
            </div>
            <button className="btn-primary w-full py-1.5 text-xs" onClick={download}>
              Download update
            </button>
          </>
        )}

        {status.state === 'downloading' && (
          <>
            <div className="font-medium mb-2">Downloading update…</div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-med)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${status.percent}%`, background: '#4285F4' }}
              />
            </div>
          </>
        )}

        {status.state === 'downloaded' && (
          <>
            <div className="font-medium mb-2">Warroom {status.version} is ready to install</div>
            <button className="btn-primary w-full py-1.5 text-xs" onClick={() => window.warroom.updater.install()}>
              Restart & update
            </button>
          </>
        )}
      </div>
    </div>
  );
}
