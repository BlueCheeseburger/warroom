import { autoUpdater } from 'electron-updater';
import type { UpdateInfo, ProgressInfo } from 'electron-updater';
import type { BrowserWindow } from 'electron';

// ── Auto-update, wired through electron-updater's GitHub-releases provider ──
//
// Design: checks are silent and cheap (autoDownload = false) — the user is
// only interrupted once a real update is confirmed available, and even then
// downloading is a separate explicit step (UpdateToast.tsx). Install always
// waits for the user to click "Restart" (autoInstallOnAppQuit still covers
// the case where they just quit normally instead).
//
// macOS caveat: Squirrel.Mac (which electron-updater drives on darwin) can
// only apply an update to a code-signed, notarized app. Unsigned dev/CI
// builds will successfully *detect* updates (checkForUpdates just reads the
// published latest-mac.yml) but downloadUpdate()/quitAndInstall() will throw
// — surfaced to the renderer as a normal 'error' status rather than a crash.
// Nothing else needs to change once the app is signed; it starts working.
export type UpdaterStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

let win: BrowserWindow | null = null;
let lastStatus: UpdaterStatus = { state: 'idle' };
let configured = false;

function send(status: UpdaterStatus) {
  lastStatus = status;
  win?.webContents.send('updater:status', status);
}

export function getLastUpdaterStatus(): UpdaterStatus {
  return lastStatus;
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow;
  if (configured) return;
  configured = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info: UpdateInfo) => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p: ProgressInfo) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => send({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err: Error) => send({ state: 'error', message: err?.message ?? String(err) }));
}

/**
 * Errors are swallowed here (only surfaced via the 'error' status event) so a
 * flaky network, an unpublished dev build, or a missing dev-app-update.yml
 * never disrupts app startup or the periodic timer.
 */
export async function checkForUpdatesQuiet(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (e: any) {
    send({ state: 'error', message: e?.message ?? String(e) });
  }
}

export async function downloadUpdate(): Promise<{ ok: boolean; error?: string }> {
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e: any) {
    const message = e?.message ?? String(e);
    send({ state: 'error', message });
    return { ok: false, error: message };
  }
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours — frequent enough to catch a release same-day, cheap enough to ignore
let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * `shouldCheck` is re-evaluated on every tick (not just once at schedule
 * time) so toggling the "check automatically" Settings switch off mid-session
 * takes effect on the very next tick, not just after a restart.
 */
export function scheduleAutoUpdateChecks(shouldCheck: () => Promise<boolean>): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(async () => {
    if (await shouldCheck()) checkForUpdatesQuiet();
  }, CHECK_INTERVAL_MS);
}

export function stopAutoUpdateChecks(): void {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}
