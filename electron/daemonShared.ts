// ─────────────────────────────────────────────────────────────────────────────
// daemonShared.ts — pure, side-effect-light helpers shared by the GUI process and
// the headless background daemon (`--daemon`). Intentionally free of any `electron`
// import so it can be unit-tested with plain `node`. Everything operates on an
// explicitly passed-in `dataDir` (= app.getPath('userData')/warroom).
// ─────────────────────────────────────────────────────────────────────────────

import { join } from 'path';
import { promises as fs } from 'fs';

// ─── Runtime file paths ───────────────────────────────────────────────────────
// Daemon coordination files live in a `runtime/` subdir so they never collide with
// the app's own db.json / topics.json / secure_*.json in dataDir.

export function runtimeDir(dataDir: string): string { return join(dataDir, 'runtime'); }
export function heartbeatPath(dataDir: string): string { return join(runtimeDir(dataDir), 'heartbeat.json'); }
export function monitorsPath(dataDir: string): string { return join(runtimeDir(dataDir), 'monitors.json'); }
export function daemonRunsPath(dataDir: string): string { return join(runtimeDir(dataDir), 'daemon-runs.json'); }
export function daemonMetaPath(dataDir: string): string { return join(runtimeDir(dataDir), 'daemon-meta.json'); }
export function daemonLogPath(dataDir: string): string { return join(runtimeDir(dataDir), 'daemon.log'); }

export async function ensureRuntimeDir(dataDir: string): Promise<void> {
  await fs.mkdir(runtimeDir(dataDir), { recursive: true });
}

export async function readJsonFile<T = any>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(p, 'utf-8')) as T; }
  catch (e: any) { if (e?.code === 'ENOENT') return null; throw e; }
}

export async function writeJsonFile(p: string, data: unknown): Promise<void> {
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, p);
}

export async function removeFile(p: string): Promise<void> {
  try { await fs.unlink(p); } catch (e: any) { if (e?.code !== 'ENOENT') throw e; }
}

// ─── Heartbeat / app-liveness ─────────────────────────────────────────────────

export interface Heartbeat { pid: number; ts: number; }

export const HEARTBEAT_FRESH_MS = 60_000;

/**
 * True when the GUI app is currently running. Requires BOTH a fresh timestamp
 * (≤60s old) AND a live pid — so a hard crash that leaves a recent-but-stale
 * heartbeat is still detected as "not alive" within the freshness window,
 * letting the daemon take over quickly.
 *
 * process.kill(pid, 0) throws ESRCH when the process is gone and EPERM when the
 * process exists but is owned by another user — for our purposes EPERM == alive.
 */
export function isAppAlive(hb: Heartbeat | null, now: number = Date.now()): boolean {
  if (!hb || typeof hb.pid !== 'number' || typeof hb.ts !== 'number') return false;
  if (now - hb.ts > HEARTBEAT_FRESH_MS) return false;
  if (hb.pid <= 0) return false;
  try { process.kill(hb.pid, 0); return true; }
  catch (e: any) { return e?.code === 'EPERM'; }
}

// ─── Periodic-check cadence gating ────────────────────────────────────────────
// Persisted so a 10-min interval spawn doesn't re-run 4-hour checks every time.
// Both the GUI app and the daemon update these, so whoever ran last "satisfies"
// the cadence for the other.

export type RunMap = Record<string, number>;

export const CADENCE = {
  judges: 4 * 60 * 60 * 1000,    // 4h
  opponents: 4 * 60 * 60 * 1000, // 4h
  topics: 30 * 60 * 1000,        // 30m (further gated by topicSchedule)
} as const;

export function dueForCheck(runs: RunMap | null, key: string, cadenceMs: number, now: number = Date.now()): boolean {
  const last = runs?.[key] ?? 0;
  return now - last >= cadenceMs;
}

export function markRun(runs: RunMap | null, key: string, now: number = Date.now()): RunMap {
  return { ...(runs ?? {}), [key]: now };
}

// ─── Active-monitor expiry ────────────────────────────────────────────────────

export const MONITOR_TTL_MS = 18 * 60 * 60 * 1000; // a long tournament day

export function monitorExpired(startedAt: string | number | null | undefined, now: number = Date.now()): boolean {
  if (startedAt == null) return true;
  const t = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
  if (Number.isNaN(t)) return true;
  return now - t > MONITOR_TTL_MS;
}

// ─── Persisted monitor state (monitors.json) ──────────────────────────────────

export interface PersistedMonitorCfg {
  dbTournamentId: string;
  tabroomTournId: string;
  tournamentName: string;
  eventName: string;
  entryCode: string;
  caselist: string;
  eventType: string;
}

export interface PersistedInboxCfg {
  entryCode: string;
  dbTournamentId: string;
  tournamentName: string;
}

export interface MonitorsState {
  monitor: PersistedMonitorCfg | null;
  inbox: PersistedInboxCfg | null;
  seenRoundIds: string[];
  seenInboxKeys: string[];
  startedAt: number | null;
}

export function emptyMonitorsState(): MonitorsState {
  return { monitor: null, inbox: null, seenRoundIds: [], seenInboxKeys: [], startedAt: null };
}

/** Is there an active, non-expired monitor or inbox worth running a resident loop for? */
export function hasActiveMonitor(s: MonitorsState | null, now: number = Date.now()): boolean {
  if (!s) return false;
  if (!s.monitor && !s.inbox) return false;
  return !monitorExpired(s.startedAt, now);
}

// ─── Shared dedup-set merge ───────────────────────────────────────────────────

const SEEN_CAP = 2000;

export function mergeSeen(existing: string[] | null | undefined, add: string[]): string[] {
  const set = new Set(existing ?? []);
  for (const x of add) set.add(x);
  const arr = Array.from(set);
  return arr.length > SEEN_CAP ? arr.slice(arr.length - SEEN_CAP) : arr;
}

// ─── Deep links (warroom://) ──────────────────────────────────────────────────

export type DeepLinkTarget =
  | { kind: 'judge'; id: string }
  | { kind: 'opponent'; id: string }
  | { kind: 'tournament'; id: string; round?: number }
  | { kind: 'topic'; id: 'pf' | 'ld' };

export function buildDeepLink(t: DeepLinkTarget): string {
  switch (t.kind) {
    case 'judge':    return `warroom://open/judge/${encodeURIComponent(t.id)}`;
    case 'opponent': return `warroom://open/opponent/${encodeURIComponent(t.id)}`;
    case 'tournament': {
      const base = `warroom://open/tournament/${encodeURIComponent(t.id)}`;
      return t.round != null ? `${base}?round=${t.round}` : base;
    }
    case 'topic':    return `warroom://topics/${t.id}`;
  }
}

export function parseDeepLink(url: string): DeepLinkTarget | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'warroom:') return null;
  const host = u.hostname;
  const parts = u.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  if (host === 'open') {
    const [kind, id] = parts;
    if (!id) return null;
    if (kind === 'judge')    return { kind: 'judge', id };
    if (kind === 'opponent') return { kind: 'opponent', id };
    if (kind === 'tournament') {
      const r = u.searchParams.get('round');
      const round = r != null && /^\d+$/.test(r) ? parseInt(r, 10) : undefined;
      return { kind: 'tournament', id, round };
    }
    return null;
  }
  if (host === 'topics') {
    const ev = parts[0];
    if (ev === 'pf' || ev === 'ld') return { kind: 'topic', id: ev };
    return null;
  }
  return null;
}

/** First warroom:// arg found in an argv list, or null. Used for cold-start launches. */
export function findDeepLinkArg(argv: string[]): string | null {
  return argv.find((a) => typeof a === 'string' && a.startsWith('warroom://')) ?? null;
}

// ─── launchd LaunchAgent plist ────────────────────────────────────────────────

export function launchAgentPath(home: string, label: string): string {
  return join(home, 'Library', 'LaunchAgents', `${label}.plist`);
}

export interface PlistOpts {
  label: string;
  execPath: string;
  args?: string[];
  interval?: number;     // StartInterval seconds
  runAtLoad?: boolean;   // default true
  stdout?: string;
  stderr?: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function launchAgentPlistXml(o: PlistOpts): string {
  const programArgs = [o.execPath, ...(o.args ?? [])];
  const argXml = programArgs.map((a) => `    <string>${escapeXml(a)}</string>`).join('\n');
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${escapeXml(o.label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    argXml,
    '  </array>',
  ];
  if (o.runAtLoad !== false) { lines.push('  <key>RunAtLoad</key>', '  <true/>'); }
  if (o.interval && o.interval > 0) { lines.push('  <key>StartInterval</key>', `  <integer>${Math.floor(o.interval)}</integer>`); }
  if (o.stdout) { lines.push('  <key>StandardOutPath</key>', `  <string>${escapeXml(o.stdout)}</string>`); }
  if (o.stderr) { lines.push('  <key>StandardErrorPath</key>', `  <string>${escapeXml(o.stderr)}</string>`); }
  lines.push('  <key>ProcessType</key>', '  <string>Background</string>');
  lines.push('</dict>', '</plist>');
  return lines.join('\n') + '\n';
}

export interface DaemonMeta {
  installedExecPath?: string;
  installedVersion?: string;
  headsUpShown?: boolean;
}

// ─── Windows Task Scheduler ───────────────────────────────────────────────────
// The Windows analogue of the launchd LaunchAgent. A single scheduled task with a
// LogonTrigger (≈ RunAtLoad) + a Repetition interval (≈ StartInterval). Registered
// via `schtasks /create /xml`. MultipleInstancesPolicy=IgnoreNew mirrors launchd's
// "don't double-spawn while resident". ExecutionTimeLimit=PT0S = no kill timeout.

export const WINDOWS_TASK_NAME = 'WarroomDaemon';

export function taskXmlPath(dataDir: string): string {
  return join(runtimeDir(dataDir), 'warroom-daemon-task.xml');
}

export interface TaskXmlOpts {
  description: string;
  execPath: string;
  args?: string;
  intervalMinutes?: number;
}

export function taskSchedulerXml(o: TaskXmlOpts): string {
  const interval = o.intervalMinutes && o.intervalMinutes > 0 ? `PT${Math.floor(o.intervalMinutes)}M` : null;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>${escapeXml(o.description)}</Description>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
  ];
  if (interval) {
    lines.push(
      '      <Repetition>',
      `        <Interval>${interval}</Interval>`,
      '        <StopAtDurationEnd>false</StopAtDurationEnd>',
      '      </Repetition>',
    );
  }
  lines.push(
    '    </LogonTrigger>',
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>true</Hidden>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <Priority>7</Priority>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${escapeXml(o.execPath)}</Command>`,
    `      <Arguments>${escapeXml(o.args ?? '')}</Arguments>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
  );
  return lines.join('\r\n') + '\r\n';
}
