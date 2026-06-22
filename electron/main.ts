import { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, session, clipboard, Notification as ElectronNotification, net } from 'electron';
import { join, normalize, basename, sep } from 'path';
import { promises as fs, existsSync } from 'fs';
import { execFile, spawn } from 'child_process';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import os from 'os';
import dns from 'dns';
import net2 from 'net';
import Fuse from 'fuse.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import * as DS from './daemonShared';

const isDev = !app.isPackaged;

// ─── Background-daemon mode ────────────────────────────────────────────────────
// The SAME Electron binary, relaunched headless with `--daemon`, runs the
// scouting/topic watchers when the GUI app is closed. `--daemon-once` is a test
// hook that runs the periodic checks a single time (no resident loop) and exits.
const DAEMON_MODE = process.argv.includes('--daemon') || process.argv.includes('--daemon-once');
const DAEMON_ONCE = process.argv.includes('--daemon-once');
const DAEMON_LABEL = 'com.warroom.daemon';

app.setName('Warroom');
// Windows requires an explicit AppUserModelID matching the installer shortcut's
// AUMID for toast notifications (incl. daemon alerts) to display. No-op on macOS.
app.setAppUserModelId('com.warroom.app');

// Resolve icon path for both dev and production. Windows uses a dedicated
// flatter, squarer, full-bleed .ico (resources/icon-win.svg); macOS keeps the PNG.
const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
const iconPath = isDev
  ? join(app.getAppPath(), 'resources', iconFile)
  : join(process.resourcesPath, iconFile);

// macOS: set the dock icon (BrowserWindow's `icon` option is ignored on macOS).
// Guard the load: a missing/unreadable icon must never crash app startup.
try {
  if (existsSync(iconPath)) app.dock?.setIcon(iconPath);
} catch (err) {
  console.error('Failed to set dock icon:', err);
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function dataDir() { return join(app.getPath('userData'), 'warroom'); }
async function ensureDir() { await fs.mkdir(dataDir(), { recursive: true }); }

// ─── Skills helpers ────────────────────────────────────────────────────────────
// Default (bundled) skills: electron/skills/   User skills: userData/warroom/skills/
function userSkillsDir() { return join(dataDir(), 'skills'); }
// __dirname in both dev and prod points to the directory containing main.ts / main.cjs
function bundledSkillsDir() {
  // In dev (not packaged): source lives at <project-root>/electron/skills/
  // In production (packaged): copied to resources/skills/ via electron-builder extraResources
  return isDev
    ? join(app.getAppPath(), 'electron', 'skills')
    : join(process.resourcesPath, 'skills');
}

async function ensureUserSkillsDir() { await fs.mkdir(userSkillsDir(), { recursive: true }); }

/** Returns { name, source } for all available skills (user overrides bundled) */
async function listSkills(): Promise<{ name: string; source: 'user' | 'bundled' }[]> {
  await ensureUserSkillsDir();
  const readDir = async (dir: string, source: 'user' | 'bundled') => {
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({ name: f.replace(/\.md$/, ''), source }));
    } catch { return []; }
  };
  const [bundled, user] = await Promise.all([readDir(bundledSkillsDir(), 'bundled'), readDir(userSkillsDir(), 'user')]);
  // User skills override bundled ones with the same name
  const names = new Set(user.map((s) => s.name));
  return [...user, ...bundled.filter((s) => !names.has(s.name))];
}

/** Read a skill by name — checks user dir first, then bundled */
async function readSkill(name: string): Promise<string | null> {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!safeName) return null;
  const userPath    = join(userSkillsDir(), `${safeName}.md`);
  const bundledPath = join(bundledSkillsDir(), `${safeName}.md`);
  for (const p of [userPath, bundledPath]) {
    try { return await fs.readFile(p, 'utf8'); } catch {}
  }
  return null;
}

/** Builds a system-prompt suffix listing any user-added custom skills by name. */
async function buildCustomSkillsSuffix(): Promise<string> {
  try {
    const skills = await listSkills();
    const custom = skills.filter((s) => s.source === 'user');
    if (custom.length === 0) return '';
    return '\n\n## User skills\n' + custom.map((s) => `There is a user skill named "${s.name}".`).join('\n');
  } catch { return ''; }
}

function safePath(name: string) {
  if (!/^[a-z0-9._-]+$/i.test(name)) throw new Error('invalid file name');
  return join(dataDir(), name);
}

// ─── Trusted path tracking ────────────────────────────────────────────────────
// IPC handlers that read files only accept paths that the main process itself
// handed to the renderer (from a file dialog or an internally-generated temp
// file). This stops a compromised renderer from reading arbitrary disk paths.

const trustedPaths = new Set<string>();

function trustPath(p: string): string {
  trustedPaths.add(normalize(p));
  return p;
}

/** Persist a user-chosen path so it stays trusted across restarts. */
async function persistTrustedPath(p: string): Promise<void> {
  try {
    const existing: string[] = (await readJson('trusted_paths.json')) ?? [];
    const norm = normalize(p);
    if (!existing.includes(norm)) {
      // Keep a generous history so files a user revisits from "recents" stay trusted
      // across restarts and aren't evicted by a handful of later opens.
      await writeJson('trusted_paths.json', [...existing, norm].slice(-1000));
    }
  } catch { /* best-effort */ }
}

/** Load persisted trusted paths back into the in-memory set on startup. */
async function loadPersistedTrustedPaths(): Promise<void> {
  try {
    const saved: string[] = (await readJson('trusted_paths.json')) ?? [];
    saved.forEach((p) => trustedPaths.add(normalize(p)));
  } catch { /* best-effort */ }
}

// True if `child` is `dir` itself or sits inside it — compared on a path-separator
// boundary so `/tmp/warroom` does not also match a sibling like `/tmp/warroom-evil`.
function isInside(dir: string, child: string): boolean {
  const d = normalize(dir).replace(/[\\/]+$/, '');
  const c = normalize(child);
  return c === d || c.startsWith(d + sep);
}

function checkPath(filePath: string): void {
  const norm = normalize(filePath);
  // App-generated temp files are always safe
  if (isInside(join(os.tmpdir(), 'warroom'), norm)) return;
  // Files inside userData (db.json etc.) are always safe
  if (isInside(dataDir(), norm)) return;
  if (trustedPaths.has(norm)) return;
  throw new Error('Access denied: file path was not opened through a dialog');
}

// Reduce a renderer-supplied filename to a single safe path segment: strips any
// directory components (so `../` can't escape the temp dir) and removes shell /
// filesystem metacharacters (so it can't inject into the OS open command).
function safeFilename(name: string, fallback = 'file'): string {
  let base = basename(String(name ?? '')).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!base) return fallback;
  // A name that is only leading dots (".xlsx", "....docx") would lose its extension
  // if we just stripped the dots — keep the extension by giving it a real stem.
  if (/^\.+/.test(base)) base = fallback + base.replace(/^\.+/, '.');
  return base.slice(0, 120) || fallback;
}

// ─── SSRF guard ───────────────────────────────────────────────────────────────
// The agent's fetch_article tool takes a model-supplied URL. Without this guard a
// prompt-injected page could steer it at localhost / LAN / cloud-metadata hosts.
// Only public http(s) destinations are allowed, and every redirect hop is
// re-validated against the resolved IP.

function isPrivateIp(ip: string): boolean {
  const kind = net2.isIP(ip);
  if (kind === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;                          // loopback
    if (p[0] === 0) return true;                            // "this" network
    if (p[0] === 169 && p[1] === 254) return true;          // link-local / metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;             // loopback / unspecified
    if (v.startsWith('fe80')) return true;                  // link-local
    if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique-local
    // IPv4-mapped (::ffff:a.b.c.d)
    const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true; // unknown / unparseable → treat as unsafe
}

async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost') throw new Error('Blocked host');
  // If the host is already a literal IP, check it directly.
  if (net2.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Blocked non-public address');
    return u;
  }
  // Otherwise resolve every address the name maps to and reject if any is private
  // (defends against DNS-rebinding to a public+private multi-record name).
  const addrs = await dns.promises.lookup(host, { all: true }).catch(() => {
    throw new Error('Could not resolve host');
  });
  if (!addrs.length) throw new Error('Could not resolve host');
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('Blocked non-public address');
  return u;
}

// fetch() that re-validates the destination on every redirect hop.
async function safePublicFetch(rawUrl: string, init: RequestInit = {}, maxHops = 5): Promise<Response> {
  let url = rawUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

async function readJson(name: string) {
  await ensureDir();
  try { return JSON.parse(await fs.readFile(safePath(name), 'utf-8')); }
  catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
}

async function writeJson(name: string, data: unknown) {
  await ensureDir();
  const p = safePath(name), tmp = `${p}.${Date.now()}${Math.floor(Math.random() * 1e6)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, p);
}

async function getSecure(key: string): Promise<string | null> {
  const rec = await readJson(`secure_${key}.json`);
  if (!rec?.data) return null;
  if (rec.encrypted === false) {
    // Plaintext fallback (dev mode / encryption unavailable)
    return Buffer.from(rec.data, 'base64').toString('utf-8');
  }
  try { return safeStorage.decryptString(Buffer.from(rec.data, 'base64')); }
  catch { return null; }
}

async function setSecure(key: string, value: string): Promise<void> {
  // In dev, skip safeStorage — its key is tied to the Electron binary and
  // changes on every rebuild, silently destroying previously saved data.
  if (!isDev && safeStorage.isEncryptionAvailable()) {
    await writeJson(`secure_${key}.json`, { data: safeStorage.encryptString(value).toString('base64'), encrypted: true });
  } else {
    await writeJson(`secure_${key}.json`, { data: Buffer.from(value).toString('base64'), encrypted: false });
  }
}

// ─── Background-daemon infrastructure ─────────────────────────────────────────
// Coordination + notification routing shared by the GUI process and the headless
// `--daemon` process. Pure helpers live in electron/daemonShared.ts (imported as DS).

function dlog(...args: any[]) {
  if (DAEMON_MODE) console.log('[Daemon]', ...args);
}

// ── Heartbeat: GUI process writes every 20s, daemon reads to detect "app alive" ──
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function writeHeartbeat() {
  try {
    await DS.ensureRuntimeDir(dataDir());
    await DS.writeJsonFile(DS.heartbeatPath(dataDir()), { pid: process.pid, ts: Date.now() });
  } catch {}
}
function startHeartbeat() {
  writeHeartbeat();
  heartbeatTimer = setInterval(writeHeartbeat, 20_000);
}
async function clearHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  await DS.removeFile(DS.heartbeatPath(dataDir())).catch(() => {});
}
async function appIsAlive(): Promise<boolean> {
  try {
    const hb = await DS.readJsonFile<DS.Heartbeat>(DS.heartbeatPath(dataDir()));
    return DS.isAppAlive(hb);
  } catch { return false; }
}

// ── Cadence run-map (judges / opponents / topics) — both processes update it ──
async function readRuns(): Promise<DS.RunMap> {
  return (await DS.readJsonFile<DS.RunMap>(DS.daemonRunsPath(dataDir())).catch(() => null)) ?? {};
}
async function markRunPersisted(key: string) {
  try {
    await DS.ensureRuntimeDir(dataDir());
    const runs = await readRuns();
    await DS.writeJsonFile(DS.daemonRunsPath(dataDir()), DS.markRun(runs, key));
  } catch {}
}

// ── Persisted monitor state (monitors.json) ──
async function readMonitors(): Promise<DS.MonitorsState> {
  return (await DS.readJsonFile<DS.MonitorsState>(DS.monitorsPath(dataDir())).catch(() => null)) ?? DS.emptyMonitorsState();
}
async function writeMonitors(s: DS.MonitorsState) {
  try {
    await DS.ensureRuntimeDir(dataDir());
    await DS.writeJsonFile(DS.monitorsPath(dataDir()), s);
  } catch {}
}
async function patchMonitors(fn: (s: DS.MonitorsState) => DS.MonitorsState) {
  const s = await readMonitors();
  await writeMonitors(fn(s));
}
// Append ids to the persisted shared seen-set so app↔daemon handoffs never re-notify.
async function persistSeen(kind: 'round' | 'inbox', ids: string[]) {
  if (!ids.length) return;
  try {
    await patchMonitors((s) => {
      if (kind === 'round') s.seenRoundIds = DS.mergeSeen(s.seenRoundIds, ids);
      else s.seenInboxKeys = DS.mergeSeen(s.seenInboxKeys, ids);
      return s;
    });
  } catch {}
}

// ── Notification routing ──
// GUI process: click focuses the window + fires the existing renderer event.
// Daemon: click deep-links back into the app (launching it if closed) by spawning
// the same binary with a warroom:// argv, falling back to shell.openExternal.
interface NotifTarget {
  deepLink: DS.DeepLinkTarget;
  rendererEvent?: { channel: string; payload: any };
}

function openViaDeepLink(target: DS.DeepLinkTarget) {
  const url = DS.buildDeepLink(target);
  // Packaged: spawn the app binary directly with the URL as argv — a fresh GUI
  // instance (no --daemon) that the single-instance handler / cold-start argv scan
  // routes. This sidesteps LaunchServices ambiguity around the headless instance.
  if (app.isPackaged) {
    try {
      spawn(process.execPath, [url], { detached: true, stdio: 'ignore' }).unref();
      return;
    } catch { /* fall through */ }
  }
  // Dev (or spawn failure): let the OS route to the registered protocol client.
  shell.openExternal(url).catch(() => {});
}

function fireNotif(opts: { title: string; body: string; silent?: boolean; target: NotifTarget }) {
  try {
    if (!ElectronNotification.isSupported()) return;
    const n = new ElectronNotification({ title: opts.title, body: opts.body, silent: opts.silent ?? false });
    n.on('click', () => {
      if (DAEMON_MODE) {
        openViaDeepLink(opts.target.deepLink);
      } else {
        mainWin?.show();
        mainWin?.focus();
        if (opts.target.rendererEvent) {
          mainWin?.webContents.send(opts.target.rendererEvent.channel, opts.target.rendererEvent.payload);
        }
      }
    });
    n.show();
  } catch (err) {
    console.warn('[Notif] error:', err);
  }
}

// Status read for a future Settings panel: is the daemon installed, when did each
// watcher last run, is a tournament monitor currently active.
ipcMain.handle('daemon:status', async () => {
  try {
    const meta = await DS.readJsonFile<DS.DaemonMeta>(DS.daemonMetaPath(dataDir())).catch(() => null);
    const runs = await readRuns();
    const monitors = await readMonitors();
    let installed = false;
    if (app.isPackaged) {
      if (process.platform === 'darwin') {
        try { await fs.access(DS.launchAgentPath(app.getPath('home'), DAEMON_LABEL)); installed = true; } catch {}
      } else if (process.platform === 'win32') {
        installed = await new Promise<boolean>((res) =>
          execFile('schtasks', ['/query', '/tn', DS.WINDOWS_TASK_NAME], (err) => res(!err)));
      }
    }
    return {
      ok: true,
      installed,
      installedVersion: meta?.installedVersion ?? null,
      lastRuns: runs,
      activeMonitor: DS.hasActiveMonitor(monitors),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
});

// ─── OpenCaselist session ─────────────────────────────────────────────────────

let ocCookie: string | null = null;
// Cache: base name (e.g. 'hspolicy') → resolved slug (e.g. 'hspolicy25')
let ocShardCache: Record<string, string> = {};

async function ocLogin(username: string, password: string): Promise<void> {
  const res = await fetch('https://api.opencaselist.com/v1/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Login failed (${res.status}): ${body}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) ocCookie = setCookie.split(';')[0];
}

// Resolves a base shard name ('hspolicy') to the actual caselist slug ('hspolicy25')
// by querying GET /caselists and picking the highest-year match.
async function resolveShardName(shard: string): Promise<string> {
  if (ocShardCache[shard]) return ocShardCache[shard];
  try {
    const data = await ocFetch('/caselists');
    const list: any[] = Array.isArray(data) ? data : data?.caselists ?? [];
    let best = shard;
    let bestYear = -1;
    for (const cl of list) {
      const name: string = cl.name ?? cl.slug ?? cl.caselist ?? '';
      if (!name) continue;
      if (name === shard) { best = name; bestYear = Infinity; break; }
      const m = name.match(/^(.+?)(\d{1,4})$/);
      if (m && m[1] === shard) {
        const yr = parseInt(m[2]);
        if (yr > bestYear) { bestYear = yr; best = name; }
      }
    }
    // Cache all resolved names from this call
    for (const cl of list) {
      const name: string = cl.name ?? cl.slug ?? cl.caselist ?? '';
      if (!name) continue;
      const m = name.match(/^(.+?)(\d{1,4})$/);
      const base = m ? m[1] : name;
      const yr = m ? parseInt(m[2]) : -1;
      if (!ocShardCache[base] || yr > (parseInt((ocShardCache[base].match(/\d+$/) ?? ['0'])[0]))) {
        ocShardCache[base] = name;
      }
      ocShardCache[name] = name;
    }
    ocShardCache[shard] = best;
    return best;
  } catch {
    return shard;
  }
}

async function ocFetch(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL('https://api.opencaselist.com/v1' + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (ocCookie) headers['Cookie'] = ocCookie;
  const res = await fetch(url.toString(), { headers });
  if (res.status === 401) throw new Error('AUTH_REQUIRED');
  if (!res.ok) throw new Error(`OpenCaselist HTTP ${res.status}`);
  return res.json();
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

const GEMINI_MODEL_IDS: Record<string, string> = {
  'flash-lite':   'gemini-2.5-flash-lite',
  'flash':        'gemini-2.5-flash',
  'flash-35':     'gemini-3.5-flash',
  'flash-latest': 'gemini-2.5-flash-latest',
};

async function getGeminiModelId(): Promise<string> {
  try {
    const s = await readJson('app_settings');
    const key = s?.geminiModel as string | undefined;
    return GEMINI_MODEL_IDS[key ?? ''] ?? GEMINI_MODEL_IDS['flash'];
  } catch {
    return GEMINI_MODEL_IDS['flash'];
  }
}

// ─── Multi-provider model tier system ────────────────────────────────────────
// Three tiers per provider: lite (cheap/fast), balanced (default), best (most capable).
// Routing rules that apply regardless of provider:
//   title generation   → always lite   (cheap single-turn task)
//   standard tasks     → balanced      (extract cards, scout, suggest blocks)
//   agent turns        → user's tier, but minimum balanced (never lite)
//   complex analysis   → best          (when explicitly needed)

const MODEL_TIER_IDS = {
  gemini:    { lite: 'gemini-2.5-flash-lite', balanced: 'gemini-2.5-flash',  best: 'gemini-3.5-flash' },
  openai:    { lite: 'gpt-4.1-nano',          balanced: 'gpt-4.1-mini',      best: 'gpt-4.1' },
  anthropic: { lite: 'claude-3-5-haiku-20241022', balanced: 'claude-3-5-sonnet-20241022', best: 'claude-sonnet-4-6' },
} as const;

type Provider = 'gemini' | 'openai' | 'anthropic';
type ModelTier = 'lite' | 'balanced' | 'best';

function resolveUserTier(provider: Provider, modelKey: string): ModelTier {
  if (provider === 'gemini') {
    if (modelKey === 'flash-lite') return 'lite';
    if (modelKey === 'flash-35')   return 'best';
    return 'balanced';
  }
  if (provider === 'openai') {
    if (modelKey === 'gpt-4.1-nano') return 'lite';
    if (modelKey === 'gpt-4.1')      return 'best';
    return 'balanced';
  }
  // anthropic
  if (modelKey === 'claude-3-5-haiku-20241022') return 'lite';
  if (modelKey === 'claude-sonnet-4-6')         return 'best';
  return 'balanced';
}

/**
 * Read provider + model settings, then resolve the model ID for a given task tier.
 * Pass 'user' to use exactly the user's selected tier.
 * Pass 'balanced' to use user's tier but never go below balanced (agent-turn rule).
 * Pass 'lite'|'best' to override regardless of user selection.
 */
async function getProviderForTask(
  taskTier: ModelTier | 'user',
): Promise<{ provider: Provider; modelId: string; apiKey: string }> {
  const s = await readJson('app_settings').catch(() => null) as any;
  const provider: Provider = s?.apiProvider ?? 'gemini';

  const userModelKey: string =
    provider === 'gemini'    ? (s?.geminiModel    ?? 'flash')
  : provider === 'openai'    ? (s?.openaiModel    ?? 'gpt-4.1-mini')
  :                             (s?.anthropicModel ?? 'claude-3-5-sonnet-20241022');

  const userTier = resolveUserTier(provider, userModelKey);

  const effectiveTier: ModelTier =
    taskTier === 'user'     ? userTier
  : taskTier === 'balanced' ? (userTier === 'lite' ? 'balanced' : userTier)
  : taskTier;

  const modelId = MODEL_TIER_IDS[provider][effectiveTier];
  const secureKey = provider === 'openai' ? 'openai_key' : provider === 'anthropic' ? 'anthropic_key' : 'gemini';
  const apiKey = (await getSecure(secureKey)) ?? '';
  return { provider, modelId, apiKey };
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

function openaiHttpError(status: number, body: string): Error {
  let detail = '';
  try { detail = JSON.parse(body)?.error?.message ?? ''; } catch {}
  if (detail) return new Error(detail);
  if (status === 429) return new Error('OpenAI rate limit reached — wait a moment and try again.');
  if (status === 503) return new Error('OpenAI is busy right now — try again in a moment.');
  if (status === 401 || status === 403) return new Error('OpenAI rejected the API key — check your key in Settings.');
  return new Error(`OpenAI request failed (HTTP ${status}) — try again shortly.`);
}

async function callOpenAI(apiKey: string, prompt: string, modelId: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 8192,
    }),
  });
  if (!res.ok) throw openaiHttpError(res.status, await res.text().catch(() => ''));
  const data = await res.json() as any;
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('Unexpected OpenAI response shape');
  return text;
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

function anthropicHttpError(status: number, body: string): Error {
  let detail = '';
  try { detail = JSON.parse(body)?.error?.message ?? ''; } catch {}
  if (detail) return new Error(detail);
  if (status === 429) return new Error('Anthropic rate limit reached — wait a moment and try again.');
  if (status === 529) return new Error('Anthropic is overloaded right now — try again in a moment.');
  if (status === 401) return new Error('Anthropic rejected the API key — check your key in Settings.');
  return new Error(`Anthropic request failed (HTTP ${status}) — try again shortly.`);
}

async function callAnthropic(apiKey: string, prompt: string, modelId: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8192,
    }),
  });
  if (!res.ok) throw anthropicHttpError(res.status, await res.text().catch(() => ''));
  const data = await res.json() as any;
  const text = data?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Unexpected Anthropic response shape');
  return text;
}

// ─── Unified single-turn text call ───────────────────────────────────────────

async function callAI(prompt: string, taskTier: ModelTier | 'user'): Promise<string> {
  const { provider, modelId, apiKey } = await getProviderForTask(taskTier);
  if (!apiKey) throw new Error('NO_KEY');
  if (provider === 'openai')    return callOpenAI(apiKey, prompt, modelId);
  if (provider === 'anthropic') return callAnthropic(apiKey, prompt, modelId);
  // Gemini
  const res = await fetch(geminiGenerateUrl(modelId), {
    method: 'POST',
    headers: geminiHeaders(apiKey),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    }),
  });
  if (!res.ok) throw geminiHttpError(res.status, await res.text().catch(() => ''));
  const data = await res.json() as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Unexpected Gemini response shape');
  return text;
}

// ─── Message format converters (Gemini ↔ OpenAI/Anthropic) ───────────────────
// The renderer stores history in Gemini format. These converters let main.ts
// transparently route multi-turn agent calls to any provider.

/**
 * Convert Gemini-format messages to OpenAI chat format.
 * Assigns sequential tool call IDs so function call ↔ result pairs are matched.
 */
function geminiMsgsToOpenAI(messages: any[]): { msgs: any[]; toolIdMap: Map<string, string> } {
  const msgs: any[] = [];
  const toolIdMap = new Map<string, string>(); // functionName → last assigned call ID
  let callCounter = 0;

  for (const m of messages) {
    const parts: any[] = m.parts ?? [];
    const fnCalls   = parts.filter((p: any) => p.functionCall);
    const fnResults = parts.filter((p: any) => p.functionResponse);
    const texts     = parts.filter((p: any) => typeof p.text === 'string' && p.text.trim());

    if (fnCalls.length > 0) {
      const toolCalls = fnCalls.map((p: any) => {
        const id = `call_${callCounter++}`;
        toolIdMap.set(p.functionCall.name, id);
        return { id, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) } };
      });
      msgs.push({ role: 'assistant', tool_calls: toolCalls });
    } else if (fnResults.length > 0) {
      for (const p of fnResults) {
        const id = toolIdMap.get(p.functionResponse.name) ?? `call_${callCounter++}`;
        const content = typeof p.functionResponse.response?.result === 'string'
          ? p.functionResponse.response.result
          : JSON.stringify(p.functionResponse.response ?? {});
        msgs.push({ role: 'tool', tool_call_id: id, content });
      }
    } else if (texts.length > 0) {
      const role = m.role === 'model' ? 'assistant' : 'user';
      msgs.push({ role, content: texts.map((p: any) => p.text).join('') });
    }
  }
  return { msgs, toolIdMap };
}

/**
 * Convert Gemini-format messages to Anthropic messages format.
 * Assigns sequential tool_use IDs so tool_use ↔ tool_result pairs match.
 */
function geminiMsgsToAnthropic(messages: any[]): any[] {
  const result: any[] = [];
  let useCounter = 0;
  const useIdMap = new Map<string, string>(); // functionName → last tool_use id

  for (const m of messages) {
    const parts: any[] = m.parts ?? [];
    const fnCalls   = parts.filter((p: any) => p.functionCall);
    const fnResults = parts.filter((p: any) => p.functionResponse);
    const texts     = parts.filter((p: any) => typeof p.text === 'string' && p.text.trim());

    if (fnCalls.length > 0) {
      const content = fnCalls.map((p: any) => {
        const id = `toolu_${useCounter++}`;
        useIdMap.set(p.functionCall.name, id);
        return { type: 'tool_use', id, name: p.functionCall.name, input: p.functionCall.args ?? {} };
      });
      result.push({ role: 'assistant', content });
    } else if (fnResults.length > 0) {
      const content = fnResults.map((p: any) => {
        const id = useIdMap.get(p.functionResponse.name) ?? `toolu_${useCounter++}`;
        const text = typeof p.functionResponse.response?.result === 'string'
          ? p.functionResponse.response.result
          : JSON.stringify(p.functionResponse.response ?? {});
        return { type: 'tool_result', tool_use_id: id, content: text };
      });
      result.push({ role: 'user', content });
    } else if (texts.length > 0) {
      const role = m.role === 'model' ? 'assistant' : 'user';
      result.push({ role, content: texts.map((p: any) => p.text).join('') });
    }
  }
  return result;
}

/** Convert Gemini functionDeclarations to OpenAI tools format */
function geminiToolsToOpenAI(geminiTools: any[]): any[] {
  return geminiTools.flatMap((t: any) => (t.functionDeclarations ?? []).map((d: any) => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description ?? '',
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(d.parameters?.properties ?? {}).map(([k, v]: [string, any]) => [
            k, { type: (v.type ?? 'STRING').toLowerCase(), description: v.description ?? '' },
          ])
        ),
        required: (d.parameters?.required ?? []),
      },
    },
  })));
}

/** Convert Gemini functionDeclarations to Anthropic tools format */
function geminiToolsToAnthropic(geminiTools: any[]): any[] {
  return geminiTools.flatMap((t: any) => (t.functionDeclarations ?? []).map((d: any) => ({
    name: d.name,
    description: d.description ?? '',
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(d.parameters?.properties ?? {}).map(([k, v]: [string, any]) => [
          k, { type: (v.type ?? 'STRING').toLowerCase(), description: v.description ?? '' },
        ])
      ),
      required: d.parameters?.required ?? [],
    },
  })));
}

/** Wrap an OpenAI response message back into Gemini modelContent shape for the renderer */
function openAIMsgToGeminiContent(msg: any): any {
  if (msg.tool_calls?.length > 0) {
    return {
      role: 'model',
      parts: msg.tool_calls.map((tc: any) => ({
        functionCall: { name: tc.function.name, args: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })() },
      })),
    };
  }
  return { role: 'model', parts: [{ text: msg.content ?? '' }] };
}

/** Wrap Anthropic response content blocks back into Gemini modelContent shape */
function anthropicContentToGeminiContent(content: any[]): any {
  const toolUses = content.filter((c: any) => c.type === 'tool_use');
  if (toolUses.length > 0) {
    return { role: 'model', parts: toolUses.map((tu: any) => ({ functionCall: { name: tu.name, args: tu.input ?? {} } })) };
  }
  const text = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  return { role: 'model', parts: [{ text }] };
}

// The API key goes in the x-goog-api-key header, never the URL — query strings
// leak into proxy/server logs and browser history; auth headers don't.
function geminiGenerateUrl(modelId: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
}
function geminiHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
}

// Gemini returns a JSON error body. Surface its human-readable message instead of
// dumping the raw "{ error: { code, message, status } }" blob into the UI.
function geminiHttpError(status: number, body: string): Error {
  let detail = '';
  try { detail = JSON.parse(body)?.error?.message ?? ''; } catch { /* not JSON */ }
  if (detail) return new Error(detail);
  if (status === 429) return new Error('Warroom AI rate limit reached — wait a moment and try again.');
  if (status === 503) return new Error('Warroom AI is overloaded right now. Try again in a few seconds.');
  if (status === 403 || status === 400) return new Error(`Warroom AI rejected the request (HTTP ${status}) — check your API key in Settings.`);
  return new Error(`Warroom AI request failed (HTTP ${status}) — try again shortly.`);
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const modelId = await getGeminiModelId();
  const res = await fetch(geminiGenerateUrl(modelId), {
    method: 'POST',
    headers: geminiHeaders(apiKey),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    }),
  });
  if (!res.ok) throw geminiHttpError(res.status, await res.text().catch(() => ''));
  const data = await res.json() as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Unexpected Gemini response shape');
  return text;
}

async function callGeminiVision(apiKey: string, imageBase64: string, mimeType: string, prompt: string): Promise<string> {
  const modelId = await getGeminiModelId();
  const res = await fetch(geminiGenerateUrl(modelId), {
    method: 'POST',
    headers: geminiHeaders(apiKey),
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType, data: imageBase64 } },
        { text: prompt },
      ]}],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) throw geminiHttpError(res.status, await res.text().catch(() => ''));
  const data = await res.json() as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Unexpected Gemini response shape');
  return text;
}

// ─── Deterministic round-email parser (no Gemini) ────────────────────────────
// Uses macOS Vision framework (OCR) + regex. Works offline, requires no API key.

/** Run OCR on an image file. Returns raw recognised text.
 *  - macOS: uses Vision framework via an inline Swift script (accurate, no API key)
 *  - Windows/Linux: uses the PowerShell OCR (Windows) or throws a clear error
 */
async function visionOCR(imagePath: string): Promise<string> {
  if (process.platform === 'darwin') {
    return macOSVisionOCR(imagePath);
  } else if (process.platform === 'win32') {
    return windowsOCR(imagePath);
  }
  throw new Error('Import from screenshot is only supported on macOS and Windows.');
}

async function macOSVisionOCR(imagePath: string): Promise<string> {
  // Inline Swift script — Vision framework, accurate mode, no language correction
  // (language correction can mangle team codes like "Emery BL" → "Emery BI")
  const swiftSrc = `
import Vision
import AppKit

let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path),
      let cg  = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fputs("ERROR: cannot load image\\n", stderr); exit(1)
}
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
let req     = VNRecognizeTextRequest()
req.recognitionLevel       = .accurate
req.usesLanguageCorrection = false
try handler.perform([req])
let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\\n"))
`.trimStart();

  return new Promise((resolve, reject) => {
    // Pass the script via stdin to `swift -` so we never write a temp .swift file
    const child = execFile('swift', ['-', imagePath], { timeout: 30_000, maxBuffer: 1_024 * 1_024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout);
    });
    child.stdin!.write(swiftSrc);
    child.stdin!.end();
  });
}

async function windowsOCR(imagePath: string): Promise<string> {
  // Windows 10/11 has a built-in OCR engine accessible via PowerShell + WinRT.
  // Escape the metacharacters of a PowerShell double-quoted string (backtick, $, ")
  // so the path can't break out of the string literal. Backslashes are literal in
  // PS double-quoted strings, so they are left untouched (doubling them would
  // actually corrupt normal Windows paths).
  const psImagePath = imagePath.replace(/`/g, '``').replace(/\$/g, '`$').replace(/"/g, '`"');
  const psScript = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]

function Await($task) {
  $asTask = [System.WindowsRuntimeSystemExtensions]::AsTask($task)
  $asTask.Wait() | Out-Null
  $asTask.Result
}

$file  = Await([Windows.Storage.StorageFile]::GetFileFromPathAsync("${psImagePath}"))
$stream = Await($file.OpenAsync([Windows.Storage.FileAccessMode]::Read))
$decoder = Await([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))
$bitmap  = Await($decoder.GetSoftwareBitmapAsync())
$engine  = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result  = Await($engine.RecognizeAsync($bitmap))
$result.Lines | ForEach-Object { $_.Text } | Out-String
`.trimStart();

  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', '-'],
      { timeout: 30_000, maxBuffer: 1_024 * 1_024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve(stdout);
      },
    );
    child.stdin!.write(psScript);
    child.stdin!.end();
  });
}

/** Strip trailing timezone abbreviation from a time string.
 *  "7:40 PST" → "7:40",  "9:00 AM PDT" → "9:00 AM",  "3:15" → "3:15"
 *  Handles uppercase (PST) and lowercase (pst) from OCR or AI output.
 *  Preserves AM/PM.
 */
function stripTimezone(s: string | null | undefined): string | null {
  if (!s) return null;
  // Match standard North-American timezone abbrevs: xST, xDT, UTC, GMT (case-insensitive)
  // Does NOT strip AM/PM (2 chars, no T suffix pattern).
  const stripped = s.trim()
    .replace(/\s+(?:[A-Za-z]{1,2}[SD]T|UTC|GMT)(?:\s.*)?$/, '')
    .trim();
  return stripped || null;
}

/** Parse the plain text produced by OCR into structured round fields. */
function parseTabroomEmailText(text: string): {
  round: number; side: 'aff' | 'neg'; room: string | null;
  time: string | null; aff_team: string; neg_team: string; judge: string | null;
  isBye: boolean;
} | null {
  // Normalize: collapse runs of whitespace to single space per line, trim lines
  const normalized = text.split(/\r?\n/).map((l) => l.trim()).join('\n');

  // Round number — "Round 3 of HS Policy", "Round 3:", "Round: 3", "Round3"
  const roundM = normalized.match(/Round[:\s]*(\d+)/i);
  if (!roundM) return null;

  // Start time — "Start: 3:00 PM PST", "Start 3:00", "Start Time: …"
  const timeM = normalized.match(/Start(?:\s+Time)?[:\s]+([^\n]+)/i);

  // Room — "Room: 214B", "Room 214B"
  const roomM = normalized.match(/Room[:\s]+([^\n]+)/i);

  // Side — "Side: AFF", "Side: NEG", "Side AFF"
  const sideM = normalized.match(/Side[:\s]+(AFF|NEG)/i);
  const side: 'aff' | 'neg' = sideM?.[1]?.toUpperCase() === 'NEG' ? 'neg' : 'aff';

  // Teams — look for lines starting with AFF/NEG after "Competitors" if present
  const compIdx = normalized.search(/Competitors/i);
  const searchFrom = compIdx >= 0 ? normalized.slice(compIdx) : normalized;
  // Match "AFF Emery BL" or "AFF: Emery BL"
  const affM = searchFrom.match(/\bAFF[:\s]+([^\n]+)/i);
  const negM = searchFrom.match(/\bNEG[:\s]+([^\n]+)/i);

  // Judge — line immediately after "Judging" or "Judge:"
  const judgeM = normalized.match(/(?:Judging|Judge)[:\s]*[\r\n]+([^\r\n]+)/i)
    ?? normalized.match(/(?:Judging|Judge)[:\s]+([^\n]+)/i);

  const clean = (s: string | undefined) => {
    const v = s?.trim().replace(/\s{2,}/g, ' ');
    return v || null;
  };
  const cleanTime = (s: string | null) => stripTimezone(s);

  const roomVal = clean(roomM?.[1]);
  const negTeam = clean(negM?.[1]) ?? '';
  // Bye detection: room is "BYE", or only one competitor listed (no NEG team)
  const isBye = /^bye$/i.test(roomVal ?? '') || negTeam === '';

  return {
    round:    parseInt(roundM[1], 10),
    side,
    room:     roomVal,
    time:     cleanTime(clean(timeM?.[1])),
    aff_team: clean(affM?.[1]) ?? '',
    neg_team: negTeam,
    judge:    clean(judgeM?.[1]),
    isBye,
  };
}

// ─── File text extraction ─────────────────────────────────────────────────────

async function extractText(filePath: string): Promise<string> {
  const ext = filePath.toLowerCase().split('.').pop();
  if (ext === 'docx') {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ path: filePath })).value;
  }
  if (ext === 'pdf') {
    const pdfParse = require('pdf-parse');
    return (await pdfParse(await fs.readFile(filePath))).text;
  }
  throw new Error(`Unsupported file type: .${ext}`);
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    icon: iconPath,
    // macOS: hide native chrome, show traffic lights inset into our custom titlebar
    // Windows: use a frameless window with a custom overlay for the caption buttons
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? {} : {
      titleBarOverlay: {
        color: '#e8e8ea',
        symbolColor: '#3c3c43',
        height: 36,
      },
    }),
    backgroundColor: '#f0f0f2',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      webSecurity: true,
    },
  });

  // Prevent the renderer from spawning new windows or navigating to external URLs.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWin = win;
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.webContents.once('did-finish-load', () => {
    if (pendingOpenFilePath) {
      win.webContents.send('file:open', pendingOpenFilePath);
      pendingOpenFilePath = null;
    }
    if (pendingDeepLink) {
      const link = pendingDeepLink;
      pendingDeepLink = null;
      handleDeepLink(link);
    }
  });
}

// ─── Web-contents hardening ────────────────────────────────────────────────────
// Defense-in-depth for the embedded <webview> tags (Logos / Open Evidence /
// OpenCaselist) and the app's own renderer.
app.on('web-contents-created', (_event, contents) => {
  // Force every attached <webview> to run with node integration off, context
  // isolation on, and no inherited preload — so a compromised renderer can't spawn
  // a privileged webview that reaches Node and escalates to the host.
  contents.on('will-attach-webview', (_evt, webPreferences) => {
    delete (webPreferences as any).preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    (webPreferences as any).sandbox = true;
  });

  // Keep the app's own renderer pinned to the bundled app. The search webviews are
  // expected to browse the live web, so they're exempt from this navigation lock.
  contents.on('will-navigate', (evt, url) => {
    if (contents.getType() === 'webview') return;
    const renderer = process.env['ELECTRON_RENDERER_URL'];
    const ok = isDev && renderer ? url.startsWith(renderer) : url.startsWith('file://');
    if (!ok) evt.preventDefault();
  });
});

// ─── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.handle('storage:read', async (_e, name: string) => readJson(name));
ipcMain.handle('storage:write', async (_e, name: string, data: unknown) => { await writeJson(name, data); return true; });

// Windows: live-update the caption-button overlay so it follows the app theme.
// No-op on macOS (traffic lights aren't a recolorable overlay).
ipcMain.handle('window:setTitleBarOverlay', (event, opts: { color: string; symbolColor: string }) => {
  if (process.platform === 'darwin') return false;
  const w = BrowserWindow.fromWebContents(event.sender);
  if (w && typeof (w as any).setTitleBarOverlay === 'function') {
    try {
      (w as any).setTitleBarOverlay({ color: opts.color, symbolColor: opts.symbolColor, height: 36 });
      return true;
    } catch { return false; }
  }
  return false;
});

ipcMain.handle('secure:set', async (_e, key: string, value: string) => {
  await setSecure(key, value);
  return true;
});
ipcMain.handle('secure:get', async (_e, key: string) => getSecure(key));

// ─── Speech doc extraction (for Warroom Agent token saving) ──────────────────

// In-memory cache: filePath → { full, tokenSaving }
// Lifetime: attach → send/remove → delete
const speechDocCache = new Map<string, { full: string; tokenSaving: string }>();

ipcMain.handle('speechdoc:extract', async (_e, filePath: string) => {
  if (speechDocCache.has(filePath)) return sbOk(speechDocCache.get(filePath)!);
  try {
    checkPath(filePath);
    const JSZip = require('jszip');
    const buf = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(buf);
    const xml: string = await zip.file('word/document.xml')?.async('string') ?? '';
    if (!xml) return sbErr('Could not read document XML');

    const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const getStyle = (p: string) =>
      (p.match(/w:pStyle\s+w:val="([^"]+)"/) ?? [])[1] ?? 'Normal';

    // Collect text from runs that have underline or cyan/yellow highlight
    const extractEmphasized = (p: string): string => {
      const runs = [...p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)];
      return runs
        .filter((r) => {
          const s = r[0];
          // Any underline style (single, double, words, dotted, etc.) — not "none"
          const hasUnderline = /<w:u\b[^>]*w:val="(?!none)[^"]*"/.test(s);
          // Cyan or yellow highlight (common debate doc styles)
          const hasHighlight = /w:val="cyan"|w:val="yellow"/.test(s);
          return hasUnderline || hasHighlight;
        })
        .map((r) => strip(r[0]))
        .filter(Boolean)
        .join(' ');
    };

    const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)];
    const fullLines: string[] = [];
    const tokenLines: string[] = [];
    let nextIsCite = false;

    for (const paraMatch of paras) {
      const p = paraMatch[0];
      const style = getStyle(p);
      const text = strip(p);
      if (!text) continue;

      const isHeading = ['Heading1','Heading2','Heading3','Heading4'].includes(style);

      if (isHeading) {
        fullLines.push(text);
        tokenLines.push(text);
        nextIsCite = style === 'Heading4';
      } else if (style === 'NormalWeb' || style === 'Normal') {
        fullLines.push(text);
        if (nextIsCite) {
          // First NormalWeb after a Heading4 is always the cite — always include
          tokenLines.push(text);
          nextIsCite = false;
        } else {
          // Body text — token saving only keeps underlined / cyan-highlighted runs
          const emph = extractEmphasized(p);
          if (emph) tokenLines.push(emph);
        }
      }
    }

    const result = { full: fullLines.join('\n'), tokenSaving: tokenLines.join('\n') };
    speechDocCache.set(filePath, result);
    return sbOk(result);
  } catch (e: any) { return sbErr(e.message); }
});

ipcMain.handle('speechdoc:clearCache', (_e, filePath?: string) => {
  if (filePath) speechDocCache.delete(filePath);
  else speechDocCache.clear();
  return sbOk(null);
});

ipcMain.handle('dictation:transcribe', async (_e, audioBase64: string, mimeType: string) => {
  const apiKey = await getSecure('gemini');
  if (!apiKey) return sbErr('No Gemini API key configured');
  try {
    const body = {
      contents: [{
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: 'Transcribe this audio exactly as spoken. Return only the transcription text, nothing else.' },
        ],
      }],
      generationConfig: {
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`,
      { method: 'POST', headers: geminiHeaders(apiKey), body: JSON.stringify(body) },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return sbErr(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
    }
    const json = await res.json();
    // Find first non-thought text part (thinking models emit thought parts before the answer)
    const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
    const text: string = parts.find((p: any) => !p.thought && typeof p.text === 'string')?.text ?? '';
    return sbOk(text.trim());
  } catch (e: any) {
    return sbErr(e.message ?? 'Transcription failed');
  }
});

// File dialog — no parent window required (avoids null crash in dev)
ipcMain.handle('dialog:openFile', async (_e, accept: string[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Files', extensions: accept }],
  });
  if (result.canceled) return null;
  const p = result.filePaths[0];
  trustPath(p);
  persistTrustedPath(p); // keep trusted across restarts
  return p;
});

// Write base64 buffer to a temp file and return the path (without opening it)
ipcMain.handle('fs:writeTempFile', async (_e, base64: string, filename: string) => {
  try {
    const tmpDir = join(os.tmpdir(), 'warroom');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, `${crypto.randomUUID()}-${safeFilename(filename)}`);
    await fs.writeFile(tmpPath, Buffer.from(base64, 'base64'));
    return { ok: true, path: tmpPath };
  } catch (e: any) {
    return { ok: false, error: String(e.message) };
  }
});

// Write base64 buffer to a temp file and open it in the default OS app (e.g. Excel).
// The filename is sanitized to a single path segment and the file is opened via
// shell.openPath (no shell interpreter), so a crafted name can neither escape the
// temp dir nor inject into a command line.
ipcMain.handle('shell:openBuffer', async (_e, base64: string, filename: string) => {
  try {
    const tmpDir = join(os.tmpdir(), 'warroom');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, `${crypto.randomUUID()}-${safeFilename(filename)}`);
    await fs.writeFile(tmpPath, Buffer.from(base64, 'base64'));
    const err = await shell.openPath(tmpPath);
    if (err) return { ok: false, error: err };
    return { ok: true, path: tmpPath };
  } catch (e: any) {
    return { ok: false, error: String(e.message) };
  }
});

// Generic save-buffer dialog: renderer sends base64-encoded file data + name + filters
ipcMain.handle('dialog:saveBuffer', async (_e, base64: string, defaultName: string, filters: { name: string; extensions: string[] }[]) => {
  try {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName, filters });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.writeFile(result.filePath, Buffer.from(base64, 'base64'));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e.message) };
  }
});

ipcMain.handle('ai:extractCards', async (_e, filePath: string) => {
  checkPath(filePath);
  const text = await extractText(filePath);
  if (!text.trim()) throw new Error('Could not extract text from file');
  const prompt = `You are a policy debate evidence assistant. Extract all debate cards from the provided document text. For each card return a JSON array where each item has exactly these fields:
- "tag": a short argumentative label summarizing the card's claim (under 15 words, no punctuation at end)
- "cite": author last name, year, and source or institution (e.g. "Kristensen & McKinzie 18, Federation of American Scientists")
- "body": the full text of the card body
- "year": integer year extracted from the cite
Return ONLY a valid JSON array. No markdown, no code fences, no explanation, no preamble. If you cannot find any cards, return an empty array [].

Document text:
${text.slice(0, 60000)}`;
  const raw = await callAI(prompt, 'balanced');
  return JSON.parse(raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim());
});

ipcMain.handle('ai:teamSummary', async (_e, {
  teamName,
  rawRounds,
  rawCites,
}: {
  teamName: string;
  rawRounds: any[];
  rawCites: any[];
}) => {
  try {
    // Number every source so the AI can reference them by ID
    let sourceCounter = 0;
    interface SourceEntry { id: number; sourceTitle: string; excerpt: string; side: 'aff' | 'neg' }
    const sourceMap: SourceEntry[] = [];

    const affRoundLines: string[] = [];
    const negRoundLines: string[] = [];
    rawRounds.forEach((r: any, i: number) => {
      const side = (r.side ?? '').toLowerCase();
      const tourn = (r.tournament ?? '').replace(/^\d+---/, '') || 'Unknown tournament';
      const rd = r.round ? `Rd ${r.round}` : '';
      const recencyNote = i >= rawRounds.length - 3 ? ' [RECENT]' : '';
      const id = ++sourceCounter;
      const label = [tourn, rd].filter(Boolean).join(', ');
      const excerpt = (r.report ?? r.cites ?? '').slice(0, 300);
      sourceMap.push({ id, sourceTitle: `${label}${recencyNote}`, excerpt, side: side.startsWith('a') ? 'aff' : 'neg' });
      const line = `[${id}] ${label}${recencyNote}`;
      if (side.startsWith('a')) affRoundLines.push(line);
      else negRoundLines.push(line);
    });

    const affCiteLines: string[] = [];
    const negCiteLines: string[] = [];
    rawCites.slice(0, 40).forEach((c: any) => {
      const side = (c.side ?? '').toLowerCase();
      const title = c.title ?? '(untitled)';
      const excerpt = (c.cites ?? '').slice(0, 500);
      const id = ++sourceCounter;
      sourceMap.push({ id, sourceTitle: title, excerpt, side: side.startsWith('a') ? 'aff' : 'neg' });
      const entry = `[${id}] ${title}\n${excerpt}`;
      if (side.startsWith('a')) affCiteLines.push(entry);
      else negCiteLines.push(entry);
    });

    const affSection = [
      '## AFF ROUNDS (oldest → newest):',
      affRoundLines.length ? affRoundLines.join('\n') : '(none)',
      '',
      '## AFF EVIDENCE/CITES:',
      affCiteLines.length ? affCiteLines.join('\n\n') : '(none)',
    ].join('\n');

    const negSection = [
      '## NEG ROUNDS (oldest → newest):',
      negRoundLines.length ? negRoundLines.join('\n') : '(none)',
      '',
      '## NEG EVIDENCE/CITES:',
      negCiteLines.length ? negCiteLines.join('\n\n') : '(none)',
    ].join('\n');

    const prompt = `You are a competitive policy debate analyst. Analyze this team's disclosed rounds and evidence to produce a rich scouting report.

TEAM: ${teamName}

${affSection}

${negSection}

---

Produce a scouting report with two sections ("aff" and "neg").

CRITICAL FORMATTING RULES — the "aff" and "neg" JSON string values MUST contain these literal character sequences for a custom renderer to display them. Do not strip or escape them.
  **text between double asterisks** = bold (use for position names, key claims, predictions)
  *text between single asterisks* = italic (use for author names, qualifiers)
  __text between double underscores__ = underlined (use for specific card tags or central warrants)
  [cite:N] = inline citation chip (use after claims referencing source [N] from the data above)

EXAMPLE of a correctly formatted value (copy this style exactly):
  "aff": "This team runs the **Arctic Governance Affirmative**, which contends that US leadership prevents *Chinese and Russian* territorial aggression[cite:2]. Their central warrant is __US leadership key to prevent great power war__[cite:5], which appears in 4 of 5 rounds. **Expect them to read this aff at the next tournament.**"

CONTENT REQUIREMENTS for each section:
1. Name the argument(s) with specificity — use **bold** for all position names
2. Identify key cards — use __underline__ for the most important card tags
3. Analyze frequency (count) and recency ([RECENT] rounds weighted higher) — use *italic* for author names
4. End with a bold prediction sentence

Each section: 3–5 paragraphs of analytical prose. No markdown headers inside the text.

Also return a "citations" array with one entry per [cite:N] you used:
- "id": the N integer
- "sourceTitle": short label (tournament name + round, or author + year)
- "excerpt": verbatim snippet from the source data above (under 120 words)

Return ONLY valid JSON, no markdown fences, no extra text:
{ "aff": "...", "neg": "...", "citations": [{ "id": 1, "sourceTitle": "...", "excerpt": "..." }] }`;

    const raw = await callAI(prompt.slice(0, 120000), 'balanced');
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.aff !== 'string' || typeof parsed.neg !== 'string') {
      throw new Error('Unexpected AI response shape');
    }
    const citations: { id: number; sourceTitle: string; excerpt: string }[] =
      Array.isArray(parsed.citations) ? parsed.citations : [];
    return { ok: true, aff: parsed.aff as string, neg: parsed.neg as string, citations };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'AI error' };
  }
});

const ROUND_EMAIL_PROMPT = `You are a debate round pairing parser. Extract the round information from this Tabroom pairing email screenshot.
Return ONLY a JSON object with these fields (omit any you cannot find):
- "round": integer round number
- "side": "aff" or "neg" (lowercase)
- "room": room name/number as a string
- "time": start time as a string (e.g. "9:00 AM")
- "aff_team": name of the aff team
- "neg_team": name of the neg team
- "judge": judge name(s) as a string
Return ONLY valid JSON, no markdown, no explanation.`;

ipcMain.handle('ai:parseRoundEmail', async (_e, { filePath, imageBase64, mimeType }: { filePath?: string; imageBase64?: string; mimeType?: string }) => {
  try {
    let imgPath: string;
    let tempCreated = false;
    // Keep a copy of base64 for potential Gemini fallback
    let b64ForFallback = imageBase64;
    let mimeForFallback = mimeType ?? 'image/png';

    if (filePath) {
      checkPath(filePath);
      imgPath = filePath;
    } else if (imageBase64) {
      // Write the base64 image to a temp file so Vision can read it
      const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
      imgPath = join(os.tmpdir(), `warroom_ocr_${Date.now()}.${ext}`);
      await fs.writeFile(imgPath, Buffer.from(imageBase64, 'base64'));
      tempCreated = true;
    } else {
      return { ok: false, error: 'No image provided' };
    }

    // ── Step 1: Try deterministic OCR + regex ────────────────────────────────
    let ocrText = '';
    let ocrError: string | null = null;
    try {
      ocrText = await visionOCR(imgPath);
    } catch (e: any) {
      ocrError = e.message;
    } finally {
      if (tempCreated) fs.unlink(imgPath).catch(() => {});
    }

    // If we loaded from a filePath, we still need base64 for Gemini fallback
    if (filePath && !b64ForFallback) {
      try {
        const buf = await fs.readFile(filePath);
        b64ForFallback = buf.toString('base64');
        mimeForFallback = filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
      } catch { /* best effort */ }
    }

    const data = ocrText.trim() ? parseTabroomEmailText(ocrText) : null;
    if (data) return { ok: true, data };

    // ── Step 2: Gemini fallback ───────────────────────────────────────────────
    let apiKey: string | null = null;
    try { apiKey = await getSecure('gemini'); } catch { /* no key */ }

    if (!apiKey || !b64ForFallback) {
      // No fallback available — surface OCR error or parse failure
      if (ocrError) return { ok: false, error: `Could not read the image: ${ocrError}` };
      if (!ocrText.trim()) return { ok: false, error: 'Could not extract text from the image — make sure it clearly shows a Tabroom pairing email.' };
      return { ok: false, error: `Could not parse the email structure. OCR read:\n\n${ocrText.slice(0, 600)}` };
    }

    // Call Gemini Vision — wrapped in its own try/catch so Gemini errors don't
    // surface as raw HTTP messages; fall back to an OCR diagnostic instead.
    try {
      const raw = await callGeminiVision(apiKey, b64ForFallback, mimeForFallback, ROUND_EMAIL_PROMPT);
      const geminiData = JSON.parse(raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim());
      // Apply the same timezone stripping that the OCR path applies
      if (geminiData.time) geminiData.time = stripTimezone(String(geminiData.time)) ?? geminiData.time;
      // Detect bye from Gemini output too
      geminiData.isBye = /^bye$/i.test(geminiData.room ?? '') || !(geminiData.neg_team ?? '').trim();
      return { ok: true, data: geminiData, usedFallback: true };
    } catch (geminiErr: any) {
      // Gemini failed (rate limit, quota, network) — surface a clear message
      const isOverloaded = /503|overload|unavailable|demand/i.test(String(geminiErr.message));
      if (isOverloaded) {
        return { ok: false, error: 'Warroom AI is overloaded right now. Try again in a few seconds.' };
      }
      const isNoKey = /NO_KEY|401|403|api.key/i.test(String(geminiErr.message));
      if (isNoKey) {
        return { ok: false, error: 'Gemini API key not set. Add your key in Settings → API Keys.' };
      }
      // Generic fallback: show OCR diagnostic if available
      if (ocrText.trim()) {
        return { ok: false, error: `OCR read the image but could not match a Tabroom pairing format. OCR read:\n\n${ocrText.slice(0, 600)}` };
      }
      return { ok: false, error: `Could not parse the image (Gemini error: ${geminiErr.message})` };
    }

  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('clipboard:readImage', async () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return { ok: false };
  return { ok: true, base64: img.toPNG().toString('base64'), mimeType: 'image/png' };
});

ipcMain.handle('ai:suggestBlocks', async (_e, opponentPositions: string, blockList: { id: string; title: string }[]) => {
  const raw = await callAI(
    `You are a policy debate assistant. Given an opponent's disclosed positions and a list of available blocks, return the IDs of the 4 most relevant blocks the debater should review before this round.\n\nOpponent positions:\n${opponentPositions}\n\nAvailable blocks (id: title):\n${blockList.map(b => `${b.id}: ${b.title}`).join('\n')}\n\nReturn ONLY a JSON array of exactly 4 block ID strings. No explanation, no markdown, no preamble. Example: ["id1","id2","id3","id4"]`,
    'balanced',
  );
  const ids = JSON.parse(raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim());
  if (!Array.isArray(ids)) throw new Error('Unexpected AI response');
  return ids.slice(0, 4) as string[];
});

ipcMain.handle('ai:missionBrief', async (_e, {
  roundNumber, side, room, time,
  opponentName, judgeName, judgeParadigm,
  affName, negPositions, rawCitesSample,
}: {
  roundNumber: number; side: string; room?: string; time?: string;
  opponentName: string; judgeName?: string; judgeParadigm?: string;
  affName?: string; negPositions: string[]; rawCitesSample?: string;
}) => {
  try {
    const roundCtx = [
      `Round ${roundNumber} — ${side.toUpperCase()}`,
      room ? `Room: ${room}` : '',
      time ? `Time: ${time}` : '',
    ].filter(Boolean).join('  |  ');

    const judgeSection = judgeName
      ? `JUDGE: ${judgeName}\n${judgeParadigm ? `\nParadigm:\n${judgeParadigm.slice(0, 2000)}` : '(Paradigm not loaded)'}`
      : '(No judge info available)';

    const disclosureSection = [
      affName ? `Aff: ${affName}` : '',
      ...negPositions.map((p) => `Neg: ${p}`),
      rawCitesSample ? `\nSample cites:\n${rawCitesSample.slice(0, 1500)}` : '',
    ].filter(Boolean).join('\n');

    const prompt = `You are an elite policy debate coach. Your debater has the following round coming up. Give them a mission briefing.

ROUND INFO: ${roundCtx}

OPPONENT: ${opponentName}
${disclosureSection ? `\nOPPONENT DISCLOSURE:\n${disclosureSection}` : '\n(No disclosure available)'}

${judgeSection}

---

Write a mission briefing for this debater. Use this exact structure:

**SITUATION**
2-3 sentences: what this round looks like and what the key challenge is.

**OPPONENT INTEL**
Bullet points on their known positions — what they run aff, what neg shells to expect, any tendencies from disclosure. If no disclosure, say so clearly.

**JUDGE NOTES**
What matters to this judge — voting issues, stylistic preferences, deal-breakers. If no paradigm, say "Fetch the paradigm before the round."

**GAME PLAN**
3-5 specific strategic recommendations for this round. Be concrete — name arguments, flows, blocks they should have ready.

**WATCH OUT FOR**
1-3 things that could go wrong and how to avoid them.

Be direct, tactical, and brief. No fluff.`;

    const raw = await callAI(prompt, 'user');
    return { ok: true, text: raw };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

// ─── Cross-ex practice questions ──────────────────────────────────────────────
// Generate targeted cross-examination questions (with model answers) for a speech
// doc, grounded in the skill for whichever event the user is running.

function cxEventBits(event: 'policy' | 'pf' | 'ld') {
  const skillName = event === 'pf' ? 'pf_debate' : event === 'ld' ? 'ld_debate' : 'cx_debate';
  const eventLabel = event === 'pf' ? 'Public Forum' : event === 'ld' ? 'Lincoln-Douglas' : 'Policy (CX)';
  return { skillName, eventLabel };
}

// Shared guidance block injected into every cross-ex prompt.
const CX_SHARED_RULES = `RULES:
1. Questions must target claims made in the HIGHLIGHTED TEXT only — that is what the opponent reads aloud and must defend.
2. ONE EXCEPTION: if the un-highlighted small text DIRECTLY and COMPLETELY CONTRADICTS a claim in the highlighted text WITHIN THE SAME CARD, you may ask about that contradiction. That is the ONLY reason to ever reference small text.
3. Each question: 1-3 sentences MAX. Be direct and pointed. No preamble, no "Can you explain…".
4. Each answer: 2-4 sentences MAX. Give the likely opponent response, then one sentence on what to press next.
5. Do NOT use markdown emphasis (no **, *, or __). Plain text only. You may wrap key phrases in 'single quotes'.
6. Be STRATEGIC — expose missing warrants, weak internal links, unqualified authors, in-card contradictions, non-unique impacts, or overclaims.`;

// How to tell aff content from neg content inside a doc that may contain both.
const CX_SIDE_GUIDANCE = `DETERMINING SIDE (Aff vs Neg):
- Speech labels: AFF speeches are 1AC, 2AC, 1AR, 2AR. NEG speeches are 1NC, 2NC, 1NR, 2NR. If a section is headed by one of these, it belongs to that side.
- Argument type: Aff content = the plan/advocacy, advantages, solvency, and case extensions. Neg content = disadvantages (DAs), counterplans (CPs), kritiks (Ks), topicality (T), and case-defense / "AT:" / "A2:" answer blocks.
- Tags, pocket headings, and file names often name the side directly.
- Weight question counts by how much HIGHLIGHTED (read) content each side has — NOT by small text. A side with far less content gets proportionally fewer questions (e.g. 8 aff cards vs 1 neg card → several aff questions, 0-1 neg questions).
- These are questions an opponent would ask YOU in cross-ex about the cards on that side.`;

function cxParseQuestions(raw: string): { question: string; answer: string; cardCite?: string }[] {
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('Unexpected AI response shape');
  return parsed
    .filter((q) => q && typeof q.question === 'string' && typeof q.answer === 'string')
    .map((q) => ({ question: String(q.question), answer: String(q.answer), cardCite: q.cardCite ? String(q.cardCite) : undefined }));
}

ipcMain.handle('ai:crossExQuestions', async (_e, {
  highlightedText, fullText, event, basedOn, side,
}: {
  highlightedText: string;
  fullText: string;
  event: 'policy' | 'pf' | 'ld';
  basedOn?: string;
  side?: string;
}) => {
  try {
    const { skillName, eventLabel } = cxEventBits(event);
    const skill = (await readSkill(skillName)) ?? '';

    const highlighted = (highlightedText ?? '').slice(0, 40000);
    const full = (fullText ?? '').slice(0, 60000);
    if (!highlighted.trim()) throw new Error('The document has no highlighted text to question.');

    const skillBlock = skill ? `Event guide:\n${skill.slice(0, 8000)}\n\n---\n\n` : '';
    const docBlock = `HIGHLIGHTED TEXT (tags, cites, and underlined/highlighted card text — what the opponent reads):
${highlighted}

FULL CARD TEXT (the un-highlighted "small text" around the highlighted portions):
${full}`;

    // ── "3 more like this" path — flat array, scoped to a single side ──────────
    if (basedOn) {
      const sideLine = side && side !== 'General'
        ? `These are questions about the ${side} content in the document.`
        : '';
      const prompt = `You are an elite ${eventLabel} debate coach writing cross-ex questions.

${skillBlock}${docBlock}

---

${CX_SHARED_RULES}

${sideLine}
Generate 3 NEW questions in the same spirit as this seed — same line of attack, fresh angles. Do NOT repeat it.
SEED: ${basedOn.slice(0, 500)}

For each question, set "cardCite" to the author last name + 2-digit year exactly as it appears in the highlighted text (e.g. "Brady 25"). Omit cardCite only if not targeting a specific card.

Return ONLY a JSON array of exactly 3 objects, no markdown fences, no preamble:
[{"question": "short pointed question", "answer": "short answer + one-line follow-up", "cardCite": "Brady 25"}]`;
      const questions = cxParseQuestions(await callAI(prompt, 'balanced')).slice(0, 3);
      if (questions.length === 0) throw new Error('No questions returned — try again.');
      return { ok: true, questions };
    }

    // ── Initial generation — detect side(s) and return grouped questions ──────
    const prompt = `You are an elite ${eventLabel} debate coach writing cross-ex questions.

${skillBlock}${docBlock}

---

${CX_SHARED_RULES}

${CX_SIDE_GUIDANCE}

TASK:
- First decide whether this document contains AFF content, NEG content, or BOTH.
- Generate between 3 and 6 questions TOTAL, distributed across the sides present in proportion to each side's highlighted content.
- If only one side is present, return a single group for that side ("Aff", "Neg", or "General" if genuinely undeterminable).
- Do not duplicate or overlap questions across sides.
- For each question, set "cardCite" to the author last name + 2-digit year exactly as it appears in the highlighted text (e.g. "Brady 25"). Omit cardCite only if the question targets the case generally rather than a specific card.

Return ONLY this JSON (no markdown fences, no preamble):
{"groups": [{"side": "Aff" | "Neg" | "General", "questions": [{"question": "...", "answer": "...", "cardCite": "Brady 25"}]}]}`;

    const raw = await callAI(prompt, 'balanced');
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim();
    const parsed = JSON.parse(cleaned);

    let groups: { side: string; questions: { question: string; answer: string; cardCite?: string }[] }[] = [];
    if (parsed && Array.isArray(parsed.groups)) {
      groups = parsed.groups
        .map((g: any) => ({
          side: ['Aff', 'Neg', 'General'].includes(g?.side) ? g.side : 'General',
          questions: Array.isArray(g?.questions)
            ? g.questions
                .filter((q: any) => q && typeof q.question === 'string' && typeof q.answer === 'string')
                .map((q: any) => ({ question: String(q.question), answer: String(q.answer), cardCite: q.cardCite ? String(q.cardCite) : undefined }))
            : [],
        }))
        .filter((g: any) => g.questions.length > 0);
    } else if (Array.isArray(parsed)) {
      // Fallback: model returned a flat array — treat as one undifferentiated group.
      const qs = parsed
        .filter((q: any) => q && typeof q.question === 'string' && typeof q.answer === 'string')
        .map((q: any) => ({ question: String(q.question), answer: String(q.answer), cardCite: q.cardCite ? String(q.cardCite) : undefined }));
      if (qs.length) groups = [{ side: 'General', questions: qs }];
    }

    if (groups.length === 0) throw new Error('No questions returned — try again.');
    return { ok: true, groups };
  } catch (e: any) {
    const msg = e?.message === 'NO_KEY'
      ? 'No AI API key configured — add one in Settings.'
      : (e?.message ?? 'Failed to generate questions');
    return { ok: false, error: msg };
  }
});

// ─── Cross-ex trap drill ──────────────────────────────────────────────────────
// Generate a few "trap" questions that bait a common wrong answer, then grade the
// user's typed answer with a cheap (lite) call so practice stays fast/affordable.
ipcMain.handle('ai:crossExTraps', async (_e, {
  highlightedText, fullText, event,
}: {
  highlightedText: string;
  fullText: string;
  event: 'policy' | 'pf' | 'ld';
}) => {
  try {
    const { skillName, eventLabel } = cxEventBits(event);
    const skill = (await readSkill(skillName)) ?? '';
    const highlighted = (highlightedText ?? '').slice(0, 40000);
    const full = (fullText ?? '').slice(0, 60000);
    if (!highlighted.trim()) throw new Error('The document has no highlighted text to question.');

    const prompt = `You are an elite ${eventLabel} debate coach running a cross-ex TRAP DRILL with a student.

${skill ? `Event guide:\n${skill.slice(0, 8000)}\n\n---\n\n` : ''}HIGHLIGHTED TEXT (what the opponent reads):
${highlighted}

FULL CARD TEXT (small text):
${full}

---

Design 3 cross-ex TRAPS. A trap is a setup question that looks innocent but where a careless answer walks the student into a devastating follow-up.

TRAP RULES:
- The setup must probe argument logic, warrants, or internal links — NOT card wording. NEVER ask the student to quote specific sentences, recall exact phrasing, or cite internal evidence from the card. They cannot see the card during the drill.
- The trap should work by getting the student to overclaim, underclaim, or concede a logical implication — not by testing whether they memorized the card.
- Good traps: "Does your card say X is already happening or just that it might happen?", "If that's true, doesn't that mean Y is also true?", "So your impact assumes Z — but does your card actually say that?"
- Bad traps: "What specific evidence in that card supports that claim?", "What does the card say about X exactly?"

For each trap provide:
- "setup": the opening question you ask the student (1-2 sentences).
- "trapAnswer": the tempting WRONG answer most students give that springs the trap (1 sentence).
- "gotcha": the follow-up that exploits the wrong answer — the moment they realize they're cornered (1-2 sentences).
- "idealAnswer": the disciplined answer that avoids the trap entirely (1-2 sentences).
- "lesson": one sentence on the principle (what to watch for / how to avoid it).

${CX_SHARED_RULES}

Return ONLY this JSON, no markdown fences, no preamble:
[{"setup": "...", "trapAnswer": "...", "gotcha": "...", "idealAnswer": "...", "lesson": "..."}]`;

    const raw = await callAI(prompt, 'balanced');
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error('Unexpected AI response shape');
    const traps = parsed
      .filter((t) => t && typeof t.setup === 'string' && typeof t.gotcha === 'string')
      .slice(0, 3)
      .map((t) => ({
        setup: String(t.setup),
        trapAnswer: String(t.trapAnswer ?? ''),
        gotcha: String(t.gotcha),
        idealAnswer: String(t.idealAnswer ?? ''),
        lesson: String(t.lesson ?? ''),
      }));
    if (traps.length === 0) throw new Error('No traps returned — try again.');
    return { ok: true, traps };
  } catch (e: any) {
    const msg = e?.message === 'NO_KEY'
      ? 'No AI API key configured — add one in Settings.'
      : (e?.message ?? 'Failed to generate traps');
    return { ok: false, error: msg };
  }
});

ipcMain.handle('ai:crossExGradeTrap', async (_e, {
  setup, idealAnswer, trapAnswer, gotcha, lesson, userAnswer, event,
}: {
  setup: string; idealAnswer: string; trapAnswer: string; gotcha: string; lesson: string;
  userAnswer: string; event: 'policy' | 'pf' | 'ld';
}) => {
  try {
    const { eventLabel } = cxEventBits(event);
    if (!(userAnswer ?? '').trim()) throw new Error('Type an answer first.');

    const prompt = `You are an elite ${eventLabel} debate coach grading a student's answer in a cross-ex trap drill.

THE TRAP:
- Setup question asked: ${setup}
- The wrong answer that springs the trap: ${trapAnswer}
- The gotcha follow-up if they fall for it: ${gotcha}
- The ideal trap-avoiding answer: ${idealAnswer}
- Lesson: ${lesson}

THE STUDENT ANSWERED:
"${(userAnswer ?? '').slice(0, 1500)}"

Decide a verdict:
- "avoided" — the student sidestepped the trap (answer is disciplined, close to the ideal).
- "fell" — the student walked into the trap (answer resembles the wrong answer / opens the gotcha).
- "partial" — partially safe but sloppy / leaves an opening.

Then write 2-3 sentences of feedback:
- If avoided: confirm they got it right and name exactly HOW they avoided the trap.
- If fell or partial: spring the gotcha, explain what went wrong, and give the concrete fix.

Do NOT use markdown emphasis. Plain text. You may use 'single quotes'.

Return ONLY this JSON, no fences, no preamble:
{"verdict": "avoided" | "fell" | "partial", "feedback": "..."}`;

    const raw = await callAI(prompt, 'lite');
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    const verdict = ['avoided', 'fell', 'partial'].includes(parsed?.verdict) ? parsed.verdict : 'partial';
    const feedback = typeof parsed?.feedback === 'string' ? parsed.feedback : 'Could not grade that answer — try rephrasing.';
    return { ok: true, verdict, feedback };
  } catch (e: any) {
    const msg = e?.message === 'NO_KEY'
      ? 'No AI API key configured — add one in Settings.'
      : (e?.message ?? 'Failed to grade answer');
    return { ok: false, error: msg };
  }
});

// ─── Card credibility scoring ────────────────────────────────────────────────
// Scores every card in a speech doc in ONE AI call. The renderer extracts each
// card's tag + cite text from the rendered DOM and sends them numbered; we return
// a score array in the same order. Uses the 'balanced' tier — the user's selected
// model, but never the cheapest lite model (lite → balanced; e.g. Gemini Flash
// Lite is bumped to Flash) for a more reliable judgment.
ipcMain.handle('ai:scoreCards', async (_e, { cards }: {
  cards: { tag: string; cite: string }[];
}) => {
  try {
    const list = Array.isArray(cards) ? cards.slice(0, 150) : [];
    if (list.length === 0) throw new Error('No cards found to score.');

    const today = new Date().toISOString().slice(0, 10);
    const cardLines = list.map((c, i) =>
      `${i + 1}. TAG: ${String(c.tag ?? '').slice(0, 300)} | CITE: ${String(c.cite ?? '').slice(0, 600) || '(no citation text)'}`,
    ).join('\n');

    const prompt = `You are an evidence-credibility analyst for competitive debate. Today's date is ${today}.

Score debate evidence ("cards") based solely on what their citation text actually states. Never invent credentials, dates, publications, or qualifications not present in the text.

For each card you receive a TAG (the claim being made) and a CITE (the citation — may include author name, credentials, date, and source/publication).

Score 0–10 on FOUR factors:

--- AUTHOR (0–10): expertise of the author(s) RELATIVE TO THIS SPECIFIC CLAIM ---
Judge domain match, not just credentials:
• 10 — PhD/professor/senior practitioner in the exact field the tag claim is about
• 8 — credentialed expert in a closely related field, or senior government official on their area
• 6 — credentialed expert in a tangentially related field, or established think-tank fellow
• 4 — journalist or policy staffer with relevant beat; credentialed expert off their specialty
• 2 — student, generalist commentator, or non-expert with no stated credentials
• 0 — anonymous, or credentials entirely absent from the cite
If ONLY an organization is listed (no individual), use the org's reputation as a proxy:
RAND / CBO / CRS / GAO / OMB / IPCC → 8–9 | Established think tanks (Brookings, CSIS, CFR, Wilson Center) → 6–7 | Ideologically-aligned think tanks (Heritage, CATO, CAP, AEI) → 4–5 | Media outlet → 3–4

--- RECENCY (0–10): how current the evidence is, weighted by how fast this topic decays ---
Decay rates:
• Geopolitics / military posture / economic data / polling — fast decay: 2024=10, 2023=8, 2022=6, 2020=3, pre-2019=1
• Policy / legislation / public health — medium decay: 2024=10, 2022=8, 2020=6, 2018=4, pre-2016=2
• Social science / theory / historical analysis — slow decay: within 10 years=8+, within 20 years=5+
• No date present in cite → 0

--- SOURCE (0–10): publication quality ---
Peer-reviewed journal → 9–10
Government report (CRS, CBO, GAO, RAND, IPCC, official agency) → 8–9
Established think tank (Brookings, CSIS, Chatham House, CFR, Wilson Center) → 7–8
Ideologically-aligned think tank (Heritage, CATO, CAP, AEI) → 5–6
Major newspaper / wire service news article (NYT, WaPo, FT, Economist, AP) → 5–6
Trade publication / specialized magazine → 4–5
Op-ed, magazine essay, or editorial → 3–4
Personal blog, advocacy website, or unknown outlet → 1–2
Source entirely absent from the cite → 0

--- CLAIM MATCH (0–10): does the cited source actually support what the TAG claims? ---
Judge based on logical fit between the tag text and the cite's apparent subject:
• 10 — cite directly proves the exact claim in the tag
• 7 — cite is related and supports the general argument; tag may be slightly overextended
• 4 — cite is tangentially related; tag makes a stronger claim than the source likely supports
• 1 — obvious mismatch; the source topic does not support the tag's claim
Note: you cannot read the full card body — judge from how specific/bold the tag claim is vs what the cite suggests about the source's scope.

Then give:
- "score": overall credibility 0–10 (holistic — weigh all four factors)
- "verdict": exactly one word — "Strong" (8–10), "Solid" (6–7), "Shaky" (4–5), or "Weak" (0–3)
- "reason": 12 words or fewer — the single most important credibility factor (good or bad)
- "press": 15 words or fewer — the sharpest cross-ex attack on THIS card's credibility specifically

Cards:
${cardLines}

Return ONLY a JSON array of exactly ${list.length} objects in the SAME ORDER as above. No markdown, no preamble:
[{"score":7,"verdict":"Solid","author":6,"recency":8,"source":7,"claim":7,"reason":"...","press":"..."}]`;

    const raw = await callAI(prompt, 'balanced');
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error('Unexpected AI response shape.');

    const clamp = (n: any) => Math.max(0, Math.min(10, Math.round(Number(n))));
    const verdictFor = (s: number) => s >= 8 ? 'Strong' : s >= 6 ? 'Solid' : s >= 4 ? 'Shaky' : 'Weak';
    const scores = list.map((_c, i) => {
      const r = parsed[i] ?? {};
      const score = Number.isFinite(Number(r.score)) ? clamp(r.score) : 0;
      const verdict = ['Strong', 'Solid', 'Shaky', 'Weak'].includes(r.verdict) ? r.verdict : verdictFor(score);
      return {
        score,
        verdict,
        author: Number.isFinite(Number(r.author)) ? clamp(r.author) : 0,
        recency: Number.isFinite(Number(r.recency)) ? clamp(r.recency) : 0,
        source: Number.isFinite(Number(r.source)) ? clamp(r.source) : 0,
        claim: Number.isFinite(Number(r.claim)) ? clamp(r.claim) : 0,
        reason: typeof r.reason === 'string' ? r.reason.slice(0, 160) : '',
        press: typeof r.press === 'string' ? r.press.slice(0, 200) : '',
      };
    });
    return { ok: true, scores };
  } catch (e: any) {
    const msg = e?.message === 'NO_KEY'
      ? 'No AI API key configured — add one in Settings.'
      : (e?.message ?? 'Failed to score cards');
    return { ok: false, error: msg };
  }
});

// ─── Impact calculus comparator ───────────────────────────────────────────────

ipcMain.handle('gemini:compareImpacts', async (
  _e,
  pathA: string,
  pathB: string,
  labelA: string,
  labelB: string,
) => {
  try {
    const mammoth = require('mammoth');
    const rawA = (await mammoth.extractRawText({ path: pathA })).value as string;
    const rawB = (await mammoth.extractRawText({ path: pathB })).value as string;
    const textA = rawA.slice(0, 40000);
    const textB = rawB.slice(0, 40000);

    const prompt = `You are an expert policy debate judge performing impact calculus — the process of comparing the relative importance of harms from two opposing sides.

IMPACT CALCULUS CRITERIA
Impact calculus typically weighs harms across five dimensions (debaters may argue alternative orderings):
1. Magnitude — how severe is the harm? (extinction > existential > major > moderate > minor)
2. Probability — how likely is the harm to occur? (high / medium / low)
3. Timeframe — how soon does the harm materialize? (immediate / short / medium / long)
4. Reversibility — can the harm be undone? (irreversible > difficult > reversible)
5. Breadth — how many people or systems are affected? (describe in context)

A common default hierarchy is: magnitude first, then probability, then timeframe, then reversibility. However, debaters can and do flip this ordering with warrants.

YOUR TASK
Below are two debate documents. Extract every distinct impact claim from each, compare them across the five dimensions above, identify the direct clashes between them, decide who wins each clash with explicit reasoning, and give an overall verdict on which side has the better impacts.

DOC A: ${labelA}
---
${textA}
---

DOC B: ${labelB}
---
${textB}
---

Return ONLY valid JSON — no markdown fences, no extra text, no commentary — matching this exact shape:
{
  "summary": "<2-3 sentence overall verdict synthesizing the impact comparison>",
  "docA": {
    "label": "${labelA}",
    "impacts": [
      {
        "claim": "<short description of the impact>",
        "magnitude": "<extinction|existential|major|moderate|minor>",
        "probability": "<high|medium|low>",
        "timeframe": "<immediate|short|medium|long>",
        "reversibility": "<irreversible|difficult|reversible>"
      }
    ]
  },
  "docB": {
    "label": "${labelB}",
    "impacts": [
      {
        "claim": "<short description of the impact>",
        "magnitude": "<extinction|existential|major|moderate|minor>",
        "probability": "<high|medium|low>",
        "timeframe": "<immediate|short|medium|long>",
        "reversibility": "<irreversible|difficult|reversible>"
      }
    ]
  },
  "clashes": [
    {
      "claimA": "<impact claim from Doc A, or null if no direct clash>",
      "claimB": "<impact claim from Doc B, or null if no direct clash>",
      "winner": "<A|B|even>",
      "reasoning": "<concise explanation of why this side wins this clash>",
      "dimension": "<the primary dimension that decides this clash, e.g. magnitude, probability, timeframe>"
    }
  ],
  "verdict": "<A|B|even>",
  "verdictReason": "<1-2 sentence explanation of the overall verdict>"
}`;

    const raw = await callAI(prompt, 'best');
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim();
    let result: any;
    try {
      result = JSON.parse(cleaned);
    } catch {
      return { ok: false, error: 'parse_failed' };
    }
    return { ok: true, result };
  } catch (e: any) {
    const msg = e?.message === 'NO_KEY'
      ? 'No AI API key configured — add one in Settings.'
      : (e?.message ?? 'Failed to compare impacts');
    return { ok: false, error: msg };
  }
});

// ─── Flow-sheet import AI fallback ─────────────────────────────────────────────
// When the deterministic importer can't recognize a spreadsheet's layout, the
// renderer sends the raw cell grid here and the AI maps it onto the app's fixed
// debate-flow column schema (policy = 7 cols, pf = 8 cols).
ipcMain.handle('gemini:importFlow', async (
  _e,
  input: { event: 'policy' | 'pf' | null; sheets: { name: string; grid: string[][] }[] },
) => {
  try {
    const sheetsIn = Array.isArray(input?.sheets) ? input.sheets : [];
    if (sheetsIn.length === 0) return { ok: false, error: 'no_sheets' };

    // Build a size-capped JSON view of each sheet: max 60 data rows + ~12000 chars.
    const sheetBlocks = sheetsIn.map((s) => {
      const name = String(s?.name ?? '');
      const grid = Array.isArray(s?.grid) ? s.grid : [];
      const capped = grid.slice(0, 60).map((row) =>
        (Array.isArray(row) ? row : []).map((c) => String(c ?? '')),
      );
      let json = JSON.stringify(capped);
      if (json.length > 12000) json = json.slice(0, 12000);
      return `SHEET "${name}":\n${json}`;
    }).join('\n\n');

    const eventInstruction = input?.event
      ? `The caller's best guess for the event is "${input.event}". Use that event.`
      : `The event is unknown. Infer whether this is policy or pf from the column labels and content. Default to policy if unclear.`;

    const prompt = `You are importing a competitive debate "flow" — a spreadsheet a debater uses to track arguments across the speeches of a round. Spreadsheets come in messy, arbitrary layouts (different column orders, extra columns, merged speeches, varied headers). Your job is to map each one onto a FIXED column schema so the app can display it.

TARGET COLUMN SCHEMAS (output cells must align to these exact columns, in this exact order):
• policy — 7 columns: ["1AC","1NC","2AC","2NC/1NR","1AR","2NR","2AR"]
• pf — 8 columns: ["Pro Case","Con Case","Con Rebuttal","Pro Rebuttal","Pro Summary","Con Summary","Pro FF","Con FF"]

CRITICAL POLICY MERGE RULE:
Real policy debate has 8 speeches — 1AC, 1NC, 2AC, 2NC, 1NR, 1AR, 2NR, 2AR. This app MERGES the 2NC and 1NR (the "neg block") into the single column "2NC/1NR" (index 3). If the source spreadsheet has SEPARATE 2NC and 1NR columns (or any column labeled "block" / "neg block"), COMBINE their cell contents for each row into that one column, joining the two cells with a newline ("\\n"). Never emit separate 2NC and 1NR columns.

EVENT:
${eventInstruction}

SOURCE SHEETS (raw cell grids as 2D arrays of strings; header row included if the sheet has one):
${sheetBlocks}

INSTRUCTIONS:
1. Detect any header row and DROP it — output ONLY argument rows, never the header.
2. Preserve the relative top-to-bottom order of the argument rows.
3. Each output row must have EXACTLY the right number of columns (7 for policy, 8 for pf). Use an empty string "" for any blank/missing cell.
4. Map each source column to the target column it best corresponds to. If a source column doesn't map to any target column, ignore it.
5. Apply the policy merge rule above when relevant.

Return ONLY valid JSON — no markdown fences, no commentary — matching this exact shape:
{"event":"policy","sheets":[{"name":"<sheet name>","rows":[["...","...","...","...","...","...","..."]]}]}`;

    const raw = await callAI(prompt, 'best');
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/m, '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { ok: false, error: 'parse_failed' };
    }

    const event: 'policy' | 'pf' = parsed?.event === 'pf' ? 'pf' : 'policy';
    const colCount = event === 'pf' ? 8 : 7;
    const outSheets = (Array.isArray(parsed?.sheets) ? parsed.sheets : []).map((s: any) => {
      const rows = (Array.isArray(s?.rows) ? s.rows : []).slice(0, 60).map((row: any) => {
        const cells = (Array.isArray(row) ? row : []).map((c: any) => String(c ?? ''));
        // Pad/truncate to the exact target column count.
        while (cells.length < colCount) cells.push('');
        return cells.slice(0, colCount);
      });
      return { name: String(s?.name ?? ''), rows };
    });

    return { ok: true, event, sheets: outSheets };
  } catch (e: any) {
    const msg = e?.message === 'NO_KEY'
      ? 'No AI API key configured — add one in Settings.'
      : (e?.message ?? 'Failed to import flow');
    return { ok: false, error: msg };
  }
});

// OpenCaselist — return { ok, data, error } so renderer can inspect without IPC error serialization issues
ipcMain.handle('opencaselist:login', async (_e, username: string, password: string) => {
  try { await ocLogin(username, password); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('opencaselist:caselists', async () => {
  try {
    const data = await ocFetch('/caselists');
    const list: any[] = Array.isArray(data) ? data : data?.caselists ?? [];
    return { ok: true, data: list };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('opencaselist:search', async (_e, query: string, shard: string) => {
  try {
    // Resolve the base shard name (e.g. 'hspolicy') to the actual caselist slug (e.g. 'hspolicy25')
    const resolvedShard = await resolveShardName(shard);
    console.log(`[warroom] OC search: shard=${shard} → resolved=${resolvedShard}`);

    // 1. Try the dedicated search endpoint first
    const searchData = await ocFetch('/search', { q: query, shard: resolvedShard });
    console.log('[warroom] OC /search:', JSON.stringify(searchData).slice(0, 300));
    const searchList = Array.isArray(searchData) ? searchData : searchData?.teams ?? searchData?.results ?? [];
    if (searchList.length > 0) return { ok: true, data: searchList };

    // 2. Fallback: fetch all schools in the caselist and filter client-side
    console.log('[warroom] OC /search empty, fetching schools…');
    const schoolsData = await ocFetch(`/caselists/${resolvedShard}/schools`);
    console.log('[warroom] OC /schools:', JSON.stringify(schoolsData).slice(0, 300));
    const allSchools: any[] = Array.isArray(schoolsData) ? schoolsData : schoolsData?.schools ?? [];
    const q = query.toLowerCase().trim();
    const filtered = allSchools.filter((s: any) => {
      const name = (s.displayName ?? s.name ?? s.school ?? s.schoolSlug ?? '').toLowerCase();
      const slug = (s.schoolSlug ?? s.slug ?? '').toLowerCase();
      return name.includes(q) || slug.includes(q);
    });
    console.log(`[warroom] school filter: ${filtered.length} of ${allSchools.length}`);
    if (filtered.length > 0) return { ok: true, data: filtered };

    // 3. If still nothing, return the raw school list so user can see what's there
    if (allSchools.length > 0) return { ok: true, data: allSchools.slice(0, 50) };

    return { ok: false, error: resolvedShard !== shard
      ? `No schools found in caselist "${resolvedShard}". Check your OpenCaselist credentials in Settings.`
      : `No schools found. Make sure you are logged in via Settings — go to Settings and enter your opencaselist.com credentials.`
    };
  }
  catch (e: any) {
    console.error('[warroom] OC search error:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('opencaselist:rounds', async (_e, caselist: string, school: string, team: string) => {
  try {
    const resolved = await resolveShardName(caselist);
    console.log(`[warroom] OC rounds: ${resolved}/schools/${school}/teams/${team}`);
    const data = await ocFetch(`/caselists/${resolved}/schools/${school}/teams/${team}/rounds`);
    console.log(`[warroom] OC rounds result: ${JSON.stringify(data).slice(0, 200)}`);
    return { ok: true, data };
  }
  catch (e: any) { console.error('[warroom] OC rounds error:', e.message); return { ok: false, error: e.message }; }
});

ipcMain.handle('opencaselist:cites', async (_e, caselist: string, school: string, team: string) => {
  try {
    const resolved = await resolveShardName(caselist);
    const data = await ocFetch(`/caselists/${resolved}/schools/${school}/teams/${team}/cites`);
    return { ok: true, data };
  }
  catch (e: any) { return { ok: false, error: e.message }; }
});

// Opens a disclosed file: HTTP(S) URLs open in the browser; server paths go through the download endpoint.
ipcMain.handle('opencaselist:openFile', async (_e, urlOrPath: string) => {
  try {
    const target = /^https?:\/\//i.test(urlOrPath)
      ? urlOrPath
      : `https://api.opencaselist.com/v1/download?path=${encodeURIComponent(urlOrPath)}`;
    // Never hand a non-web scheme (file:, javascript:, etc.) to the OS browser.
    if (!/^https?:\/\//i.test(target)) return { ok: false, error: 'Invalid URL' };
    await shell.openExternal(target);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

// Downloads a disclosed file to a temp path so the renderer can parse and display it in-app.
ipcMain.handle('opencaselist:fetchFileToTemp', async (_e, urlOrPath: string) => {
  try {
    const downloadUrl = /^https?:\/\//i.test(urlOrPath)
      ? urlOrPath
      : `https://api.opencaselist.com/v1/download?path=${encodeURIComponent(urlOrPath)}`;

    const headers: Record<string, string> = { Accept: '*/*' };
    if (ocCookie) headers['Cookie'] = ocCookie;

    const res = await fetch(downloadUrl, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const cd = res.headers.get('content-disposition') ?? '';
    const fnMatch = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    let filename = fnMatch ? fnMatch[1].replace(/['"]/g, '').trim() : '';
    if (!filename) {
      const urlPart = downloadUrl.split('?')[0].split('/').pop() ?? 'speech-doc';
      filename = decodeURIComponent(urlPart);
    }
    if (!filename.match(/\.\w+$/)) filename += '.docx';

    const tmpDir = join(app.getPath('temp'), 'warroom');
    await fs.mkdir(tmpDir, { recursive: true });
    const safe = filename.replace(/[^a-z0-9._-]/gi, '_');
    const tempPath = join(tmpDir, `oc_${Date.now()}_${safe}`);
    await fs.writeFile(tempPath, buffer);
    trustPath(tempPath);

    return { ok: true, tempPath, filename, downloadUrl };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

// Saves a temp file to a user-chosen location via a save dialog.
ipcMain.handle('opencaselist:saveFile', async (_e, tempPath: string, defaultName: string) => {
  try {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.copyFile(tempPath, result.filePath);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});


// Returns raw file bytes as base64 so the renderer can pass them to docx-preview.
// Every path must be trusted — opened via a dialog, handed to us by the OS through
// an "open with" association, or generated by the app in its temp dir. This stops a
// compromised renderer from reading arbitrary files.
ipcMain.handle('fs:readFileBytes', async (_e, filePath: string) => {
  try {
    checkPath(filePath);
    const buf = await fs.readFile(filePath);
    return { ok: true, base64: buf.toString('base64') };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

// Reads a .docx for the speech-doc viewer. The path must be trusted — opened via a
// dialog, handed to us by the OS through an "open with" association, or generated by
// the app in its temp dir. Recents pass because a doc only enters the recents list
// after it was first opened through the file dialog (which trusts + persists it), so
// the trust survives restarts. This used to skip the check and even auto-trust the
// caller's path, which let a compromised renderer read any document on disk and then
// permanently whitelist arbitrary paths for every other file channel.
ipcMain.handle('fs:readDocxBytes', async (_e, filePath: string) => {
  try {
    if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.docx')) {
      return { ok: false, error: 'Only .docx files are allowed' };
    }
    checkPath(filePath);
    const buf = await fs.readFile(filePath);
    return { ok: true, base64: buf.toString('base64') };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('shell:openPath', async (_e, filePath: string) => {
  checkPath(filePath);
  const err = await shell.openPath(filePath);
  return { ok: !err, error: err || undefined };
});

ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  // Only allow http/https URLs
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Invalid URL' };
  await shell.openExternal(url);
  return { ok: true };
});


// ─── Debate Land ──────────────────────────────────────────────────────────────
// debate.land is a Next.js App Router site. Team data (with IDs and stats) is
// embedded in the RSC payload of the server-rendered HTML. The leaderboard
// accepts a ?search= param for server-side filtering. No separate team page
// fetch is needed — all stats are in the leaderboard RSC payload.

type DLEventType = 'policy' | 'pf' | 'ld';

const DL_BASE_URLS: Record<DLEventType, string[]> = {
  policy: [
    'https://www.debate.land/datasets/2026-national-varsity-policy/leaderboard',
    'https://www.debate.land/datasets/2025-national-varsity-policy/leaderboard',
    'https://www.debate.land/datasets/2024-national-varsity-policy/leaderboard',
  ],
  pf: [
    'https://www.debate.land/datasets/2026-national-varsity-public-forum/leaderboard',
    'https://www.debate.land/datasets/2025-national-varsity-public-forum/leaderboard',
    'https://www.debate.land/datasets/2024-national-varsity-public-forum/leaderboard',
  ],
  ld: [
    'https://www.debate.land/datasets/2026-national-varsity-lincoln-douglas/leaderboard',
    'https://www.debate.land/datasets/2025-national-varsity-lincoln-douglas/leaderboard',
    'https://www.debate.land/datasets/2024-national-varsity-lincoln-douglas/leaderboard',
  ],
};

// Cache: eventType → { baseUrl, teams } so we know which dataset slug to use in team URLs
const dlCache: Partial<Record<DLEventType, { baseUrl: string; teams: any[] }>> = {};

function parseRSCTeams(html: string): any[] {
  // debate.land embeds team data in Next.js RSC payload as:
  // self.__next_f.push([1, "...JSON-escaped string...""])
  // The JSON contains: {"count":N,"data":[{teamId, otr, bids, ...team.aliases},...]}
  const scriptRe = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const escaped = m[1];
    if (!escaped.includes('teamId')) continue;
    try {
      const payload: string = JSON.parse('"' + escaped + '"');
      const dataIdx = payload.indexOf('"data":[{');
      if (dataIdx < 0) continue;
      const arrPart = payload.slice(dataIdx + 7);
      let depth = 0, end = 0;
      for (let i = 0; i < arrPart.length; i++) {
        const c = arrPart[i];
        if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') { if (--depth === 0) { end = i + 1; break; } }
      }
      const teams = JSON.parse(arrPart.slice(0, end));
      if (Array.isArray(teams) && teams.length > 0 && teams[0].teamId) return teams;
    } catch (_) { continue; }
  }
  return [];
}

function teamRowToStats(t: any, baseUrl: string, eventType: DLEventType): Record<string, any> {
  const slug = baseUrl.split('/datasets/')[1]?.split('/')[0] ?? '';
  const debateLandUrl = `https://www.debate.land/teams/${t.teamId}/${slug}`;

  const pW = t.prelimWins ?? 0;
  const pL = t.prelimLosses ?? 0;
  const eW = t.elimWins ?? 0;
  const eL = t.elimLosses ?? 0;

  const pct = (v: number | null | undefined) =>
    v != null ? `${(v * 100).toFixed(1)}%` : null;

  return {
    source: 'debate.land',
    event: eventType,
    debateLandUrl,
    careerOTR: t.otr ?? null,
    peakRank: t.ranking?.[0]?.rank ?? null,
    avgSpeaks: t.avgSpks != null ? Math.round(t.avgSpks * 10) / 10 : null,
    avgStdSpeaks: t.stdSpks != null ? Math.round(t.stdSpks * 100) / 100 : null,
    totalRounds: t.rounds ?? null,
    totalBids: t.bids ?? null,
    avgOpWpM: pct(t.statistics?.avgOpWpM),
    prelimWinPct: pct(t.pwp ?? t.statistics?.pWp),
    avgBreakPct: null,
    avgTrueWinPct: pct(t.twp),
    totalRecord: `${pW + eW}-${pL + eL}`,
    prelimRecord: `${pW}-${pL}`,
    lastFetched: new Date().toISOString(),
  };
}

async function fetchDLLeaderboard(
  eventType: DLEventType,
  searchQuery?: string,
): Promise<{ baseUrl: string; teams: any[] } | null> {
  const reqHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  };

  const fetchHtml = (url: string): Promise<string> => new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET', headers: reqHeaders },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
        let body = ''; res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(body));
      },
    );
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });

  for (const baseUrl of DL_BASE_URLS[eventType]) {
    try {
      const url = searchQuery
        ? `${baseUrl}?search=${encodeURIComponent(searchQuery)}`
        : baseUrl;
      const html = await fetchHtml(url);
      const teams = parseRSCTeams(html);
      if (teams.length > 0) return { baseUrl, teams };
    } catch (_) { continue; }
  }
  return null;
}

ipcMain.handle('dl-search-team', async (_e, { query, eventType }: { query: string; eventType: DLEventType }) => {
  console.log('[DL] search-team', { query, eventType });
  try {
    const result = await fetchDLLeaderboard(eventType, query);
    console.log('[DL] search-team result', result ? `${result.teams.length} teams from ${result.baseUrl}` : 'null');
    if (!result || result.teams.length === 0) {
      // Fallback: fuzzy-match against cached full leaderboard if available
      const cached = dlCache[eventType];
      if (!cached) return { success: true, results: [] };
      const fuse = new Fuse(cached.teams, { keys: ['team.aliases.0.code', 'team.aliases'], threshold: 0.4 });
      const hits = fuse.search(query).slice(0, 5).map((r) => {
        const t = r.item;
        const name = t.team?.aliases?.[0]?.code ?? t.teamId;
        return { name, teamId: t.teamId, otr: t.otr, totalRecord: null, speaks: t.avgSpks, bids: t.bids, event: eventType };
      });
      return { success: true, results: hits };
    }

    // Cache the base URL for team page link construction
    if (!dlCache[eventType]) dlCache[eventType] = result;

    const results = result.teams.slice(0, 5).map((t) => {
      const pW = t.prelimWins ?? 0, pL = t.prelimLosses ?? 0;
      const eW = t.elimWins ?? 0, eL = t.elimLosses ?? 0;
      return {
        name: t.team?.aliases?.[0]?.code ?? t.teamId,
        teamId: t.teamId,
        otr: t.otr ?? null,
        totalRecord: `${pW + eW}-${pL + eL}`,
        speaks: t.avgSpks != null ? Math.round(t.avgSpks * 10) / 10 : null,
        bids: t.bids ?? null,
        event: eventType,
      };
    });

    return { success: true, results };
  } catch (e: any) {
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('dl-get-team-stats', async (_e, { teamId, eventType }: { teamId: string; eventType: DLEventType }) => {
  try {
    // Find the team in cache first
    const cached = dlCache[eventType];
    const cachedTeam = cached?.teams.find((t: any) => t.teamId === teamId);
    if (cachedTeam) {
      const stats = teamRowToStats(cachedTeam, cached!.baseUrl, eventType);
      const name = cachedTeam.team?.aliases?.[0]?.code ?? teamId;
      return { success: true, stats, name };
    }

    // Re-fetch by searching for teamId (fallback)
    const result = await fetchDLLeaderboard(eventType);
    if (result) {
      dlCache[eventType] = result;
      const team = result.teams.find((t: any) => t.teamId === teamId);
      if (team) {
        const stats = teamRowToStats(team, result.baseUrl, eventType);
        const name = team.team?.aliases?.[0]?.code ?? teamId;
        return { success: true, stats, name };
      }
    }

    return { success: false, error: 'Team stats page unavailable for this team' };
  } catch (e: any) {
    return { success: false, error: (e as Error).message };
  }
});

// ─── Tabroom Private API ──────────────────────────────────────────────────────

const TABROOM_BASE = 'https://api.tabroom.com/v1';

// Isolated Electron session for tabroom.com scraping. Keeping these requests off
// `defaultSession` prevents stale cookies (from prior runs, or from other modules
// poking tabroom.com) from triggering 302 chains that Electron's net stack cancels
// with "Redirect was cancelled". Cookies are persisted across runs in this partition
// so our manually-managed login cookie still works.
let _tbSession: Electron.Session | null = null;
function tbNetSession(): Electron.Session {
  if (_tbSession) return _tbSession;
  _tbSession = session.fromPartition('persist:tabroom-net', { cache: false });
  return _tbSession;
}
async function tbResetSessionCookies() {
  try {
    const s = tbNetSession();
    const cookies = await s.cookies.get({ domain: 'tabroom.com' });
    await Promise.all(
      cookies.map((c) =>
        s.cookies.remove(
          `${c.secure ? 'https' : 'http'}://${c.domain?.replace(/^\./, '') ?? 'tabroom.com'}${c.path ?? '/'}`,
          c.name,
        ).catch(() => {}),
      ),
    );
  } catch {}
}

ipcMain.handle('tabroom-get-tournament', async (_e, { tournId }: { tournId: string }) => {
  try {
    const res = await fetch(`${TABROOM_BASE}/tourn/index?tourn_id=${encodeURIComponent(tournId)}`);
    if (res.status === 401 || res.status === 403) return { success: false, error: 'PRIVATE' };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { success: true, data };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('tabroom-get-entries', async (_e, { tournId, eventId }: { tournId: string; eventId: string }) => {
  try {
    const res = await fetch(`${TABROOM_BASE}/tourn/entries/list?tourn_id=${encodeURIComponent(tournId)}&event_id=${encodeURIComponent(eventId)}`);
    if (res.status === 401 || res.status === 403) return { success: false, error: 'PRIVATE' };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { success: true, data: Array.isArray(data) ? data : [] };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('tabroom-get-pairings', async (_e, { tournId, eventId, roundId }: { tournId: string; eventId: string; roundId: string }) => {
  try {
    const res = await fetch(`${TABROOM_BASE}/tourn/results/round?tourn_id=${encodeURIComponent(tournId)}&event_id=${encodeURIComponent(eventId)}&round_id=${encodeURIComponent(roundId)}`);
    if (res.status === 401 || res.status === 403) return { success: false, error: 'PRIVATE' };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { success: true, data: Array.isArray(data) ? data : [] };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

// Fetch article text from a URL (used by agent fetch_article tool)
ipcMain.handle('agent:fetchArticle', async (_e, url: string) => {
  if (!url || typeof url !== 'string') return { ok: false, error: 'No URL provided', text: '' };
  try {
    const res = await safePublicFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Warroom/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, text: '' };
    const html = await res.text();
    // Strip HTML tags and collapse whitespace to get readable plain text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 20000); // cap at 20k chars to stay within context
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, error: e.message, text: '' };
  }
});

// Skills IPC
ipcMain.handle('skills:list', async () => {
  try { return { ok: true, skills: await listSkills() }; }
  catch (e: any) { return { ok: false, error: e.message, skills: [] }; }
});

ipcMain.handle('skills:read', async (_e, name: string) => {
  try {
    const content = await readSkill(name);
    if (content === null) return { ok: false, error: `Skill "${name}" not found.`, content: '' };
    return { ok: true, content };
  } catch (e: any) { return { ok: false, error: e.message, content: '' }; }
});

ipcMain.handle('skills:write', async (_e, name: string, content: string) => {
  const safeName = (name ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80);
  if (!safeName) return { ok: false, error: 'Skill name is required.' };
  const BUILTIN = new Set(['cx_debate','pf_debate','ld_debate','card_cutting','user_manual','documentation','skill_builder','flowing']);
  if (BUILTIN.has(safeName)) return { ok: false, error: `"${safeName}" is a built-in skill and cannot be overwritten. Choose a different name.` };
  try {
    await ensureUserSkillsDir();
    const skillPath = join(userSkillsDir(), `${safeName}.md`);
    await fs.writeFile(skillPath, content, 'utf8');
    return { ok: true, name: safeName, path: skillPath, sizeBytes: Buffer.byteLength(content, 'utf8') };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

// Search Tabroom for tournaments by name (used by agent tool)
ipcMain.handle('tabroom:searchTournaments', async (_e, query: string) => {
  if (!query || typeof query !== 'string') return { ok: false, error: 'No query provided', results: [] };
  try {
    // Tabroom API v1 — filter by name and only show recent/upcoming tournaments
    const year = new Date().getFullYear();
    const url = `${TABROOM_BASE}/tourn/index?name=${encodeURIComponent(query.trim())}&start=${year - 1}-01-01`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Tabroom API returned ${res.status}`);
    const raw = await res.json();
    const list: any[] = Array.isArray(raw) ? raw : (raw?.tournaments ?? raw?.results ?? []);
    return {
      ok: true,
      results: list.slice(0, 12).map((t: any) => ({
        id:       String(t.id ?? t.tourn_id ?? ''),
        name:     t.name ?? '',
        start:    t.start ?? '',
        end:      t.end   ?? '',
        location: [t.city, t.state].filter(Boolean).join(', '),
        circuit:  t.circuit ?? '',
      })),
    };
  } catch (e: any) {
    return { ok: false, error: e.message, results: [] };
  }
});

ipcMain.handle('tabroom-fetch-tournament', async (_e, { tournId }: { tournId: string }) => {
  try {
    const url = `https://www.tabroom.com/api/download_data.mhtml?tourn_id=${tournId}`;
    const res = await fetch(url);
    if (!res.ok) return { success: false, error: `Tabroom returned ${res.status}` };
    const data = await res.json();
    return {
      success: true,
      tournament: {
        name: data.name ?? null,
        start: data.start ?? null,
        end: data.end ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        events: data.events ?? [],
        tabroom_id: String(tournId),
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

async function tryAutoLoginOC() {
  const u = await getSecure('oc_username');
  const p = await getSecure('oc_password');
  if (u && p) {
    try { await ocLogin(u, p); console.log('[warroom] OpenCaselist auto-login OK'); }
    catch (e) { console.warn('[warroom] OpenCaselist auto-login failed:', e); }
  }
}

// ─── Tabroom Monitor ──────────────────────────────────────────────────────────
// Polls tabroom.com/api/download_data.mhtml every 60 s when active.
// No credentials needed — download_data is a public API.
// The user provides their entry code (e.g. "Emery BL") per tournament so we
// can find their row in the pairings.

interface TbMonitorState {
  dbTournamentId: string;
  tabroomTournId: string;
  tournamentName: string;
  eventName: string;
  entryCode: string;       // e.g. "Emery BL"
  caselist: string;        // e.g. "hspolicy"
  eventType: DLEventType;  // for Debate Land lookups
}

interface TbPairing {
  roundNumber: number;
  roundId: string;
  room: string | null;
  time: string | null;
  side: 'aff' | 'neg' | null;
  opponentCode: string;
  judgeName: string | null;
  judgeId: string | null;
  isBye: boolean;
}

let tbMonitorState: TbMonitorState | null = null;
let tbMonitorTimer: ReturnType<typeof setInterval> | null = null;
// Round IDs already processed this session (prevents duplicate notifications on poll)
const tbSeenRoundIds = new Set<string>();

function tbStop() {
  if (tbMonitorTimer) { clearInterval(tbMonitorTimer); tbMonitorTimer = null; }
  tbMonitorState = null;
  tbSeenRoundIds.clear();
  mainWin?.webContents.send('tabroom:monitor:stopped');
}

async function tbFetchData(tabroomTournId: string): Promise<any> {
  const res = await fetch(
    `https://www.tabroom.com/api/download_data.mhtml?tourn_id=${encodeURIComponent(tabroomTournId)}`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' } },
  );
  if (!res.ok) throw new Error(`Tabroom API ${res.status}`);
  return res.json();
}

function tbExtractPairings(data: any, entryCode: string): TbPairing[] {
  const myCode = entryCode.toLowerCase().trim();
  const pairings: TbPairing[] = [];
  const events: any[] = data?.events ?? [];

  for (const ev of events) {
    const rounds: any[] = ev?.rounds ?? [];
    for (const round of rounds) {
      // Only process posted rounds
      if (round.posted === false || round.posted === 0 || round.posted === '0') continue;

      const roundNum = Number(round.roundNum ?? round.round_num ?? round.number ?? 0);
      const roundId = String(round.round_id ?? round.id ?? `${ev.event_id ?? 'ev'}-${roundNum}`);
      const roundTime: string | null = round.start ?? round.time ?? null;

      const panels: any[] = round.panels ?? [];
      for (const panel of panels) {
        // Gather entries — may be at panel level or nested in flights
        const allEntries: any[] = [];
        const flights: any[] = panel.flights ?? [];
        if (flights.length > 0) {
          for (const fl of flights) {
            allEntries.push(...(fl.entries ?? fl.teams ?? []));
          }
        } else {
          allEntries.push(...(panel.entries ?? panel.teams ?? []));
        }

        // Find the user's entry by code (flexible matching)
        const mine = allEntries.find((e: any) => {
          const ec = String(e.code ?? e.entry_code ?? e.Code ?? e.name ?? '').toLowerCase().trim();
          return ec === myCode || (ec.length > 2 && myCode.includes(ec)) || (myCode.length > 2 && ec.includes(myCode));
        });
        if (!mine) continue;

        // Side: 1 = Aff, 2 = Neg (also accept string forms)
        const rawSide = mine.side ?? mine.Side ?? mine.sidenum;
        let side: 'aff' | 'neg' | null = null;
        if (rawSide === 1 || /^aff/i.test(String(rawSide))) side = 'aff';
        else if (rawSide === 2 || /^neg/i.test(String(rawSide))) side = 'neg';

        // Opponent
        const opp = allEntries.find((e: any) => {
          const ec = String(e.code ?? e.entry_code ?? e.Code ?? e.name ?? '').toLowerCase().trim();
          return ec !== myCode && !(ec.length > 2 && myCode.includes(ec));
        });
        const opponentCode = opp
          ? String(opp.code ?? opp.entry_code ?? opp.Code ?? opp.name ?? 'Unknown')
          : 'Unknown';
        const isBye = !opp || /\bbye\b/i.test(opponentCode);

        // Judge
        const judges: any[] = panel.judges ?? [];
        const j = judges[0];
        const judgeName: string | null = j ? (String(j.name ?? j.last ?? j.Name ?? '').trim() || null) : null;
        const judgeId: string | null = j ? (String(j.id ?? j.judge_id ?? j.Id ?? '').trim() || null) : null;

        // Room
        const room: string | null = String(panel.room ?? panel.roomName ?? panel.room_name ?? '').trim() || null;

        pairings.push({ roundNumber: roundNum, roundId, room, time: roundTime, side, opponentCode, judgeName, judgeId, isBye });
      }
    }
  }
  return pairings;
}

type JudgeRound = {
  tournament: string; date: string; level: string;
  event: string; round: string; aff: string; neg: string;
  vote: string; result: string;
};

async function tbFetchJudgeData(personId: string): Promise<{ paradigm: string | null; record: JudgeRound[]; lastReviewedAt: string | null }> {
  const cookie = await tbGetSessionCookie();
  try {
    const res = await tbNetSession().fetch(
      `https://www.tabroom.com/index/paradigm.mhtml?judge_person_id=${encodeURIComponent(personId)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
    );
    if (res.url.includes('login')) { tbSessionCookie = null; return { paradigm: null, record: [], lastReviewedAt: null }; }
    const html = await res.text();

    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '');

    const cellText = (s: string) =>
      s.replace(/<[^>]+>/g, ' ')
       .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/\s{2,}/g, ' ').trim();

    // ── Paradigm extraction ────────────────────────────────────────────────
    // Text lives between "Paradigm Statement" heading and "Full Judging Record"
    // (or the NSDA disclaimer if there is no record section).
    const fullText = cellText(clean);
    const STMT_MARKER   = 'Paradigm Statement';
    const RECORD_MARKER = 'Full Judging Record';
    const DISC_MARKER   = 'The paradigms published on Tabroom.com';

    const stmtIdx   = fullText.indexOf(STMT_MARKER);
    const recordIdx = fullText.indexOf(RECORD_MARKER);
    const discIdx   = fullText.indexOf(DISC_MARKER);

    // Stop paradigm extraction at "Full Judging Record" if present, else at disclaimer.
    const endIdx = (recordIdx > stmtIdx && recordIdx > 0) ? recordIdx : discIdx;

    // Extract "Last reviewed on …" timestamp — used to detect paradigm updates.
    const reviewedM = fullText.match(/Last reviewed on\b(.{5,60}?\b(?:PDT|PST|MDT|MST|CDT|CST|EDT|EST|UTC)\b)/i);
    const lastReviewedAt: string | null = reviewedM ? reviewedM[1].trim() : null;

    let paradigm: string | null = null;
    if (stmtIdx >= 0 && endIdx > stmtIdx) {
      let between = fullText.slice(stmtIdx + STMT_MARKER.length, endIdx).trim();
      // Remove "Last reviewed on [Day] [Month] [DD], [YYYY] at [H]:[MM] [AM/PM] [TZ]"
      // Match tightly: stops at the timezone abbreviation so we never eat paradigm text.
      between = between.replace(/Last reviewed on\b.{0,60}?\b(?:PDT|PST|MDT|MST|CDT|CST|EDT|EST|UTC)\b\s*/i, '').trim();
      if (between.length > 10) paradigm = between.slice(0, 4000);
    }

    // ── Judging record extraction ──────────────────────────────────────────
    // Parse <table id="judgerecord"> rows. Each <tr> after the header has 9 <td> cells.
    const record: JudgeRound[] = [];
    const tableM = clean.match(/<table[^>]*id="judgerecord"[^>]*>([\s\S]*?)<\/table>/i);
    if (tableM) {
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowM: RegExpExecArray | null;
      while ((rowM = rowRe.exec(tableM[1])) !== null) {
        const cells = [...rowM[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
          .map((c) => cellText(c[1]));
        if (cells.length < 7) continue; // skip header / short rows
        record.push({
          tournament: cells[0] ?? '',
          level:      cells[1] ?? '',
          date:       cells[2] ?? '',
          event:      cells[3] ?? '',
          round:      cells[4] ?? '',
          aff:        cells[5] ?? '',
          neg:        cells[6] ?? '',
          vote:       cells[7] ?? '',
          result:     cells[8] ?? '',
        });
      }
    }

    return { paradigm, record, lastReviewedAt };
  } catch {
    return { paradigm: null, record: [], lastReviewedAt: null };
  }
}

// Legacy wrapper kept for existing callers that only need the paradigm string.
async function tbFetchParadigm(judgeId: string): Promise<string | null> {
  const { paradigm } = await tbFetchJudgeData(judgeId);
  return paradigm;
}

type TbJudgeResult = { personId: string; name: string; institution: string };

/**
 * Split a free-text judge name into Tabroom's first/last search boxes.
 * "Kiran Kumar" → { first: 'Kiran', last: 'Kumar' }; a single token is treated
 * as a last name (surnames are the more selective filter).
 */
function tbSplitName(query: string): { first: string; last: string } {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return { first: '', last: tokens[0] ?? '' };
  return { first: tokens[0], last: tokens.slice(1).join(' ') };
}

/**
 * Run a single paradigm search against Tabroom and parse the results.
 * Tabroom's form (web/index/paradigm.mhtml) takes `search_first` + `search_last`
 * and filters `person.first LIKE 'x%' AND person.last LIKE 'y%'`. The response is
 * either a multi-row results table or, for an exact single match, the judge's
 * paradigm page directly.
 */
async function tbRunParadigmSearch(first: string, last: string, cookie: string | null): Promise<TbJudgeResult[]> {
  const params = new URLSearchParams();
  if (first) params.set('search_first', first);
  if (last) params.set('search_last', last);
  const res = await tbNetSession().fetch(
    `https://www.tabroom.com/index/paradigm.mhtml?${params.toString()}`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    },
  );
  if (res.url.includes('/user/login/')) {
    tbSessionCookie = null;
    throw new Error('Tabroom session expired or credentials rejected. Re-save credentials in Settings and try again.');
  }
  const html = await res.text();
  const results: TbJudgeResult[] = [];
  const seen = new Set<string>();

  // Multi-match: results table rows link via paradigm.mhtml?judge_person_id=ID,
  // with the first/last name in the two leading <td> cells.
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowM: RegExpExecArray | null;
  while ((rowM = rowRe.exec(html)) !== null) {
    const row = rowM[1];
    const idM = row.match(/paradigm\.mhtml\?judge_person_id=(\d+)/);
    if (!idM) continue;
    const personId = idM[1];
    if (seen.has(personId)) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    );
    const fName = cells[0] ?? '';
    const lName = cells[1] ?? '';
    const institution = cells[2] ?? '';
    const name = `${fName} ${lName}`.trim();
    if (!name) continue;
    seen.add(personId);
    results.push({ personId, name, institution });
  }

  // Single exact match: Tabroom renders the paradigm directly. Pull the person id
  // from the "View Past Ratings" link and the name from the <h3> header.
  if (results.length === 0) {
    const prefM = html.match(/show_past_prefs\.mhtml\?judge_person_id=(\d+)/);
    if (prefM) {
      const personId = prefM[1];
      const h3 = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      const name = (h3 ? h3[1].replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim() : `${first} ${last}`.trim());
      results.push({ personId, name, institution: '' });
    }
  }

  return results;
}

/** Search Tabroom for judges by name. Returns all matches. Requires login. */
async function tbSearchJudgesByName(query: string): Promise<TbJudgeResult[]> {
  const cookie = await tbGetSessionCookieStrict();
  const { first, last } = tbSplitName(query);
  let results = await tbRunParadigmSearch(first, last, cookie);
  // For a single bare token we guessed "last name"; if that finds nothing, the
  // user may have typed a first name — retry the other box before giving up.
  if (results.length === 0 && !first && last) {
    results = await tbRunParadigmSearch(last, '', cookie);
  }
  return results;
}

/** Search Tabroom for a judge by name. Returns their person_id if found. */
async function tbSearchJudgePerson(name: string): Promise<string | null> {
  try {
    const results = await tbSearchJudgesByName(name);
    return results[0]?.personId ?? null;
  } catch {
    return null;
  }
}

/**
 * Low-level Tabroom HTTP via Electron's `net.request`.
 *
 * We can't use `net.fetch({ redirect: 'manual' })` here: in this Electron version
 * a 302 with manual redirect mode aborts the request with "Redirect was cancelled"
 * (you'd have to synchronously call `followRedirect`, which fetch can't do). The
 * login POST returns a 302 we need to inspect (Set-Cookie + Location), so we drop
 * to `net.request`, capture the redirect from the `redirect` event, and abort
 * cleanly instead of following it.
 */
function tbRawRequest(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  followRedirects?: boolean;
}): Promise<{ statusCode: number; setCookie: string[]; location: string; body: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (v: { statusCode: number; setCookie: string[]; location: string; body: string }) => {
      if (!settled) { settled = true; resolve(v); }
    };
    const fail = (e: any) => { if (!settled) { settled = true; reject(e); } };

    const req = net.request({
      method: opts.method ?? 'GET',
      url: opts.url,
      session: tbNetSession(),
      // Without this, net.request neither sends jar cookies nor writes response
      // Set-Cookie back to the jar — so the HttpOnly TabroomToken from the login
      // 302 would never be stored, and login detection would fail.
      useSessionCookies: true,
      redirect: opts.followRedirects ? 'follow' : 'manual',
    });
    for (const [k, v] of Object.entries(opts.headers ?? {})) req.setHeader(k, v);

    req.on('redirect', (statusCode, _method, redirectUrl, responseHeaders) => {
      // Manual mode: cookies are already set in the session jar at this point;
      // capture what we need from the 302 and stop (don't follow).
      const sc = responseHeaders['set-cookie'];
      done({
        statusCode,
        setCookie: Array.isArray(sc) ? sc : sc ? [sc as unknown as string] : [],
        location: redirectUrl,
        body: '',
      });
      try { req.abort(); } catch { /* noop */ }
    });
    req.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (c) => chunks.push(Buffer.from(c)));
      response.on('end', () => {
        const sc = response.headers['set-cookie'];
        done({
          statusCode: response.statusCode ?? 0,
          setCookie: Array.isArray(sc) ? sc : sc ? [sc as unknown as string] : [],
          location: (response.headers['location'] as string) ?? '',
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
      response.on('error', fail);
    });
    // Aborting in the redirect handler can surface a late 'error'/'abort' — ignore
    // those once we've already resolved.
    req.on('error', fail);
    req.on('abort', () => { /* ignored if already settled */ });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Attempt a Tabroom login with the given credentials. Returns the session cookie on success, or a structured error reason. */
type TbLoginResult =
  | { ok: true; cookie: string }
  | { ok: false; reason: 'no_creds' | 'form_parse_failed' | 'rejected' | 'no_cookie' | 'network'; detail?: string };
async function tbAttemptLogin(username: string, password: string): Promise<TbLoginResult> {
  if (!username || !password) return { ok: false, reason: 'no_creds' };
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const parseCookies = (raw: string[]): string => {
    const cookies = raw.map((c) => c.split(';')[0].trim()).filter((c) => {
      if (!c.includes('=')) return false;
      const [, v] = c.split('=');
      return v && v.length > 0;
    });
    return cookies.join('; ');
  };
  try {
    // Always start from a clean cookie jar in our isolated session. Stale cookies
    // from prior runs cause Tabroom to 302 to a logged-in page mid-flow.
    await tbResetSessionCookies();
    const pageRes = await tbRawRequest({
      url: 'https://www.tabroom.com/user/login/login.mhtml',
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      followRedirects: true,
    });
    const pageHtml = pageRes.body;
    const initialCookie = parseCookies(pageRes.setCookie);
    const loginFormM = pageHtml.match(/<form[^>]*name\s*=\s*"login"[\s\S]*?<\/form>/i);
    const formHtml = loginFormM?.[0] ?? pageHtml;
    const saltM = formHtml.match(/name\s*=\s*"salt"[\s\S]*?value\s*=\s*"([^"]+)"/i);
    const shaM = formHtml.match(/name\s*=\s*"sha"[\s\S]*?value\s*=\s*"([^"]+)"/i);
    if (!saltM || !shaM) return { ok: false, reason: 'form_parse_failed' };
    const salt = saltM[1];
    const sha = shaM[1];

    const body =
      `salt=${encodeURIComponent(salt)}` +
      `&sha=${encodeURIComponent(sha)}` +
      `&username=${encodeURIComponent(username)}` +
      `&password=${encodeURIComponent(password)}`;
    // Manual redirect: Tabroom answers a successful login with a 302 + auth cookie.
    const res = await tbRawRequest({
      url: 'https://www.tabroom.com/user/login/login_save.mhtml',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Origin': 'https://www.tabroom.com',
        'Referer': 'https://www.tabroom.com/user/login/login.mhtml',
        ...(initialCookie ? { Cookie: initialCookie } : {}),
      },
      body,
      followRedirects: false,
    });
    const location = res.location;
    if (location.includes('err=')) {
      const m = location.match(/err=([^&]+)/);
      const detail = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : 'Credentials rejected by Tabroom';
      return { ok: false, reason: 'rejected', detail };
    }
    // The auth cookie is TabroomToken. With useSessionCookies the login 302 writes
    // it into the isolated session jar (even though it's HttpOnly); read it back to
    // confirm login and to build a Cookie header for downstream requests. As a
    // fallback, also accept a TabroomToken seen directly in the 302 Set-Cookie.
    const jar = await tbNetSession().cookies.get({ url: 'https://www.tabroom.com' });
    let token = jar.find((c) => c.name === 'TabroomToken' && c.value)?.value ?? null;
    if (!token) {
      const fromHeader = res.setCookie
        .map((c) => c.match(/^\s*TabroomToken=([^;]+)/))
        .find((m) => m && m[1] && m[1] !== '');
      if (fromHeader) token = fromHeader[1];
    }
    if (!token) {
      // Diagnostic detail surfaced in the UI so failures are debuggable without
      // access to the main-process console.
      const jarNames = jar.map((c) => `${c.name}${c.value ? '' : '(empty)'}`).join(',') || 'none';
      const detail = `status=${res.statusCode} location=${location || '(none)'} jar=[${jarNames}]`;
      return { ok: false, reason: 'no_cookie', detail };
    }
    void initialCookie; // jar now owns cookie state
    const jarStr = jar.filter((c) => c.value).map((c) => `${c.name}=${c.value}`).join('; ');
    const merged = jarStr.includes('TabroomToken=') ? jarStr : [jarStr, `TabroomToken=${token}`].filter(Boolean).join('; ');
    return { ok: true, cookie: merged };
  } catch (e: any) {
    return { ok: false, reason: 'network', detail: e?.message ?? String(e) };
  }
}

/** Get (or lazily acquire) a Tabroom session cookie using stored OC credentials. */
let tbSessionCookie: string | null = null;
async function tbGetSessionCookie(): Promise<string | null> {
  if (tbSessionCookie) return tbSessionCookie;
  const username = await getSecure('oc_username').catch(() => null);
  const password = await getSecure('oc_password').catch(() => null);
  if (!username || !password) return null;
  const result = await tbAttemptLogin(username, password);
  if (!result.ok) {
    tbSessionCookie = null;
    return null;
  }
  tbSessionCookie = result.cookie;
  return result.cookie;
}

/** Same as tbGetSessionCookie but throws a specific Error explaining the failure. */
async function tbGetSessionCookieStrict(): Promise<string> {
  if (tbSessionCookie) return tbSessionCookie;
  const username = await getSecure('oc_username').catch(() => null);
  const password = await getSecure('oc_password').catch(() => null);
  if (!username || !password) {
    throw new Error('Tabroom requires login for judge search. Save your Tabroom/OpenCaselist credentials in Settings.');
  }
  const result = await tbAttemptLogin(username, password);
  if (!result.ok) {
    let msg: string;
    switch (result.reason) {
      case 'rejected':
        msg = `Tabroom rejected the saved credentials${result.detail ? ` (${result.detail})` : ''}. Your Tabroom password may differ from your OpenCaselist password — open Settings, re-enter your Tabroom credentials, and save.`;
        break;
      case 'form_parse_failed':
        msg = 'Could not read the Tabroom login form. Tabroom may be down or have changed their login page.';
        break;
      case 'no_cookie':
        msg = `Tabroom did not return a session cookie. Try again, or re-save credentials in Settings.${result.detail ? ` [${result.detail}]` : ''}`;
        break;
      case 'network':
        msg = `Network error reaching Tabroom${result.detail ? `: ${result.detail}` : ''}.`;
        break;
      default:
        msg = 'Tabroom login failed. Check your Tabroom/OpenCaselist credentials in Settings.';
    }
    throw new Error(msg);
  }
  tbSessionCookie = result.cookie;
  return result.cookie;
}

ipcMain.handle('tabroom:searchJudges', async (_e, query: string) => {
  if (!query || typeof query !== 'string') return { ok: false, error: 'No query provided', results: [] };
  try {
    const results = await tbSearchJudgesByName(query.trim());
    return { ok: true, results };
  } catch (e: any) {
    if (e?.message?.startsWith('Tabroom')) return { ok: false, error: e.message, results: [] };
    return { ok: false, error: `Tabroom search failed: ${e?.message ?? e}`, results: [] };
  }
});

ipcMain.handle('tabroom:testLogin', async (_e, username: string, password: string) => {
  if (!username || !password) return { ok: false, error: 'Username and password required' };
  // Clear any cached cookie so the test exercises a fresh login.
  tbSessionCookie = null;
  const result = await tbAttemptLogin(username.trim(), password);
  if (result.ok) {
    tbSessionCookie = result.cookie;
    return { ok: true };
  }
  let error: string;
  switch (result.reason) {
    case 'rejected':
      error = result.detail ?? 'Credentials rejected by Tabroom';
      break;
    case 'form_parse_failed':
      error = 'Could not read the Tabroom login form (Tabroom may be down or have changed their login page)';
      break;
    case 'no_cookie':
      error = `Tabroom did not return a session cookie${result.detail ? ` [${result.detail}]` : ''}`;
      break;
    case 'network':
      error = `Network error: ${result.detail ?? 'unknown'}`;
      break;
    default:
      error = 'Login failed';
  }
  return { ok: false, error, reason: result.reason };
});

// Re-test Tabroom login using whatever credentials are already in secure storage.
// Useful when the Settings UI can't show the stored password and the user can't
// type into the fields.
ipcMain.handle('tabroom:retestLogin', async () => {
  tbSessionCookie = null;
  const username = await getSecure('oc_username').catch(() => null);
  const password = await getSecure('oc_password').catch(() => null);
  if (!username || !password) {
    return { ok: false, error: 'No saved credentials found. Type your Tabroom username and password in Settings and click Save.' };
  }
  const result = await tbAttemptLogin(username, password);
  if (result.ok) {
    tbSessionCookie = result.cookie;
    return { ok: true };
  }
  let error: string;
  switch (result.reason) {
    case 'rejected':
      error = result.detail ?? 'Credentials rejected by Tabroom';
      break;
    case 'no_cookie':
      error = `Tabroom did not return a session cookie${result.detail ? ` [${result.detail}]` : ''}`;
      break;
    case 'network':
      error = `Network error reaching Tabroom${result.detail ? `: ${result.detail}` : ''}`;
      break;
    default:
      error = 'Login failed';
  }
  return { ok: false, error };
});

ipcMain.handle('tabroom:fetchParadigm', async (_e, judgeId: string) => {
  if (!judgeId || typeof judgeId !== 'string' || !/^\d{1,10}$/.test(judgeId.trim())) {
    return { ok: false, error: 'Invalid judge ID' };
  }
  try {
    const { paradigm, record, lastReviewedAt } = await tbFetchJudgeData(judgeId.trim());
    return { ok: true, paradigm, record, lastReviewedAt };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

/** Search for a judge by name, then fetch their paradigm and judging record. */
async function tbFetchParadigmByName(name: string): Promise<{ personId: string | null; paradigm: string | null; record: JudgeRound[] }> {
  const personId = await tbSearchJudgePerson(name);
  if (!personId) return { personId: null, paradigm: null, record: [] };
  const { paradigm, record } = await tbFetchJudgeData(personId);
  return { personId, paradigm, record };
}

ipcMain.handle('tabroom:fetchParadigmByName', async (_e, name: string) => {
  if (!name || typeof name !== 'string') return { ok: false, error: 'No judge name provided' };
  try {
    const { personId, paradigm, record } = await tbFetchParadigmByName(name.trim());
    if (!personId) return { ok: false, error: `No Tabroom profile found for "${name}"` };
    if (!paradigm && (!record || record.length === 0)) return { ok: true, personId, paradigm: null, record: [], error: 'Profile found but no paradigm written yet' };
    return { ok: true, personId, paradigm, record };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

// Read round numbers already in the local DB for this tournament (to skip on first poll)
async function tbExistingRoundNumbers(dbTournamentId: string): Promise<Set<number>> {
  try {
    const db = await readJson('db.json');
    const tourn = db?.tournaments?.[dbTournamentId];
    if (!tourn) return new Set();
    const nums = new Set<number>();
    for (const id of (tourn.rounds as string[] ?? [])) {
      const r = db?.rounds?.[id];
      if (r?.number) nums.add(r.number as number);
    }
    return nums;
  } catch { return new Set(); }
}

async function tbPoll() {
  if (!tbMonitorState) return;
  const { dbTournamentId, tabroomTournId, tournamentName, eventName, entryCode, caselist, eventType } = tbMonitorState;

  try {
    const data = await tbFetchData(tabroomTournId);
    const pairings = tbExtractPairings(data, entryCode);

    for (const pairing of pairings) {
      if (pairing.roundNumber === 0) continue;
      if (tbSeenRoundIds.has(pairing.roundId)) continue;
      tbSeenRoundIds.add(pairing.roundId);
      persistSeen('round', [pairing.roundId]); // share with the daemon/app handoff

      // Fire OS notification right away
      const fmtTime = pairing.time
        ? (() => { try { return ' at ' + new Date(pairing.time!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } })()
        : '';
      const notifTitle = pairing.isBye
        ? `BYE — Round ${pairing.roundNumber} of ${eventName}`
        : `Round ${pairing.roundNumber} of ${tournamentName}${fmtTime}`;
      const notifBody = pairing.isBye
        ? 'Free win — no round needed.'
        : 'See more on Warroom →';

      fireNotif({
        title: notifTitle,
        body: notifBody,
        target: {
          deepLink: { kind: 'tournament', id: dbTournamentId, round: pairing.roundNumber },
          rendererEvent: { channel: 'tabroom:monitor:notifClick', payload: { dbTournamentId, roundNumber: pairing.roundNumber } },
        },
      });

      // No renderer to feed in daemon mode — the OS notification above is the
      // valuable part; the rich debrief is only consumed by the in-app UI.
      if (!mainWin) continue;

      if (pairing.isBye) {
        // No research needed for BYEs — send immediately
        mainWin.webContents.send('tabroom:monitor:newRound', {
          dbTournamentId, pairing,
          research: { judgeParadigm: null, ocRounds: null, ocCites: null, dlStats: null },
        });
        continue;
      }

      // Research phase — don't block the poll loop
      const pairingSnapshot = { ...pairing };
      ;(async () => {
        const research: {
          judgeParadigm: string | null;
          ocRounds: any[] | null;
          ocCites: any[] | null;
          dlStats: any | null;
        } = { judgeParadigm: null, ocRounds: null, ocCites: null, dlStats: null };

        // 1. Judge paradigm (scrape tabroom paradigm page)
        if (pairingSnapshot.judgeId) {
          research.judgeParadigm = await tbFetchParadigm(pairingSnapshot.judgeId).catch(() => null);
        }

        // 2. OpenCaselist — search for opponent's school + get rounds/cites
        try {
          const resolved = await resolveShardName(caselist);
          const searchData = await ocFetch('/search', { q: pairingSnapshot.opponentCode, shard: resolved });
          const teams: any[] = Array.isArray(searchData) ? searchData : searchData?.teams ?? searchData?.results ?? [];
          if (teams.length > 0) {
            const t = teams[0];
            // Field order mirrors OpponentSearch.tsx to stay consistent with the manual pull flow
            const school = t.school ?? t.schoolSlug ?? t.schoolName ?? t.name ?? '';
            const teamSlug = t.team ?? t.teamSlug ?? t.teamName ?? t.code ?? t.slug ?? '';
            if (school && teamSlug) {
              const [rRes, cRes] = await Promise.allSettled([
                ocFetch(`/caselists/${resolved}/schools/${school}/teams/${teamSlug}/rounds`),
                ocFetch(`/caselists/${resolved}/schools/${school}/teams/${teamSlug}/cites`),
              ]);
              if (rRes.status === 'fulfilled') research.ocRounds = Array.isArray(rRes.value) ? rRes.value : (rRes.value as any)?.rounds ?? null;
              if (cRes.status === 'fulfilled') research.ocCites = Array.isArray(cRes.value) ? cRes.value : (cRes.value as any)?.cites ?? null;
            }
          }
        } catch (ocErr) { console.warn('[TBMonitor] OC error:', ocErr); }

        // 3. Debate Land stats
        try {
          const dlResult = await fetchDLLeaderboard(eventType, pairingSnapshot.opponentCode);
          if (dlResult && dlResult.teams.length > 0) {
            research.dlStats = teamRowToStats(dlResult.teams[0], dlResult.baseUrl, eventType);
          }
        } catch (dlErr) { console.warn('[TBMonitor] DL error:', dlErr); }

        // Send full debrief to renderer
        mainWin?.webContents.send('tabroom:monitor:newRound', { dbTournamentId, pairing: pairingSnapshot, research });
      })().catch(console.error);
    }
  } catch (e: any) {
    console.error('[TBMonitor] Poll error:', e);
    mainWin?.webContents.send('tabroom:monitor:error', e.message ?? String(e));
  }
}

ipcMain.handle('tabroom:monitor:start', async (_e, config: {
  dbTournamentId: string;
  tabroomTournId: string;
  tournamentName: string;
  eventName: string;
  entryCode: string;
  caselist: string;
  eventType: string;
}) => {
  // Validate required fields
  if (!config?.tabroomTournId || !/^\d{1,10}$/.test(String(config.tabroomTournId).trim())) {
    return { ok: false, error: 'Invalid Tabroom tournament ID' };
  }
  if (!config?.entryCode?.trim()) {
    return { ok: false, error: 'Entry code is required' };
  }
  if (!config?.dbTournamentId?.trim()) {
    return { ok: false, error: 'Invalid tournament ID' };
  }
  try {
    // Stop any prior monitor
    if (tbMonitorTimer) { clearInterval(tbMonitorTimer); tbMonitorTimer = null; }
    tbSeenRoundIds.clear();

    tbMonitorState = {
      dbTournamentId: config.dbTournamentId,
      tabroomTournId: config.tabroomTournId,
      tournamentName: config.tournamentName,
      eventName: config.eventName,
      entryCode: config.entryCode,
      caselist: config.caselist,
      eventType: (config.eventType as DLEventType) ?? 'policy',
    };

    // Persist config so the background daemon can take over live polling when the
    // app is closed. Re-seed the in-memory seen-set from shared state if we're
    // resuming the same tournament (prevents re-notifying rounds the daemon saw).
    const prior = await readMonitors();
    const sameTournament = prior.monitor?.dbTournamentId === config.dbTournamentId;
    const seedSeen = (sameTournament ? prior.seenRoundIds : []) ?? [];
    for (const id of seedSeen) tbSeenRoundIds.add(id);
    await writeMonitors({
      ...prior,
      monitor: {
        dbTournamentId: config.dbTournamentId,
        tabroomTournId: config.tabroomTournId,
        tournamentName: config.tournamentName,
        eventName: config.eventName,
        entryCode: config.entryCode,
        caselist: config.caselist,
        eventType: String((config.eventType as DLEventType) ?? 'policy'),
      },
      seenRoundIds: seedSeen,
      startedAt: Date.now(),
    });

    // Pre-seed seen IDs with rounds already in the DB so first poll doesn't
    // fire notifications for rounds that were posted before monitoring started.
    const existingNums = await tbExistingRoundNumbers(config.dbTournamentId);
    if (existingNums.size > 0) {
      // We can't know the exact roundId from the DB, so we'll rely on round numbers
      // to gate in the newRound handler on the renderer side.
      mainWin?.webContents.send('tabroom:monitor:existingRounds', Array.from(existingNums));
    }

    // Run first poll immediately, then on an interval
    await tbPoll();
    tbMonitorTimer = setInterval(tbPoll, 60_000);

    return { ok: true };
  } catch (e: any) {
    tbMonitorState = null;
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('tabroom:monitor:stop', async () => {
  tbStop();
  await patchMonitors((s) => { s.monitor = null; if (!s.inbox) s.startedAt = null; return s; });
  return { ok: true };
});

ipcMain.handle('tabroom:monitor:status', async () => ({
  active: !!tbMonitorState && !!tbMonitorTimer,
  state: tbMonitorState,
}));

ipcMain.handle('tabroom:monitor:pollNow', async () => {
  if (!tbMonitorState) return { ok: false, error: 'Monitor not running' };
  try { await tbPoll(); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e.message }; }
});

// ── Tabroom inbox result monitor ──────────────────────────────────────────────
// Polls https://www.tabroom.com/inbox/ for ballot results using stored Tabroom creds.

let tbInboxTimer: NodeJS.Timeout | null = null;
let tbInboxCookie: string | null = null;
const tbInboxSeenKeys = new Set<string>();
let tbInboxCfg: { entryCode: string; dbTournamentId: string; tournamentName: string } | null = null;

async function tbInboxLogin(): Promise<string | null> {
  const username = await getSecure('oc_username').catch(() => null);
  const password = await getSecure('oc_password').catch(() => null);
  if (!username || !password) return null;
  return new Promise((resolve) => {
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    const req = https.request(
      {
        hostname: 'www.tabroom.com',
        path: '/user/login/login_check.mhtml',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Origin': 'https://www.tabroom.com',
          'Referer': 'https://www.tabroom.com/user/login/index.mhtml',
        },
      },
      (res) => {
        // Grab session cookies from Set-Cookie header
        const raw: string[] = (res.headers['set-cookie'] as string[] | undefined) ?? [];
        const cookies = raw.map((c) => c.split(';')[0]).filter((c) => c.includes('='));
        resolve(cookies.length > 0 ? cookies.join('; ') : null);
        res.resume(); // drain
      },
    );
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

async function tbInboxFetch(cookie: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'www.tabroom.com',
        path: '/inbox/',
        method: 'GET',
        headers: {
          'Cookie': cookie,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Referer': 'https://www.tabroom.com/',
        },
      },
      (res) => {
        if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
          // Redirect means session expired
          reject(new Error('SESSION_EXPIRED'));
          res.resume();
          return;
        }
        let html = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { html += c; });
        res.on('end', () => resolve(html));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function parseInboxResults(html: string, entryCode: string): Array<{
  key: string; roundNum: number; result: 'win' | 'loss'; opponent?: string;
}> {
  const results: Array<{ key: string; roundNum: number; result: 'win' | 'loss'; opponent?: string }> = [];
  const myCode = entryCode.toLowerCase().replace(/\s+/g, '');
  // Strip scripts/styles for cleaner text matching
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const text = clean.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Pattern 1: "Round N … win/loss" or "Round N … won/lost"
  const re = /round\s+(\d+)[^.]{0,300}?\b(win|loss|won|lost|winner|loser)\b/gi;
  const seen = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const roundNum = parseInt(m[1], 10);
    if (!roundNum || seen.has(roundNum)) continue;
    seen.add(roundNum);
    const word = m[2].toLowerCase();
    const result: 'win' | 'loss' = (word === 'win' || word === 'won' || word === 'winner') ? 'win' : 'loss';
    const key = `r${roundNum}-${result}`;
    results.push({ key, roundNum, result });
  }

  // Pattern 2: "ballot" + "aff win" / "neg win" — figure out result relative to entry's side
  const ballotRe = /round\s+(\d+)[^.]{0,200}?(aff|neg)\s+(win|loss)/gi;
  while ((m = ballotRe.exec(text)) !== null) {
    const roundNum = parseInt(m[1], 10);
    if (!roundNum || seen.has(roundNum)) continue;
    seen.add(roundNum);
    // If we can detect our own side from the HTML near the code, use it; otherwise skip
    const key = `r${roundNum}-ballot`;
    results.push({ key, roundNum, result: 'win', opponent: undefined }); // side-agnostic: just flag the result for user to confirm
  }

  return results;
}

async function tbInboxPoll() {
  if (!tbInboxCfg) return;
  try {
    if (!tbInboxCookie) {
      tbInboxCookie = await tbInboxLogin();
      if (!tbInboxCookie) return; // No credentials stored
    }
    let html: string;
    try {
      html = await tbInboxFetch(tbInboxCookie);
    } catch (e: any) {
      if (e.message === 'SESSION_EXPIRED') { tbInboxCookie = null; }
      return;
    }
    const items = parseInboxResults(html, tbInboxCfg.entryCode);
    for (const item of items) {
      if (tbInboxSeenKeys.has(item.key)) continue;
      tbInboxSeenKeys.add(item.key);
      persistSeen('inbox', [item.key]); // share with the daemon/app handoff
      const { tournamentName, dbTournamentId } = tbInboxCfg;
      // Push notification
      const emoji = item.result === 'win' ? '✅' : '❌';
      fireNotif({
        title: `${emoji} Round ${item.roundNum}: ${item.result.toUpperCase()}`,
        body: `${tournamentName} — result posted on Tabroom`,
        target: {
          deepLink: { kind: 'tournament', id: dbTournamentId, round: item.roundNum },
          rendererEvent: { channel: 'tabroom:inbox:resultClick', payload: { dbTournamentId, roundNumber: item.roundNum } },
        },
      });
      mainWin?.webContents.send('tabroom:inbox:result', { ...item, dbTournamentId });
    }
  } catch (e) {
    console.warn('[TBInbox] Poll error:', e);
    tbInboxCookie = null;
  }
}

ipcMain.handle('tabroom:inbox:start', async (_e, cfg: {
  entryCode: string; dbTournamentId: string; tournamentName: string;
}) => {
  tbInboxCfg = cfg;
  tbInboxCookie = null;
  tbInboxSeenKeys.clear();
  if (tbInboxTimer) { clearInterval(tbInboxTimer); tbInboxTimer = null; }

  // Persist for daemon takeover; re-seed seen keys when resuming the same tournament.
  const prior = await readMonitors();
  const sameTournament = prior.inbox?.dbTournamentId === cfg.dbTournamentId;
  const seedSeen = (sameTournament ? prior.seenInboxKeys : []) ?? [];
  for (const k of seedSeen) tbInboxSeenKeys.add(k);
  await writeMonitors({
    ...prior,
    inbox: { entryCode: cfg.entryCode, dbTournamentId: cfg.dbTournamentId, tournamentName: cfg.tournamentName },
    seenInboxKeys: seedSeen,
    startedAt: prior.startedAt ?? Date.now(),
  });

  await tbInboxPoll();
  tbInboxTimer = setInterval(tbInboxPoll, 90_000);
  return { ok: true };
});

ipcMain.handle('tabroom:inbox:stop', async () => {
  if (tbInboxTimer) { clearInterval(tbInboxTimer); tbInboxTimer = null; }
  tbInboxCfg = null;
  tbInboxCookie = null;
  await patchMonitors((s) => { s.inbox = null; if (!s.monitor) s.startedAt = null; return s; });
  return { ok: true };
});

ipcMain.handle('tabroom:inbox:status', async () => ({
  active: !!tbInboxCfg && !!tbInboxTimer,
  config: tbInboxCfg,
}));

// ── TEST-ONLY: fire a fake round notification for visual testing ──────────────
ipcMain.handle('tabroom:monitor:testFire', async (_e, opts?: {
  roundNumber?: number; isBye?: boolean; room?: string; side?: 'aff' | 'neg';
  opponentCode?: string; judgeName?: string; judgeId?: string;
  dbTournamentId?: string;
}) => {
  if (!mainWin) return { ok: false, error: 'No window' };

  const roundNumber = opts?.roundNumber ?? 3;
  const isBye = opts?.isBye ?? false;
  const room = opts?.room ?? 'Rm 214B';
  const side: 'aff' | 'neg' = opts?.side ?? 'neg';
  const opponentCode = opts?.opponentCode ?? 'Stuyvesant MK';
  const judgeName = opts?.judgeName ?? 'Alex Rivera';
  const judgeId = opts?.judgeId ?? '29847';
  const dbTournamentId = opts?.dbTournamentId ?? '';

  // Fire the OS notification
  const title = isBye
    ? `BYE — Round ${roundNumber} (Test)`
    : `Round ${roundNumber} of Test Tournament at 3:00 PM`;
  const body = isBye ? 'Free win — no round needed.' : 'See more on Warroom →';
  try {
    if (ElectronNotification.isSupported()) {
      const n = new ElectronNotification({ title, body, silent: false });
      n.on('click', () => mainWin?.focus());
      n.show();
    }
  } catch {}

  const mockParadigm = `I judge on a clean flow. I vote on the flow and try not to intervene.
Theory: I'm willing to vote on theory if it's well-developed. I generally default to competing interps.
Framework: I default to util but will consider other frameworks if they're well-argued.
Speed: I'm comfortable up to 85% speed. Please be clear on tags and cites.
Evidence: Recency matters for empirical claims. I cut cards myself so I know when evidence is being misrepresented.
Please ask me any questions before the round.`;

  // Send to renderer via the same channel as the real monitor
  mainWin.webContents.send('tabroom:monitor:newRound', {
    dbTournamentId,
    pairing: {
      roundNumber,
      roundId: `test-round-${roundNumber}-${Date.now()}`,
      room,
      time: new Date(Date.now() + 20 * 60 * 1000).toISOString(), // 20 min from now
      side,
      opponentCode,
      judgeName,
      judgeId,
      isBye,
    },
    research: {
      judgeParadigm: isBye ? null : mockParadigm,
      ocRounds: isBye ? null : [
        { round: 1, side: 'neg', tournament: 'Harvard 2025', report: 'Read T-Subsets and Case' },
        { round: 2, side: 'aff', tournament: 'Harvard 2025', report: 'Read Heg Aff' },
        { round: 3, side: 'neg', tournament: 'Yale 2025', report: 'Read K and Case' },
      ],
      ocCites: isBye ? null : [
        { side: 'aff', title: 'Global Heg Aff', cites: 'Brooks 23 — US hegemony stabilizes great power conflict' },
        { side: 'neg', title: 'Cap K', cites: 'Marx 1867 — capitalism produces structural oppression' },
      ],
      dlStats: isBye ? null : {
        source: 'debate.land',
        event: 'policy',
        careerOTR: 0.847,
        peakRank: 12,
        totalRecord: '18-6',
        prelimRecord: '14-4',
        prelimWinPct: '77.8%',
        avgSpeaks: 28.4,
        totalBids: 2,
        debateLandUrl: 'https://debate.land/teams/test/slug',
        lastFetched: new Date().toISOString(),
      },
    },
  });

  return { ok: true };
});

// Expose the full tournament download_data for the renderer to inspect judge info
ipcMain.handle('tabroom:monitor:fetchParadigm', async (_e, judgeId: string) => {
  // Validate: Tabroom judge IDs are integers only
  if (typeof judgeId !== 'string' || !/^\d{1,10}$/.test(judgeId.trim())) {
    return { ok: false, error: 'Invalid judge ID' };
  }
  try {
    const text = await tbFetchParadigm(judgeId.trim());
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

// ─── Supabase (main process) ──────────────────────────────────────────────────

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// File-based auth storage so sessions persist across app restarts
const sbAuthStorage = {
  getItem: async (key: string) => {
    const safeKey = `sb_auth_${key.replace(/[^a-z0-9]/gi, '_')}`;
    const val = await getSecure(safeKey).catch(() => null);
    if (val !== null) return val;
    // One-time migration: move plaintext session file to encrypted storage
    const legacy = await readJson(`${safeKey}.json`).catch(() => null);
    if (legacy?.value != null) {
      await setSecure(safeKey, legacy.value).catch(() => {});
      try { await fs.unlink(safePath(`${safeKey}.json`)); } catch {}
      return legacy.value;
    }
    return null;
  },
  setItem: async (key: string, value: string) => {
    const safeKey = `sb_auth_${key.replace(/[^a-z0-9]/gi, '_')}`;
    await setSecure(safeKey, value).catch(() => {});
  },
  removeItem: async (key: string) => {
    const safeKey = `sb_auth_${key.replace(/[^a-z0-9]/gi, '_')}`;
    try { await fs.unlink(safePath(`secure_${safeKey}.json`)); } catch {}
  },
};

let sb: SupabaseClient | null = null;
if (SB_URL && SB_KEY) {
  sb = createClient(SB_URL, SB_KEY, {
    auth: { persistSession: true, storage: sbAuthStorage as any },
    realtime: { transport: ws as any },
  });
}

let mainWin: BrowserWindow | null = null;
let realtimeChannel: any = null;

function sbOk<T>(data: T) { return { ok: true, data }; }
function sbErr(e: any) { return { ok: false, error: e?.message ?? String(e) }; }

ipcMain.handle('chat:getSession', async () => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) return sbErr(error);
    if (!data.session) return sbOk(null);
    const u = data.session.user;
    return sbOk({ id: u.id, email: u.email, displayName: (u.user_metadata?.display_name as string) || u.email?.split('@')[0] || 'Unknown' });
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:signIn', async (_e, email: string, password: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return sbErr(error);
    const u = data.user!;
    return sbOk({ id: u.id, email: u.email, displayName: (u.user_metadata?.display_name as string) || email.split('@')[0] });
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:signUp', async (_e, email: string, password: string, displayName: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
    if (error) return sbErr(error);
    const u = data.user;
    if (!u) return sbErr('Account created — check your email to confirm before signing in.');
    return sbOk({ id: u.id, email: u.email, displayName });
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:signOut', async () => {
  if (!sb) return sbErr('Supabase not configured');
  try { await sb.auth.signOut(); return sbOk(null); } catch (e) { return sbErr(e); }
});

// ─── Password reset via deep link (warroom:// custom URL scheme) ─────────────
// Sends a recovery email whose link opens the Warroom app directly — no
// localhost or hosted web page required.  The deep link handler at the bottom
// of this file calls verifyOtp + sends 'auth:recovery' to the renderer.
ipcMain.handle('chat:resetPassword', async (_e, email: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'warroom://auth',
    });
    if (error) return sbErr(error);
    return sbOk(null);
  } catch (e) { return sbErr(e); }
});

// Called after the deep link is handled and the user is in a recovery session.
ipcMain.handle('chat:updatePassword', async (_e, password: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { error } = await sb.auth.updateUser({ password });
    if (error) return sbErr(error);
    return sbOk(null);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:getTeam', async (_e, userId: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    // Use maybeSingle() instead of single() — single() throws PGRST116 on 0 rows
    // which is indistinguishable from a real error and masks the "not in a team yet"
    // case. maybeSingle() returns { data: null, error: null } for 0 rows cleanly.
    const { data, error } = await sb.from('team_members').select('team_id, teams(id, name, invite_code, owner_id)').eq('user_id', userId).limit(1).maybeSingle();
    if (error) return sbErr(error);
    if (!data?.teams) return sbOk(null);
    const t = data.teams as any;
    return sbOk({ id: t.id, name: t.name, invite_code: t.invite_code, owner_id: t.owner_id ?? null });
  } catch (e) { return sbErr(e); }
});

// All teams the user belongs to, earliest joined first. Used by the shared-notes
// visibility dropdown so notes can be shared with any room the user is in.
ipcMain.handle('chat:getTeams', async (_e, userId: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb
      .from('team_members')
      .select('team_id, joined_at, teams(id, name, invite_code, owner_id)')
      .eq('user_id', userId)
      .order('joined_at', { ascending: true });
    if (error) return sbErr(error);
    const teams = (data ?? [])
      .map((row: any) => row.teams)
      .filter(Boolean)
      .map((t: any) => ({ id: t.id, name: t.name, invite_code: t.invite_code, owner_id: t.owner_id ?? null }));
    return sbOk(teams);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:createTeam', async (_e, name: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data: { session } } = await sb.auth.getSession();
    const ownerId = session?.user?.id ?? null;
    const { data, error } = await sb.from('teams').insert({ name, owner_id: ownerId }).select().single();
    if (error) return sbErr(error);
    return sbOk({ id: data.id, name: data.name, invite_code: data.invite_code, owner_id: data.owner_id });
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:joinTeam', async (_e, inviteCode: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    // Use security definer RPC so unauthenticated-to-team users can still look up
    // by invite code (the SELECT policy only allows reading teams you're already in).
    const { data, error } = await sb.rpc('get_team_by_invite', { invite: inviteCode.trim().toLowerCase() });
    if (error) return sbErr(error);
    const t = Array.isArray(data) ? data[0] : data;
    if (!t) return sbErr('Invalid invite code');
    return sbOk({ id: t.id, name: t.name, invite_code: t.invite_code });
  } catch (e) { return sbErr(e); }
});

// Add the current user to a team. Membership is granted by a security-definer RPC
// that re-checks the invite code server-side, so knowing a team's UUID is no longer
// enough to join — the previous flow inserted directly into team_members with only
// an RLS `user_id = auth.uid()` check, letting anyone self-add to any team and
// making kicks reversible. The caller passes the invite code (which it already has
// from createTeam/joinTeam), never a raw team id.
ipcMain.handle('chat:joinTeamByCode', async (_e, inviteCode: string, displayName: string, role: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb.rpc('join_team_by_code', {
      p_invite: String(inviteCode ?? '').trim().toLowerCase(),
      p_display_name: String(displayName ?? '').trim(),
      p_role: role === 'coach' ? 'coach' : 'debater',
    });
    if (error) return sbErr(error);
    const t = Array.isArray(data) ? data[0] : data;
    if (!t) return sbErr('Invalid invite code');
    return sbOk({ id: t.id, name: t.name, invite_code: t.invite_code, owner_id: t.owner_id ?? null });
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:getMessages', async (_e, teamId: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data: msgs, error } = await sb.from('messages').select('*').eq('team_id', teamId).order('created_at', { ascending: true }).limit(50);
    if (error) return sbErr(error);
    const withAtts = await Promise.all((msgs ?? []).map(async (m: any) => {
      const { data: atts } = await sb!.from('message_attachments').select('*').eq('message_id', m.id);
      return { ...m, attachments: atts ?? [] };
    }));
    return sbOk(withAtts);
  } catch (e) { return sbErr(e); }
});

// ─── Shared notes ─────────────────────────────────────────────────────────────

ipcMain.handle('notes:get', async (_e, { teamId, entityType, entityId }: {
  teamId: string; entityType: string; entityId: string;
}) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb
      .from('shared_notes')
      .select('user_id, user_name, content, updated_at')
      .eq('team_id', teamId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('updated_at', { ascending: true });
    if (error) return sbErr(error);
    return sbOk(data ?? []);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('notes:upsert', async (_e, payload: {
  teamId: string; entityType: string; entityId: string; entityName: string;
  userId: string; userName: string; content: string;
}) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { teamId, entityType, entityId, entityName, userId, userName, content } = payload;
    const { error } = await sb.from('shared_notes').upsert(
      { team_id: teamId, entity_type: entityType, entity_id: entityId,
        entity_name: entityName, user_id: userId, user_name: userName,
        content, updated_at: new Date().toISOString() },
      { onConflict: 'team_id,entity_type,entity_id,user_id' },
    );
    if (error) return sbErr(error);
    return sbOk(null);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:sendMessage', async (_e, payload: any) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data: msg, error: msgErr } = await sb.from('messages').insert({
      team_id: payload.teamId, sender_id: payload.senderId, sender_name: payload.senderName,
      content: payload.content, round_ref_id: payload.roundRefId ?? null, round_ref_label: payload.roundRefLabel ?? null,
    }).select().single();
    if (msgErr) return sbErr(msgErr);
    if (payload.attachments?.length) {
      await sb.from('message_attachments').insert(payload.attachments.map((a: any) => ({
        message_id: msg.id, type: a.type, name: a.name, data: a.data ?? {},
      })));
    }
    return sbOk(msg);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:editMessage', async (_e, messageId: string, content: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { error } = await sb.from('messages').update({ content, edited: true }).eq('id', messageId);
    if (error) return sbErr(error);
    return sbOk(null);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:deleteMessage', async (_e, messageId: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    await sb.from('message_attachments').delete().eq('message_id', messageId);
    const { error } = await sb.from('messages').delete().eq('id', messageId);
    if (error) return sbErr(error);
    return sbOk(null);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:editDMMessage', async (_e, messageId: string, content: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { error } = await sb.from('dm_messages').update({ content, edited: true }).eq('id', messageId);
    if (error) return sbErr(error);
    return sbOk(null);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:deleteDMMessage', async (_e, messageId: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    await sb.from('dm_message_attachments').delete().eq('dm_message_id', messageId);
    const { error } = await sb.from('dm_messages').delete().eq('id', messageId);
    if (error) return sbErr(error);
    return sbOk(null);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:subscribe', async (_e, teamId: string) => {
  if (!sb || !mainWin) return;
  realtimeChannel?.unsubscribe();
  realtimeChannel = sb.channel(`team-${teamId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `team_id=eq.${teamId}` },
      async (payload: any) => {
        const msg = payload.new;
        const { data: atts } = await sb!.from('message_attachments').select('*').eq('message_id', msg.id);
        mainWin?.webContents.send('chat:newMessage', { ...msg, attachments: atts ?? [] });
      }
    ).subscribe();
});

ipcMain.handle('chat:unsubscribe', async () => {
  realtimeChannel?.unsubscribe();
  realtimeChannel = null;
});

// ─── Room management ──────────────────────────────────────────────────────────

ipcMain.handle('chat:getMembers', async (_e, teamId: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb.from('team_members')
      .select('user_id, display_name, role, joined_at').eq('team_id', teamId);
    if (error) return sbErr(error);
    return sbOk(data ?? []);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:kickMember', async (_e, teamId: string, userId: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { error } = await sb.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId);
    if (error) return sbErr(error);
    return sbOk(null);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:renameTeam', async (_e, teamId: string, name: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb.from('teams').update({ name }).eq('id', teamId).select().single();
    if (error) return sbErr(error);
    return sbOk({ id: data.id, name: data.name, invite_code: data.invite_code, owner_id: data.owner_id });
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:claimOwnership', async (_e, teamId: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return sbErr('Not authenticated');
    const { data, error } = await sb.from('teams')
      .update({ owner_id: session.user.id })
      .eq('id', teamId)
      .is('owner_id', null)
      .select().single();
    if (error) return sbErr(error);
    if (!data) return sbErr('Team already has an owner');
    return sbOk({ id: data.id, name: data.name, invite_code: data.invite_code, owner_id: data.owner_id });
  } catch (e) { return sbErr(e); }
});

// ─── DMs ──────────────────────────────────────────────────────────────────────

let dmChannel: any = null;

ipcMain.handle('chat:getDMChannels', async (_e, teamId: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data: { session } } = await sb.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return sbErr('Not authenticated');
    const { data: memberRows } = await sb.from('dm_channel_members').select('dm_channel_id').eq('user_id', userId);
    const ids = (memberRows ?? []).map((r: any) => r.dm_channel_id);
    if (ids.length === 0) return sbOk([]);
    const { data: channels, error } = await sb.from('dm_channels').select('*').in('id', ids).eq('team_id', teamId);
    if (error) return sbErr(error);
    const result = await Promise.all((channels ?? []).map(async (ch: any) => {
      const { data: members } = await sb!.from('dm_channel_members').select('user_id, display_name').eq('dm_channel_id', ch.id);
      return { ...ch, members: members ?? [] };
    }));
    return sbOk(result);
  } catch (e) { return sbErr(e); }
});

// ─── Gemini chat (streaming) ──────────────────────────────────────────────────

interface GeminiPart  { text?: string; inlineData?: { mimeType: string; data: string } }
interface GeminiMsg   { role: 'user' | 'model'; parts: GeminiPart[] }

ipcMain.handle('chat:geminiSend', async (_e, messages: GeminiMsg[], systemText?: string) => {
  const apiKey = await getSecure('gemini');
  if (!apiKey) return sbErr('No Gemini API key – add it in Settings → AI.');
  try {
    const modelId = await getGeminiModelId();
    const body: any = {
      contents: messages,
      generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
    };
    if (systemText) body.system_instruction = { parts: [{ text: systemText }] };

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: geminiHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => String(res.status));
      mainWin?.webContents.send('chat:geminiError', errText);
      return sbErr(`Gemini ${res.status}: ${errText}`);
    }

    // Use async iteration — works reliably in Electron/Node.js (getReader() is browser-only)
    const dec = new TextDecoder();
    let fullText = '';
    let buf = '';

    for await (const raw_chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(raw_chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const json = JSON.parse(raw);
          const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          if (text) { fullText += text; mainWin?.webContents.send('chat:geminiChunk', text); }
        } catch {}
      }
    }
    // Flush any remaining buffer
    if (buf) {
      const raw = buf.startsWith('data: ') ? buf.slice(6).trim() : '';
      if (raw && raw !== '[DONE]') {
        try {
          const json = JSON.parse(raw);
          const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          if (text) { fullText += text; mainWin?.webContents.send('chat:geminiChunk', text); }
        } catch {}
      }
    }
    mainWin?.webContents.send('chat:geminiDone');
    return sbOk(fullText);
  } catch (e: any) {
    mainWin?.webContents.send('chat:geminiError', e.message);
    return sbErr(e.message);
  }
});

// ─── Gemini agent turn (tool-calling, non-streaming) ─────────────────────────

const AGENT_SYSTEM = `You are Warroom AI, an agentic AI for competitive debate preparation.

## RULES
These rules exist because debate formats, app features, and rules are specific. Guessing causes real harm.
1. **ALWAYS call get_skill BEFORE answering ANY question about debate format, rules, speech times, argument types, strategy, or judging norms** — even if confident. Call first, then answer from what it returns. Never answer from memory.
2. **ALWAYS call get_skill("user_manual") BEFORE answering ANY question about how to use Warroom, where a feature is, or whether the app has a feature.** Never guess at navigation, settings, or app behavior. "Does Warroom have X?" is a feature question — load the manual first. If the user_manual doesn't have the answer, also load get_skill("documentation") — it covers technical details the manual may omit.
3. If the skill doesn't cover it, say so — do not invent an answer.
4. **If the user's message starts with /skill_name (e.g. "/cx_debate what is a DA?"), immediately call get_skill(skill_name) as your very first action, then answer using what the skill returns.** The slash prefix is a direct invocation — treat it as a hard override to load that skill first, no exceptions.

## Skills System
Skills are .md knowledge files. Call get_skill(name) to load any skill. Built-in skills:
- **cx_debate** — Policy/CX format, speech order, DAs/CPs/Ks/T, spreading, judging paradigms
- **pf_debate** — PF format, speech order, crossfire, weighing, lay judging
- **ld_debate** — LD format, value/criterion framework, speech order, nat circuit vs traditional
- **card_cutting** — Verbatim card format: exact cite rules, tag format, body underlines, full example
- **flowing** — How to flow a document into a flow sheet: column/sheet mapping, shorthand conventions, step-by-step workflow. Call whenever the user asks you to "flow" a document or case.
- **user_manual** — Complete Warroom app user guide
- **documentation** — Full technical documentation of the Warroom app

## Tools
- **get_skill(skill_name)** — load a skill. **ALWAYS call before format, strategy, card cutting, or app questions.**
- **search_logos** — PRIMARY evidence search. Use for any request for debate cards or evidence.
- **search_openevidence** — Open Evidence Project (released packets, full cases). ONLY when user asks for open evidence or full cases.
- **save_card_to_library** — save a card to the user's library.
- **fetch_article** — fetch the text of a URL (for cutting cards from links or reading a source).
- **get_case_synopses** — load block titles and card taglines for one or all cases (no body text). Only needed when the user has more than 8 cases — otherwise synopses are already in context. Pass a name to filter to one case, or omit to get all.
- **read_speech_doc** — read a local .docx file by name. Use whenever the user mentions a .docx filename (e.g. "flow AFF_Domain_Awareness.docx") even without @mentioning it. Call before flowing or cutting cards from a local file.
- **control_timer** — control the speech timer in the title bar: start, pause, reset, select a speech type (e.g. "Constructive", "1AR", "Crossfire"), switch HS/CLG level, or read current status. Use for ANY request involving the speech timer.
- **search_tabroom_tournament** — search Tabroom for tournaments by name.
- **get_tournament_details** — fetch Tabroom tournament info by numeric ID.
- **save_tournament_to_app** — save a Tabroom tournament to the user's app.
- **search_judge** — look up a judge on Tabroom and return their paradigm.
- **write_skill** — create or update a custom skill file. Use when the user wants to save notes, strategy, or reference material as a reusable skill. Call get_skill("skill_builder") first for guidance on format and naming.
- **navigate_app** — open any view in the app for the user (home, library, tournaments, opponents, settings, topics, docs, logos, open-ev, gdrive, or a specific case/block/opponent/tournament/flow by name). Use whenever the user asks you to take them somewhere or open something.
- **list_flows** — list the user's flow sheets. Call before reading/editing a flow.
- **read_flow** — read a flow's sheets, columns, and filled cells. ALWAYS call before edit_flow_cell so you target the right cell.
- **edit_flow_cell** — set one cell in a flow sheet (by flow name, column header, and 1-based row). Use to fill in arguments/responses on the user's flow. The edit shows live if the flow is open.

## Editing flows
Vocabulary: a "flow" is what the user calls a "sheet" or "flow sheet". Its sections are called "sheets" or "tabs" (e.g. "Off 1", "On Case"). Columns are debate speeches (e.g. "1AC", "2NR"). The user may say "edit my sheet", "add to my tabs", or "edit across tabs" — this always means edit_flow_cell, never write_skill.

When the user asks you to add or change something on a flow:
1. If a flow was attached (@mention), its sheets, columns, and filled cells are already in context — skip list_flows and read_flow. Use edit_flow_cell directly, targeting each sheet by name.
2. If no flow is attached, call list_flows to find the exact name, then read_flow to see the structure.
3. Call edit_flow_cell for each cell — one call per cell. Each distinct argument gets its own row. Keep text concise: flows are shorthand, not paragraphs.
4. To fill content across multiple sheets/tabs, call edit_flow_cell once per cell per sheet. Never use write_skill for flow content.


The user's saved tournaments and rounds are in the system context — use them directly for schedule/record questions without a tool call.

## MANDATORY evidence search strategy
For every evidence request, call ALL searches simultaneously in one response (parallel tool calls). Plan 3–5 varied queries that approach the argument from different angles. Never wait for one search before calling the next.

Example for "find cards on military presence in Alaska":
- search_logos("Alaska military bases strategic value")
- search_logos("US military force posture Arctic")
- search_logos("Alaska defense spending readiness")
- search_logos("INDOPACOM Alaska forward deployment")

## Flowing a document — MANDATORY
When the user asks you to "flow" a document, case, or block into a flow sheet (or says "add this to my flow", "put this on the flow", "flow my case", etc.): **call get_skill("flowing") as your very first action**, then follow it exactly. Never ask the user which column, row, or sheet to use — the skill tells you how to infer all of that. Execute immediately after reading the skill.

## Cutting cards
When asked to cut a card, "make a card", "turn this into evidence", or when the user pastes article text or gives a URL with intent to get evidence: call get_skill("card_cutting") first, then follow it exactly. If given a URL, call fetch_article before cutting.

## Saving cards — CRITICAL
- **body** field MUST be the complete, verbatim card text — every word, every sentence. Never a summary. Clean verbatim text only (no markdown underscores or bold markers).
- **cite** field: full citation string per card_cutting skill.
- **tag** field: plain text (no #### or bold markers).
- Call save_card_to_library BEFORE your final text response when saving.

## Evaluating search results
After all searches complete, surface only the 1–3 best cards based on: Relevance → Quality (credibility) → Recency → Strength of warrant. Display each in full card format (tag/cite/body) with a 1–2 sentence explanation of why it's the strongest pick.

## App index — resolving item references
The system context always includes an APP INDEX listing every item saved in the user's app: cases, blocks, flows, opponents, judges, tournaments, and team members — each with a warroom_id.

When the user mentions any item by name (e.g. "my John flow", "the DA block", "Harvard team"), match it case-insensitively against the index and use its warroom_id. The user never needs to @mention something explicitly — you can resolve it from the index.

**Cases:** If the user has 8 or fewer cases, each case's full synopsis (block titles + card taglines, no body or cite) is already in context — use it directly. If they have more than 8 cases, the index only lists names; call get_case_synopses to load block structure and taglines for any case. Cases sometimes contain both AFF and NEG sections — these are usually labeled within the block titles (e.g. "2AC Extensions", "NEG — Politics DA").

Link back to any item using:
  \`@[Display Name](warroom:type:id)\`

Examples:
- \`@[My 2AC](warroom:case:abc123)\` → renders as a clickable chip that opens that case
- \`@[Spending DA](warroom:block:def456)\` → opens that block
- \`@[UQ card](warroom:card:ghi789)\` → opens the block containing that specific card
- \`@[Harvard Team](warroom:opponent:xyz789)\` → opens that opponent profile
- \`@[Round 3 Flow](warroom:flow:uvw012)\` → opens that flow
- \`@[Jane Smith](warroom:judge:pqr345)\` → opens that judge's profile

Card warroom_ids appear in each case synopsis alongside the card tag — use them when referencing specific evidence.

For flows: after resolving the flow's id from the index, call read_flow (or use any attached flow context) to get the sheets and columns before editing.

**Only use warroom_ids from the APP INDEX or from explicit attachments in this conversation.** Never invent IDs.
Use links naturally inline — e.g. "Your @[2AC](warroom:case:abc123) has three blocks that cover this argument."

## Text formatting
The UI renders lightweight markdown in your responses:
- \`**bold**\` — use for argument names, key claims, verdicts
- \`*italic*\` — use for author names, qualifiers, caveats
- \`__underline__\` — use for card tags or key terms you are calling out
- Backtick \`code\` — use for exact UI labels, file names, or skill names
- No headers (#) or block quotes — keep responses conversational`;


const AGENT_TOOLS = [{
  functionDeclarations: [
    {
      name: 'fetch_article',
      description: 'Fetch the text content of a URL so cards can be cut from it. Use whenever the user provides a link and wants cards cut from it, or when you need to read the source of an article.',
      parameters: {
        type: 'OBJECT',
        properties: { url: { type: 'STRING', description: 'The URL to fetch and extract text from' } },
        required: ['url'],
      },
    },
    {
      name: 'search_logos',
      description: 'Search the Logos debate evidence database for cards matching the query. Returns raw page content containing debate cards.',
      parameters: {
        type: 'OBJECT',
        properties: { query: { type: 'STRING', description: 'Search query for evidence cards' } },
        required: ['query'],
      },
    },
    {
      name: 'search_openevidence',
      description: 'Search the Open Evidence Project for debate evidence files. Use for publicly available evidence or when the user asks for open evidence.',
      parameters: {
        type: 'OBJECT',
        properties: { query: { type: 'STRING', description: 'Search query for evidence' } },
        required: ['query'],
      },
    },
    {
      name: 'save_card_to_library',
      description: "Save a debate card to the user's library. Call whenever the user asks to save, add, or put cards in their library. IMPORTANT: the body field must be the card's complete verbatim text from the search results — never a summary.",
      parameters: {
        type: 'OBJECT',
        properties: {
          tag:  { type: 'STRING', description: 'Short descriptive label for the card (e.g. "Harms – Caribou Population Decline")' },
          cite: { type: 'STRING', description: 'Complete citation string: author name, publication/institution, full date' },
          body: { type: 'STRING', description: 'The COMPLETE, VERBATIM card text copied word for word from the search results. This must be the full unabridged card body — never a summary, paraphrase, or shortened version.' },
          year: { type: 'NUMBER', description: 'Publication year as a 4-digit integer' },
        },
        required: ['tag', 'cite', 'body', 'year'],
      },
    },
    {
      name: 'get_skill',
      description: "Load a skill file by name to get specialized knowledge. ALWAYS call the appropriate skill before answering questions about: debate format/rules/strategy (cx_debate, pf_debate, ld_debate), card cutting (card_cutting), Warroom app features/navigation (user_manual), app architecture (documentation). Also call when the user explicitly references a skill by name. Never answer format, rules, or app-feature questions from memory — call the skill first.",
      parameters: {
        type: 'OBJECT',
        properties: {
          skill_name: {
            type: 'STRING',
            description: 'Name of the skill to load (without .md extension). Built-in skills: cx_debate, pf_debate, ld_debate, card_cutting, user_manual, documentation. User may have added custom skills too.',
          },
        },
        required: ['skill_name'],
      },
    },
    {
      name: 'search_tabroom_tournament',
      description: "Search Tabroom for tournaments by name. Returns a list of matching tournaments with their IDs, dates, and locations. Use when the user mentions a tournament name they want to look up, save, or get info about.",
      parameters: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING', description: 'Tournament name or partial name to search for' } },
        required: ['name'],
      },
    },
    {
      name: 'get_tournament_details',
      description: "Fetch detailed information about a Tabroom tournament by its numeric ID — name, dates, location, and events list.",
      parameters: {
        type: 'OBJECT',
        properties: { tabroom_id: { type: 'STRING', description: 'Tabroom tournament numeric ID' } },
        required: ['tabroom_id'],
      },
    },
    {
      name: 'save_tournament_to_app',
      description: "Save a Tabroom tournament to the user's Warroom app. Fetches the tournament data from Tabroom by ID and adds it to their tournament list. Call this after the user confirms they want to save a tournament found via search_tabroom_tournament.",
      parameters: {
        type: 'OBJECT',
        properties: { tabroom_id: { type: 'STRING', description: 'Tabroom tournament numeric ID to save' } },
        required: ['tabroom_id'],
      },
    },
    {
      name: 'search_judge',
      description: "Look up a judge on Tabroom by name and return their judging paradigm. Use when the user asks about a judge's preferences, paradigm, how to win in front of them, or what they look for in a round.",
      parameters: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING', description: 'Judge full name or partial name' } },
        required: ['name'],
      },
    },
    {
      name: 'write_skill',
      description: "Create or update a custom skill file in the user's skills library. Use when the user wants to save debate notes, strategy, coach tips, judge research, argument files, or any knowledge they want Warroom AI to remember and reference. The skill can be loaded later with get_skill(name). Call get_skill(\"skill_builder\") first for naming conventions and format guidance. If updating an existing skill, call get_skill(name) first so you don't overwrite content the user wants to keep.",
      parameters: {
        type: 'OBJECT',
        properties: {
          skill_name:  { type: 'STRING', description: 'Skill filename without extension — lowercase letters, numbers, underscores only (e.g. "coach_tips", "judge_kim", "spending_da").' },
          content:     { type: 'STRING', description: 'Full Markdown content for the skill file.' },
          description: { type: 'STRING', description: 'One sentence describing what this skill contains. Shown to the user.' },
        },
        required: ['skill_name', 'content', 'description'],
      },
    },
    {
      name: 'navigate_app',
      description: "Open a view in the Warroom app for the user. Use when the user asks you to take them to, open, show, or go to any part of the app. For top-level destinations no target is needed. For a specific case/block/opponent/tournament/flow, pass target_name and it will be resolved by name.",
      parameters: {
        type: 'OBJECT',
        properties: {
          destination: {
            type: 'STRING',
            description: "Where to go. Top-level: 'home', 'library' (all cases/cards), 'tournaments', 'opponents', 'settings', 'topics', 'docs', 'logos', 'open-ev', 'gdrive', 'speech-doc'. Entity views (require target_name): 'case', 'block', 'opponent', 'tournament', 'flow'.",
          },
          target_name: { type: 'STRING', description: "Name of the specific case, block, opponent, tournament, or flow to open (only for entity destinations). Matched case-insensitively." },
        },
        required: ['destination'],
      },
    },
    {
      name: 'list_flows',
      description: "List all of the user's flow sheets (name, debate event, id). Call this before read_flow or edit_flow_cell so you know which flows exist and their exact names.",
      parameters: { type: 'OBJECT', properties: {}, required: [] },
    },
    {
      name: 'read_flow',
      description: "Read the full contents of a flow sheet — its sheets, column headers, and every filled-in cell. Call this before editing so you know the structure (column names, which rows/sheets have content) and don't overwrite the wrong cell.",
      parameters: {
        type: 'OBJECT',
        properties: { flow: { type: 'STRING', description: 'Flow name (or id) to read. Matched case-insensitively.' } },
        required: ['flow'],
      },
    },
    {
      name: 'edit_flow_cell',
      description: "Set the value of a single cell in a flow sheet. Use to fill in arguments, responses, or notes on the user's flow. Call read_flow first to learn the column names and current contents. Columns are debate speeches (e.g. '1AC', '2NR' for policy; 'Pro Case', 'Con Rebuttal' for PF). The edit appears live if the flow is open.",
      parameters: {
        type: 'OBJECT',
        properties: {
          flow:   { type: 'STRING', description: 'Flow name (or id). Matched case-insensitively.' },
          sheet:  { type: 'STRING', description: "Optional. Sheet name (e.g. 'Off 1') or 1-based sheet number. Defaults to the first sheet." },
          column: { type: 'STRING', description: "Column header name (e.g. '2NR', 'Pro Case') or 1-based column number." },
          row:    { type: 'NUMBER', description: 'Row number, 1-based (1 is the top row).' },
          value:  { type: 'STRING', description: 'Text to put in the cell. Overwrites any existing content in that cell.' },
        },
        required: ['flow', 'column', 'row', 'value'],
      },
    },
    {
      name: 'get_case_synopses',
      description: "Load the block titles and card taglines (no body, no cite) for one or all of the user's saved cases. Only call this when the APP INDEX says synopses are not auto-loaded (more than 8 cases). Returns block structure and argument fingerprint so you can understand what a case argues without reading the full text.",
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Optional. Case name to filter to a single case. Omit to load synopses for all cases.' },
        },
        required: [],
      },
    },
    {
      name: 'read_speech_doc',
      description: "Read the text of a local .docx speech doc by filename. Use whenever the user references a .docx file they want to flow, extract cards from, or analyze — even if they didn't @mention it. The file must have been opened in the Speech Doc viewer at least once.",
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Filename of the speech doc (e.g. "AFF_Domain_Awareness.docx"). Matched case-insensitively against recent docs.' },
        },
        required: ['name'],
      },
    },
    {
      name: 'control_timer',
      description: "Control the speech timer in the Warroom title bar. Use for any request to start, pause, stop, reset, or select a speech type on the timer. Also call with action='status' to read the current timer state before reporting it.",
      parameters: {
        type: 'OBJECT',
        properties: {
          action: {
            type: 'STRING',
            description: "What to do: 'start' (begin countdown), 'pause' (stop countdown), 'reset' (stop and restore full time), 'select' (pick a speech type — requires speech param), 'level' (switch HS/CLG for policy — requires level param), 'status' (read current state without changing it).",
          },
          speech: {
            type: 'STRING',
            description: "Speech type name to select. Examples: 'Constructive', 'Cross-Ex', 'Rebuttal', '1AC', '2NC', '1AR', 'Crossfire', 'Summary', 'Final Focus', 'AC', 'NC', 'NR'. Matched case-insensitively.",
          },
          level: {
            type: 'STRING',
            description: "Policy level: 'hs' (high school) or 'clg' (college/NDT/CEDA). Only applies when event is policy.",
          },
        },
        required: ['action'],
      },
    },
  ],
}];

const AGENT_TITLE_SUFFIX = `

## Title (first response only)
When giving your very first text response in this conversation, output a \`<title>\` tag as the absolute first line, then a blank line, then your normal response. The tag must be a 2–4 word noun phrase describing the topic. Example:
<title>Politics DA Answers</title>

(do not include this tag on follow-up responses)`;

// ─── Gemini request/response logger ──────────────────────────────────────────
// Appends one entry per agent turn to warroom/gemini.log in userData.
// Logs the full outbound payload (system prompt + messages) and the raw response.
// The Gemini API key is never present in request bodies — it's a URL query
// param that is intentionally excluded here, so the log is safe to read.
async function logGeminiTurn(
  systemText: string,
  messages: any[],
  rawResponse: any,
): Promise<void> {
  try {
    await ensureDir();
    const logPath = join(dataDir(), 'gemini.log');
    const ts = new Date().toISOString();
    const entry = [
      `\n${'─'.repeat(80)}`,
      `[${ts}]`,
      '',
      '── SYSTEM PROMPT ──────────────────────────────────────────────────────────────',
      systemText,
      '',
      '── MESSAGES ───────────────────────────────────────────────────────────────────',
      JSON.stringify(messages, null, 2),
      '',
      '── RAW RESPONSE ───────────────────────────────────────────────────────────────',
      JSON.stringify(rawResponse, null, 2),
      '',
    ].join('\n');
    await fs.appendFile(logPath, entry, 'utf-8');
  } catch (_) {
    // Logging is best-effort — never let it crash the agent turn
  }
}

ipcMain.handle('chat:geminiAgentTurn', async (_e, messages: any[], wantTitle?: boolean, userContext?: string) => {
  try {
    // ── Resolve provider + model (balanced tier = never use lite for agent turns) ──
    const { provider, modelId, apiKey } = await getProviderForTask('balanced');
    if (!apiKey) return sbErr('No AI API key — add it in Settings → AI.');

    const [topics, appSettings] = await Promise.all([
      getStoredTopics().catch(() => null),
      readJson('app_settings').catch(() => null),
    ]);

    const rawEvent: string | undefined = appSettings?.debateEvent;
    // Map the stored event key to a human label and which topic(s) to show
    type EventInfo = { label: string; topics: string[] };
    const EVENT_MAP: Record<string, EventInfo> = {
      hspolicy:  { label: 'High School Policy (CX)',        topics: ['policy'] },
      ndtceda:   { label: 'College Policy (NDT/CEDA)',       topics: ['policy'] },
      hspf:      { label: 'High School Public Forum (PF)',   topics: ['pf']     },
      hspf_high: { label: 'High School Public Forum (PF)',   topics: ['pf']     },
      hsld:      { label: 'High School Lincoln-Douglas (LD)', topics: ['ld']    },
      nfald:     { label: 'College LD (NFA-LD)',              topics: ['ld']    },
    };
    const eventInfo = rawEvent ? EVENT_MAP[rawEvent] : undefined;
    let topicPrefix = '';
    if (eventInfo) {
      const lines: string[] = [`User's debate event: ${eventInfo.label}`];
      if (eventInfo.topics.includes('policy') && topics?.policy?.current && !topics.policy.current.includes('not found')) {
        lines.push(`Current Policy/CX Topic (${topics.policy.season ?? 'current season'}): ${topics.policy.current}`);
      }
      if (eventInfo.topics.includes('pf') && topics?.pf?.current && !topics.pf.current.includes('not found')) {
        lines.push(`Current PF Topic (${topics.pf.period ?? 'current period'}): ${topics.pf.current}`);
      }
      if (eventInfo.topics.includes('ld') && topics?.ld?.current && !topics.ld.current.includes('not found')) {
        lines.push(`Current LD Topic (${topics.ld.period ?? 'current period'}): ${topics.ld.current}`);
      }
      topicPrefix = lines.join('\n') + '\n\n';
    }
    const contextSuffix = userContext ? `\n\n${userContext}` : '';
    const customSkillsSuffix = await buildCustomSkillsSuffix();
    const systemText = topicPrefix + (wantTitle ? AGENT_SYSTEM + AGENT_TITLE_SUFFIX : AGENT_SYSTEM) + customSkillsSuffix + contextSuffix;

    // ── Gemini path ──────────────────────────────────────────────────────────
    if (provider === 'gemini') {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 45_000);
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
          {
            method: 'POST',
            headers: geminiHeaders(apiKey),
            signal: abort.signal,
            body: JSON.stringify({
              contents: messages,
              tools: AGENT_TOOLS,
              generationConfig: { maxOutputTokens: 8192, temperature: 0.4 },
              system_instruction: { parts: [{ text: systemText }] },
            }),
          }
        );
      } finally { clearTimeout(timeout); }
      if (!res!.ok) {
        const errText = await res!.text().catch(() => String(res!.status));
        return sbErr(`Gemini ${res!.status}: ${errText}`);
      }
      const data = await res.json() as any;
      void logGeminiTurn(systemText, messages, data);
      const candidate = data?.candidates?.[0];
      const parts: any[] = candidate?.content?.parts ?? [];
      const fnCalls = parts.filter((p: any) => p.functionCall);
      if (fnCalls.length > 0) {
        return sbOk({ type: 'tool_calls', calls: fnCalls.map((p: any) => ({ name: p.functionCall.name as string, args: p.functionCall.args as Record<string, any> })), modelContent: candidate.content });
      }
      const raw = parts.map((p: any) => p.text ?? '').join('');
      if (wantTitle) {
        const m = raw.match(/^<title>(.*?)<\/title>\r?\n?\r?\n?/);
        if (m) {
          const title = m[1].trim().replace(/^["'`*\s]+|["'`*.,!?\s]+$/g, '').slice(0, 50);
          return sbOk({ type: 'text', text: raw.slice(m[0].length), title, modelContent: candidate.content });
        }
      }
      return sbOk({ type: 'text', text: raw, modelContent: candidate.content });
    }

    // ── OpenAI path ──────────────────────────────────────────────────────────
    if (provider === 'openai') {
      const { msgs: oaiMessages } = geminiMsgsToOpenAI(messages);
      const oaiTools = geminiToolsToOpenAI(AGENT_TOOLS);
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 45_000);
      let res: Response;
      try {
        res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          signal: abort.signal,
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'system', content: systemText }, ...oaiMessages],
            tools: oaiTools,
            tool_choice: 'auto',
            temperature: 0.4,
            max_tokens: 8192,
          }),
        });
      } finally { clearTimeout(timeout); }
      if (!res!.ok) throw openaiHttpError(res!.status, await res!.text().catch(() => ''));
      const data = await res.json() as any;
      const msg = data?.choices?.[0]?.message;
      const modelContent = openAIMsgToGeminiContent(msg);
      if (msg?.tool_calls?.length > 0) {
        return sbOk({ type: 'tool_calls', calls: msg.tool_calls.map((tc: any) => ({ name: tc.function.name, args: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })() })), modelContent });
      }
      const raw = msg?.content ?? '';
      return sbOk({ type: 'text', text: raw, modelContent });
    }

    // ── Anthropic path ───────────────────────────────────────────────────────
    {
      const antMessages = geminiMsgsToAnthropic(messages);
      const antTools = geminiToolsToAnthropic(AGENT_TOOLS);
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 45_000);
      let res: Response;
      try {
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          signal: abort.signal,
          body: JSON.stringify({
            model: modelId,
            system: systemText,
            messages: antMessages,
            tools: antTools,
            max_tokens: 8192,
          }),
        });
      } finally { clearTimeout(timeout); }
      if (!res!.ok) throw anthropicHttpError(res!.status, await res!.text().catch(() => ''));
      const data = await res.json() as any;
      const content: any[] = data?.content ?? [];
      const modelContent = anthropicContentToGeminiContent(content);
      const toolUses = content.filter((c: any) => c.type === 'tool_use');
      if (toolUses.length > 0) {
        return sbOk({ type: 'tool_calls', calls: toolUses.map((tu: any) => ({ name: tu.name, args: tu.input ?? {} })), modelContent });
      }
      const raw = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
      return sbOk({ type: 'text', text: raw, modelContent });
    }
  } catch (e: any) {
    return sbErr(e.message);
  }
});

ipcMain.handle('chat:generateGeminiTitle', async (_e, messages: any[]) => {
  try {
    // Title generation always uses the lite tier — cheapest model, single turn.
    // This rule applies regardless of which provider the user has selected.
    const textOnly = (m: any) =>
      (m.parts ?? [])
        .filter((p: any) => !p.thought && typeof p.text === 'string' && p.text.trim())
        .map((p: any) => p.text).join(' ').slice(0, 500);
    const userMsg  = messages.find((m: any) => m.role === 'user');
    const modelMsg = messages.slice().reverse().find((m: any) => m.role === 'model');
    const userText  = userMsg  ? textOnly(userMsg)  : '';
    const modelText = modelMsg ? textOnly(modelMsg) : '';
    const prompt = `You are titling a debate-prep chat. Write a noun-phrase title that is EXACTLY 2–4 words describing the topic. Output ONLY the title — no punctuation, no quotes, no explanation.\n\nUser: ${userText}\nAssistant: ${modelText}\n\nTitle:`;
    const raw = await callAI(prompt, 'lite');
    const title = raw.trim().replace(/^["'`*\s]+|["'`*.,!?\s]+$/g, '').trim().slice(0, 50);
    return sbOk(title || null);
  } catch (e: any) { return sbErr(e.message); }
});

ipcMain.handle('chat:lookupUserByEmail', async (_e, email: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb.rpc('lookup_user_by_email', { lookup_email: email.trim().toLowerCase() });
    if (error) return sbErr(error);
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return sbOk(null);
    return sbOk({ userId: row.user_id, displayName: row.display_name });
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:createDM', async (_e, teamId: string, members: { userId: string; displayName: string }[], name?: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    // Generate the channel ID here so we don't need to read it back after insert.
    // (Reading back would fail: dm_read_channels requires is_dm_member, but members
    // haven't been inserted yet at that point.)
    const chanId = crypto.randomUUID();
    const { error: cErr } = await sb.from('dm_channels').insert({ id: chanId, team_id: teamId, name: name ?? null });
    if (cErr) return sbErr(cErr);
    const { error: mErr } = await sb.from('dm_channel_members').insert(
      members.map((m) => ({ dm_channel_id: chanId, user_id: m.userId, display_name: m.displayName }))
    );
    if (mErr) return sbErr(mErr);
    return sbOk({ id: chanId, team_id: teamId, name: name ?? null, members });
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:getDMMessages', async (_e, dmChannelId: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb.from('dm_messages').select('*').eq('dm_channel_id', dmChannelId).order('created_at', { ascending: true }).limit(100);
    if (error) return sbErr(error);
    const withAtts = await Promise.all((data ?? []).map(async (m: any) => {
      const { data: atts } = await sb!.from('dm_message_attachments').select('*').eq('dm_message_id', m.id);
      return { ...m, attachments: atts ?? [] };
    }));
    return sbOk(withAtts);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:sendDMMessage', async (_e, payload: { dmChannelId: string; senderId: string; senderName: string; content: string; attachments?: any[] }) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb.from('dm_messages').insert({
      dm_channel_id: payload.dmChannelId, sender_id: payload.senderId,
      sender_name: payload.senderName, content: payload.content,
    }).select().single();
    if (error) return sbErr(error);
    if (payload.attachments?.length) {
      await sb.from('dm_message_attachments').insert(payload.attachments.map((a: any) => ({
        dm_message_id: data.id, type: a.type, name: a.name, data: a.data ?? {}, permission: a.permission ?? 'edit',
      })));
    }
    return sbOk(data);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:addDMMember', async (_e, dmChannelId: string, userId: string, displayName: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { error } = await sb.from('dm_channel_members').upsert({ dm_channel_id: dmChannelId, user_id: userId, display_name: displayName });
    if (error) return sbErr(error);
    return sbOk(null);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('chat:subscribeDM', async (_e, dmChannelId: string) => {
  if (!sb || !mainWin) return;
  dmChannel?.unsubscribe();
  dmChannel = sb.channel(`dm-${dmChannelId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `dm_channel_id=eq.${dmChannelId}` },
      async (payload: any) => {
        const msg = payload.new;
        const { data: atts } = await sb!.from('dm_message_attachments').select('*').eq('dm_message_id', msg.id);
        mainWin?.webContents.send('chat:newDMMessage', { ...msg, attachments: atts ?? [] });
      }
    ).subscribe();
});

ipcMain.handle('chat:unsubscribeDM', async () => {
  dmChannel?.unsubscribe();
  dmChannel = null;
});

// ─── Collaborative flows (Yjs over Supabase Realtime broadcast) ────────────────
// Live flowing rides a Supabase Realtime *broadcast* channel keyed by the flow's
// unguessable UUID. Broadcast is ephemeral pub/sub (no DB write per keystroke);
// durability is a debounced base64 Yjs snapshot in the `flows` table. The Yjs doc
// itself, the merge logic, and awareness all live in the renderer — this process
// is only the transport bridge (relay update/awareness bytes, forward presence).
const flowChannels = new Map<string, any>();

ipcMain.handle('flowSync:join', async (_e, flowId: string) => {
  if (!sb || !mainWin) return sbErr('Supabase not configured');
  if (flowChannels.has(flowId)) return sbOk(true);
  const ch = sb.channel(`flow-${flowId}`, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'update' }, (msg: any) => {
    mainWin?.webContents.send('flowSync:remoteUpdate', { flowId, update: msg.payload?.u });
  });
  ch.on('broadcast', { event: 'awareness' }, (msg: any) => {
    mainWin?.webContents.send('flowSync:remoteAwareness', { flowId, awareness: msg.payload?.a });
  });
  ch.on('presence', { event: 'sync' }, () => {
    mainWin?.webContents.send('flowSync:presence', { flowId, state: ch.presenceState() });
  });
  await new Promise<void>((resolve) => {
    ch.subscribe((status: string) => { if (status === 'SUBSCRIBED') resolve(); });
  });
  flowChannels.set(flowId, ch);
  return sbOk(true);
});

ipcMain.handle('flowSync:leave', async (_e, flowId: string) => {
  const ch = flowChannels.get(flowId);
  if (ch) { try { await ch.unsubscribe(); } catch {} flowChannels.delete(flowId); }
  return sbOk(true);
});

ipcMain.handle('flowSync:broadcastUpdate', async (_e, flowId: string, u: string) => {
  const ch = flowChannels.get(flowId);
  if (!ch) return sbErr('not joined');
  await ch.send({ type: 'broadcast', event: 'update', payload: { u } });
  return sbOk(true);
});

ipcMain.handle('flowSync:broadcastAwareness', async (_e, flowId: string, a: string) => {
  const ch = flowChannels.get(flowId);
  if (!ch) return sbOk(false);
  await ch.send({ type: 'broadcast', event: 'awareness', payload: { a } });
  return sbOk(true);
});

ipcMain.handle('flowSync:track', async (_e, flowId: string, meta: any) => {
  const ch = flowChannels.get(flowId);
  if (ch) { try { await ch.track(meta); } catch {} }
  return sbOk(true);
});

// Promote a flow to live: insert the owning row (owner = me) if it doesn't exist.
ipcMain.handle('flowSync:promote', async (_e, flowId: string, teamId: string, name: string, contentB64: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data: sess } = await sb.auth.getSession();
    const uid = sess?.session?.user?.id;
    if (!uid) return sbErr('Not signed in');
    const { error } = await sb.from('flows').upsert(
      { id: flowId, team_id: teamId, owner_id: uid, name, content: contentB64, updated_at: new Date().toISOString() },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (error) return sbErr(error);
    return sbOk(true);
  } catch (e) { return sbErr(e); }
});

// Persist the merged Yjs snapshot. Pure UPDATE — never touches owner_id, so any
// team member can save without seizing ownership.
ipcMain.handle('flowSync:saveSnapshot', async (_e, flowId: string, name: string, contentB64: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { error } = await sb.from('flows')
      .update({ content: contentB64, name, updated_at: new Date().toISOString() })
      .eq('id', flowId);
    if (error) return sbErr(error);
    return sbOk(true);
  } catch (e) { return sbErr(e); }
});

ipcMain.handle('flowSync:loadSnapshot', async (_e, flowId: string) => {
  if (!sb) return sbErr('Supabase not configured');
  try {
    const { data, error } = await sb.from('flows')
      .select('content,name,team_id,owner_id,updated_at').eq('id', flowId).maybeSingle();
    if (error) return sbErr(error);
    return sbOk(data);
  } catch (e) { return sbErr(e); }
});

// ─── Google Drive ─────────────────────────────────────────────────────────────

interface GDriveTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

let cachedGDriveTokens: GDriveTokens | null = null;

async function loadGDriveTokens(): Promise<GDriveTokens | null> {
  if (cachedGDriveTokens) return cachedGDriveTokens;
  // Encrypted store (safeStorage in prod) — refresh tokens grant long-lived
  // access to the user's Drive, so they must not sit on disk in plaintext.
  try {
    const raw = await getSecure('gdrive_tokens');
    if (raw) {
      const t = JSON.parse(raw) as GDriveTokens;
      if (t?.access_token && t?.refresh_token) { cachedGDriveTokens = t; return t; }
    }
  } catch {}
  // One-time migration: an older build stored these in plaintext gdrive_tokens.json.
  try {
    const legacy = await readJson('gdrive_tokens.json');
    if (legacy?.access_token && legacy?.refresh_token) {
      cachedGDriveTokens = legacy;
      await setSecure('gdrive_tokens', JSON.stringify(legacy));
      try { await fs.unlink(join(dataDir(), 'gdrive_tokens.json')); } catch {}
      return legacy;
    }
  } catch {}
  return null;
}

async function saveGDriveTokens(t: GDriveTokens) {
  cachedGDriveTokens = t;
  await setSecure('gdrive_tokens', JSON.stringify(t));
}

async function clearGDriveTokens() {
  cachedGDriveTokens = null;
  try { await fs.unlink(safePath('secure_gdrive_tokens.json')); } catch {}
  try { await fs.unlink(join(dataDir(), 'gdrive_tokens.json')); } catch {}
}

// Collapses concurrent refreshes into one network call. Without this, two
// IPC handlers (e.g. listFiles + fetchFile) that both see an expired token
// would POST the same refresh_token to Google simultaneously and race.
let gdriveRefreshInFlight: Promise<string | null> | null = null;

async function getValidGDriveToken(): Promise<string | null> {
  const tokens = await loadGDriveTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
  if (gdriveRefreshInFlight) return gdriveRefreshInFlight;
  gdriveRefreshInFlight = (async () => {
    const clientId = await getSecure('gdrive_client_id');
    const clientSecret = await getSecure('gdrive_client_secret');
    if (!clientId || !clientSecret) { await clearGDriveTokens(); return null; }
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }).toString(),
      });
      if (!res.ok) {
        // Only a definitively rejected grant (refresh token revoked or expired)
        // should disconnect the user. A transient 429/5xx — or being briefly
        // offline — must NOT wipe their saved tokens; just fail this call so
        // the next one can retry.
        let invalidGrant = false;
        try { invalidGrant = ((await res.json()) as any)?.error === 'invalid_grant'; } catch {}
        if (invalidGrant) await clearGDriveTokens();
        return null;
      }
      const d = await res.json() as any;
      if (!d.access_token) return null;
      const refreshed: GDriveTokens = { access_token: d.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + (d.expires_in ?? 3600) * 1000 };
      await saveGDriveTokens(refreshed);
      return refreshed.access_token;
    } catch { return null; } // network error — keep tokens, allow retry
  })();
  try { return await gdriveRefreshInFlight; }
  finally { gdriveRefreshInFlight = null; }
}

ipcMain.handle('gdrive:status', async () => {
  const tokens = await loadGDriveTokens();
  return { connected: !!tokens };
});

ipcMain.handle('gdrive:disconnect', async () => {
  await clearGDriveTokens();
  return { ok: true };
});

ipcMain.handle('gdrive:connect', async () => {
  const clientId = await getSecure('gdrive_client_id');
  const clientSecret = await getSecure('gdrive_client_secret');
  if (!clientId || !clientSecret) return { ok: false, error: 'no_credentials' };

  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const state = crypto.randomBytes(16).toString('hex');
    let resolved = false;
    let port = 0;

    const done = (result: { ok: boolean; error?: string }) => {
      if (resolved) return;
      resolved = true;
      server.close();
      resolve(result);
    };

    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/oauth2callback')) { res.writeHead(404); res.end(); return; }
      const url = new URL('http://localhost' + req.url);
      const code = url.searchParams.get('code');
      if (!code || url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body>Authorization failed. Close this tab.</body></html>');
        done({ ok: false, error: 'State mismatch' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif;padding:40px;background:#f5f5f5"><h2 style="color:#1a73e8">Connected to Google Drive!</h2><p>You can close this tab and return to Warroom.</p></body></html>');
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code, client_id: clientId!, client_secret: clientSecret!, redirect_uri: `http://127.0.0.1:${port}/oauth2callback`, grant_type: 'authorization_code' }).toString(),
        });
        const d = await tokenRes.json() as any;
        if (!d.access_token || !d.refresh_token) { done({ ok: false, error: d.error_description ?? 'No tokens' }); return; }
        await saveGDriveTokens({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in ?? 3600) * 1000 });
        done({ ok: true });
      } catch (e: any) { done({ ok: false, error: e.message }); }
    });

    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as any).port;
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', clientId!);
      authUrl.searchParams.set('redirect_uri', `http://127.0.0.1:${port}/oauth2callback`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.readonly');
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('state', state);
      shell.openExternal(authUrl.toString());
    });

    setTimeout(() => done({ ok: false, error: 'Timeout — no response from Google' }), 5 * 60 * 1000);
  });
});

const DRIVE_FILE_Q = "(mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') and trashed=false";

ipcMain.handle('gdrive:listFiles', async (_e, pageToken?: string) => {
  const token = await getValidGDriveToken();
  if (!token) return { ok: false, error: 'not_connected' };
  try {
    const params = new URLSearchParams({ q: DRIVE_FILE_Q, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size)', orderBy: 'modifiedTime desc', pageSize: '50' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, error: `HTTP ${res.status}: ${t}` }; }
    const d = await res.json() as any;
    return { ok: true, files: d.files ?? [], nextPageToken: d.nextPageToken };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('gdrive:searchFiles', async (_e, query: string) => {
  const token = await getValidGDriveToken();
  if (!token) return { ok: false, error: 'not_connected' };
  try {
    // Escape backslashes first, then single quotes, so the value stays inside the
    // quoted Drive query string literal and can't break out or malform the query.
    const escaped = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const nameFilter = query.trim() ? ` and name contains '${escaped}'` : '';
    const params = new URLSearchParams({ q: DRIVE_FILE_Q + nameFilter, fields: 'files(id,name,mimeType,modifiedTime,size)', orderBy: 'modifiedTime desc', pageSize: '30' });
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, error: `HTTP ${res.status}: ${t}` }; }
    const d = await res.json() as any;
    return { ok: true, files: d.files ?? [] };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('gdrive:fetchFile', async (_e, fileId: string) => {
  const token = await getValidGDriveToken();
  if (!token) return { ok: false, error: 'not_connected' };
  // Drive file IDs are a restricted charset; reject anything else so the value
  // can't reshape the request path (extra segments, query params, traversal).
  if (typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(fileId)) {
    return { ok: false, error: 'Invalid file ID' };
  }
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, error: `HTTP ${res.status}: ${t}` }; }
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, base64: buf.toString('base64') };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

// Upload an xlsx (base64) to Google Drive and auto-convert to Google Sheets, return the edit URL
ipcMain.handle('gdrive:uploadAsSheets', async (_e, base64: string, filename: string) => {
  const token = await getValidGDriveToken();
  if (!token) return { ok: false, error: 'not_connected' };
  try {
    const boundary = `wr_${crypto.randomBytes(8).toString('hex')}`;
    const sheetName = filename.replace(/\.xlsx$/i, '');
    const metadata = JSON.stringify({ name: sheetName, mimeType: 'application/vnd.google-apps.spreadsheet' });
    const fileBuffer = Buffer.from(base64, 'base64');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary="${boundary}"` },
      body,
    });
    if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, error: `HTTP ${res.status}: ${t}` }; }
    const d = await res.json() as any;
    if (d.webViewLink) shell.openExternal(d.webViewLink);
    return { ok: true, fileId: d.id, url: d.webViewLink };
  } catch (e: any) { return { ok: false, error: String(e.message) }; }
});

// ─── NSDA Topic Monitor ───────────────────────────────────────────────────────

import { scrapeNSDATopics } from './topicScraper';
import { shouldCheckToday, getNextReleaseDates, getCheckFrequencyMinutes } from './topicSchedule';

interface StoredTopics {
  policy: {
    current: string;
    next: string | null;
    season: string;
    lastChecked: string;
  };
  pf: {
    current: string;
    period: string;
    potentialNext: string[] | null;
    lastChecked: string;
    brief: string | null;
    briefGeneratedAt: string | null;
  };
  ld: {
    current: string;
    period: string;
    potentialNext: string[] | null;
    lastChecked: string;
    brief: string | null;
    briefGeneratedAt: string | null;
  };
}

async function getStoredTopics(): Promise<StoredTopics | null> {
  return readJson('topics.json');
}

async function saveTopics(topics: StoredTopics): Promise<void> {
  await writeJson('topics.json', topics);
}

// Tracks resolutions already notified this session — resets on app restart
const notifiedTopics = new Set<string>();

function fireTopicNotification(eventType: 'pf' | 'ld', resolution: string) {
  if (notifiedTopics.has(resolution)) return;
  notifiedTopics.add(resolution);

  const label = eventType === 'pf' ? 'Public Forum' : 'Lincoln-Douglas';
  const body = resolution.length > 100 ? resolution.substring(0, 97) + '...' : resolution;

  fireNotif({
    title: `New ${label} Topic`,
    body: `Resolved: ${body}`,
    target: {
      deepLink: { kind: 'topic', id: eventType },
      rendererEvent: { channel: 'navigate-to-topics', payload: eventType },
    },
  });
}

async function generateTopicBrief(eventType: 'pf' | 'ld', resolution: string): Promise<void> {
  const apiKey = await getSecure('gemini').catch(() => null);
  if (!apiKey) return;

  const label = eventType === 'pf' ? 'Public Forum' : 'Lincoln-Douglas';

  const prompt = `You are an expert ${label} debate coach. A new debate resolution has just been released:

"${resolution}"

Generate a comprehensive topic brief with these sections:

1. **Resolution Breakdown** — explain what the resolution asks, define key terms
2. **Affirmative Arguments** — 3 strongest Aff/Pro arguments with brief explanations and what evidence to find
3. **Negative Arguments** — 3 strongest Neg/Con arguments with brief explanations and what evidence to find
4. **Key Frameworks** — 2-3 likely frameworks debaters will use to evaluate the topic
5. **Core Clash** — what will the central clash of the round be about?
6. **First Research Priorities** — top 5 specific things to research first to build a competitive case
7. **Pitfalls to Avoid** — 2-3 common mistakes debaters will make on this topic

Write for competitive varsity debaters. Be specific and actionable. Use debate terminology where appropriate.`;

  try {
    const briefModelId = await getGeminiModelId();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${briefModelId}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1500 },
        }),
      }
    );
    const data = await res.json() as any;
    const brief = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    if (!brief) return;

    const stored = await getStoredTopics();
    if (!stored) return;
    await saveTopics({
      ...stored,
      [eventType]: {
        ...stored[eventType],
        brief,
        briefGeneratedAt: new Date().toISOString(),
      },
    });

    mainWin?.webContents.send('topics-updated');
  } catch (err) {
    console.error('[Topics] Brief generation failed:', err);
  }
}

async function checkTopicsAndNotify(): Promise<void> {
  const stored = await getStoredTopics();
  const { checkPF, checkLD } = shouldCheckToday();

  if (!stored && !checkPF && !checkLD) return;

  const scraped = await scrapeNSDATopics();
  if (!scraped) return;

  const pfChanged = checkPF && scraped.pf.current !== stored?.pf?.current && !scraped.pf.current.includes('not found');
  const ldChanged = checkLD && scraped.ld.current !== stored?.ld?.current && !scraped.ld.current.includes('not found');

  await saveTopics({
    policy: {
      current: scraped.policy.current,
      next: scraped.policy.next,
      season: scraped.policy.season,
      lastChecked: new Date().toISOString(),
    },
    pf: {
      current: scraped.pf.current,
      period: scraped.pf.period,
      potentialNext: scraped.pf.potentialNext,
      lastChecked: new Date().toISOString(),
      brief: pfChanged ? null : (stored?.pf?.brief ?? null),
      briefGeneratedAt: pfChanged ? null : (stored?.pf?.briefGeneratedAt ?? null),
    },
    ld: {
      current: scraped.ld.current,
      period: scraped.ld.period,
      potentialNext: scraped.ld.potentialNext,
      lastChecked: new Date().toISOString(),
      brief: ldChanged ? null : (stored?.ld?.brief ?? null),
      briefGeneratedAt: ldChanged ? null : (stored?.ld?.briefGeneratedAt ?? null),
    },
  });

  mainWin?.webContents.send('topics-updated');

  if (pfChanged) {
    fireTopicNotification('pf', scraped.pf.current);
    generateTopicBrief('pf', scraped.pf.current); // async, don't await
  }
  if (ldChanged) {
    fireTopicNotification('ld', scraped.ld.current);
    generateTopicBrief('ld', scraped.ld.current); // async, don't await
  }
}

async function checkTopicsOnLaunch(): Promise<void> {
  try {
    await checkTopicsAndNotify();
    await markRunPersisted('topics');
  } catch (err) {
    console.error('[Topics] Launch check failed:', err);
  }
}

let lastTopicPollTime = 0;

function scheduleTopicWatcher(): void {
  setInterval(async () => {
    try {
      const { pf: nextPF, ld: nextLD } = getNextReleaseDates();
      const soonerRelease = [nextPF, nextLD].filter(Boolean).sort()[0] ?? null;
      const frequencyMinutes = getCheckFrequencyMinutes(soonerRelease);
      if (!frequencyMinutes) return;

      const now = Date.now();
      const minutesSinceLastPoll = (now - lastTopicPollTime) / 60000;
      if (minutesSinceLastPoll < frequencyMinutes) return;

      lastTopicPollTime = now;
      await checkTopicsAndNotify();
      await markRunPersisted('topics');
    } catch (err) {
      console.error('[Topics] Watcher error:', err);
    }
  }, 60 * 1000);
}

ipcMain.handle('scrape-nsda-topics', async () => {
  const topics = await scrapeNSDATopics();
  return topics ?? { error: 'Failed to scrape NSDA topics page' };
});

ipcMain.handle('get-stored-topics', async () => {
  return getStoredTopics();
});

ipcMain.handle('save-topics', async (_e, topics: StoredTopics) => {
  await saveTopics(topics);
  return { ok: true };
});

ipcMain.handle('generate-topic-brief', async (_e, { eventType, resolution }: { eventType: 'pf' | 'ld'; resolution: string }) => {
  await generateTopicBrief(eventType, resolution);
  return { success: true };
});

ipcMain.handle('get-next-release-dates', async () => {
  return getNextReleaseDates();
});

ipcMain.handle('get-policy-topic-context', async () => {
  const stored = await getStoredTopics();
  return stored?.policy?.current ?? null;
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

// On macOS, file-open events can fire before the window is ready.
let pendingOpenFilePath: string | null = null;
// A warroom:// deep link received before the renderer is ready (e.g. cold launch
// from a daemon notification click) is buffered here and flushed on did-finish-load.
let pendingDeepLink: string | null = null;

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  // The user explicitly chose to open this file with Warroom (file association),
  // so it's a legitimate trust anchor for the file-read IPC handlers.
  trustPath(filePath);
  persistTrustedPath(filePath);
  if (mainWin?.webContents) {
    mainWin.webContents.send('file:open', filePath);
  } else {
    pendingOpenFilePath = filePath;
  }
});

// ─── Followed-judge + followed-opponent update watcher ────────────────────────

async function checkFollowedJudgeUpdates(): Promise<void> {
  try {
    const db = await readJson('db.json');
    const judges: Record<string, any> = db?.judges ?? {};
    for (const judge of Object.values(judges)) {
      if (!judge?.personId) continue;
      try {
        const { paradigm: newParadigm, lastReviewedAt: newReviewedAt } =
          await tbFetchJudgeData(String(judge.personId));
        if (!newParadigm || !newReviewedAt) continue;

        const storedReviewedAt: string | null = judge.paradigmLastReviewedAt ?? null;
        // Notify only when the Tabroom "Last reviewed on" date advances past what we stored.
        if (storedReviewedAt && newReviewedAt !== storedReviewedAt) {
          fireNotif({
            title: `${judge.name} updated their paradigm`,
            body: newParadigm.slice(0, 120).trim() + (newParadigm.length > 120 ? '…' : ''),
            target: {
              deepLink: { kind: 'judge', id: String(judge.id) },
              rendererEvent: { channel: 'scouting:openJudge', payload: judge.id },
            },
          });
        }

        // Persist the new paradigm + review date regardless (keeps profile up-to-date).
        if (newReviewedAt !== storedReviewedAt || newParadigm !== judge.paradigm) {
          const fresh = await readJson('db.json');
          if (fresh?.judges?.[judge.id]) {
            fresh.judges[judge.id].paradigm = newParadigm;
            fresh.judges[judge.id].paradigmLastReviewedAt = newReviewedAt;
            fresh.judges[judge.id].paradigmFetchedAt = new Date().toISOString();
            await writeJson('db.json', fresh);
          }
        }
      } catch { /* skip this judge on error */ }
    }
  } catch { /* no db or not initialised yet */ }
}

async function checkFollowedOpponentUpdates(): Promise<void> {
  try {
    const db = await readJson('db.json');
    const opponents: Record<string, any> = db?.opponents ?? {};
    for (const opp of Object.values(opponents)) {
      const caselist: string | null = opp?.caselist ?? opp?.disclosures?.caselist ?? null;
      const school: string | null = opp?.school ?? null;
      const teamId: string | null = opp?.teamId ?? null;
      if (!caselist || !school || !teamId) continue;
      try {
        const resolved = await resolveShardName(caselist).catch(() => caselist);
        const data = await ocFetch(`/caselists/${resolved}/schools/${school}/teams/${teamId}/rounds`);
        const rounds: any[] = Array.isArray(data) ? data : data?.rounds ?? [];
        const prevCount: number = opp?.disclosures?.roundsDisclosed ?? 0;
        if (rounds.length > prevCount) {
          const added = rounds.length - prevCount;
          fireNotif({
            title: `${opp.teamName ?? opp.school} added ${added} new round${added > 1 ? 's' : ''}`,
            body: `New disclosure on OpenCaselist`,
            target: {
              deepLink: { kind: 'opponent', id: String(opp.id) },
              rendererEvent: { channel: 'scouting:openOpponent', payload: opp.id },
            },
          });
          // Update stored count
          const fresh = await readJson('db.json');
          if (fresh?.opponents?.[opp.id]?.disclosures) {
            fresh.opponents[opp.id].disclosures.roundsDisclosed = rounds.length;
            fresh.opponents[opp.id].disclosures.pulledAt = new Date().toISOString();
            await writeJson('db.json', fresh);
          }
        }
      } catch { /* skip this opponent on error */ }
    }
  } catch { /* no db or not initialised yet */ }
}

function scheduleScoutingWatcher(): void {
  const INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours
  const runChecks = async () => {
    await checkFollowedJudgeUpdates().catch(() => {});
    await markRunPersisted('judges');
    await checkFollowedOpponentUpdates().catch(() => {});
    await markRunPersisted('opponents');
  };
  // Initial run: 2 minutes after startup so login/auth has time to settle.
  setTimeout(runChecks, 2 * 60 * 1000);
  setInterval(runChecks, INTERVAL_MS);
}

// ─── Headless background daemon (`--daemon`) ──────────────────────────────────

// One pass of the periodic watchers, each gated by (a) the GUI app being closed
// and (b) its own cadence so a 10-minute interval spawn doesn't re-hammer Tabroom.
async function daemonRunPeriodicChecks(): Promise<void> {
  if (await appIsAlive()) { dlog('app is alive — deferring periodic checks'); return; }
  const now = Date.now();
  const runs = await readRuns();

  if (DS.dueForCheck(runs, 'judges', DS.CADENCE.judges, now)) {
    dlog('checking followed judges');
    await checkFollowedJudgeUpdates().catch((e) => dlog('judge check error:', e?.message));
    await markRunPersisted('judges');
  } else dlog('judges not due');

  if (DS.dueForCheck(runs, 'opponents', DS.CADENCE.opponents, now)) {
    dlog('checking followed opponents');
    await checkFollowedOpponentUpdates().catch((e) => dlog('opponent check error:', e?.message));
    await markRunPersisted('opponents');
  } else dlog('opponents not due');

  if (DS.dueForCheck(runs, 'topics', DS.CADENCE.topics, now)) {
    dlog('checking NSDA topics');
    await checkTopicsAndNotify().catch((e) => dlog('topics check error:', e?.message));
    await markRunPersisted('topics');
  } else dlog('topics not due');
}

// Seed the in-memory monitor/inbox config + dedup sets from monitors.json so the
// daemon can run tbPoll/tbInboxPoll. Returns the loaded state.
async function daemonLoadMonitorState(): Promise<DS.MonitorsState> {
  const s = await readMonitors();
  const live = DS.hasActiveMonitor(s);

  if (live && s.monitor) {
    tbMonitorState = {
      dbTournamentId: s.monitor.dbTournamentId,
      tabroomTournId: s.monitor.tabroomTournId,
      tournamentName: s.monitor.tournamentName,
      eventName: s.monitor.eventName,
      entryCode: s.monitor.entryCode,
      caselist: s.monitor.caselist,
      eventType: (s.monitor.eventType as DLEventType) ?? 'policy',
    };
    tbSeenRoundIds.clear();
    for (const id of (s.seenRoundIds ?? [])) tbSeenRoundIds.add(id);
  } else {
    tbMonitorState = null;
  }

  if (live && s.inbox) {
    tbInboxCfg = { entryCode: s.inbox.entryCode, dbTournamentId: s.inbox.dbTournamentId, tournamentName: s.inbox.tournamentName };
    tbInboxCookie = null;
    tbInboxSeenKeys.clear();
    for (const k of (s.seenInboxKeys ?? [])) tbInboxSeenKeys.add(k);
  } else {
    tbInboxCfg = null;
  }
  return s;
}

async function runDaemon(): Promise<void> {
  dlog(`starting — once=${DAEMON_ONCE} pid=${process.pid} packaged=${app.isPackaged}`);
  // Headless: no Dock icon / not the user-facing instance.
  try { if (process.platform === 'darwin') app.setActivationPolicy('prohibited'); } catch {}
  try { app.dock?.hide?.(); } catch {}

  // OpenCaselist creds power opponent + inbox checks.
  await tryAutoLoginOC().catch(() => {});

  // One pass of the cadence-gated periodic watchers.
  await daemonRunPeriodicChecks().catch((e) => dlog('periodic error:', e?.message));

  if (DAEMON_ONCE) {
    dlog('once mode complete — exiting');
    setTimeout(() => app.exit(0), 1200); // let any notification dispatch settle
    return;
  }

  // Resident loop only while a tournament monitor is active (the "hybrid" half).
  let state = await daemonLoadMonitorState();
  if (!DS.hasActiveMonitor(state)) {
    dlog('no active monitor — exiting (interval mode)');
    setTimeout(() => app.exit(0), 1200);
    return;
  }

  dlog('active monitor present — entering resident 60s loop');
  let loopTimer: ReturnType<typeof setInterval> | null = null;
  let lastPeriodic = Date.now();
  const PERIODIC_EVERY = 30 * 60 * 1000;

  const tick = async () => {
    try {
      state = await daemonLoadMonitorState();
      if (!DS.hasActiveMonitor(state)) {
        dlog('monitor cleared/expired — leaving resident loop');
        if (loopTimer) clearInterval(loopTimer);
        setTimeout(() => app.exit(0), 400);
        return;
      }
      if (await appIsAlive()) { dlog('app alive — resident tick deferred'); return; }
      if (tbMonitorState) await tbPoll().catch((e) => dlog('tbPoll error:', e?.message));
      if (tbInboxCfg)     await tbInboxPoll().catch((e) => dlog('inbox poll error:', e?.message));
      if (Date.now() - lastPeriodic >= PERIODIC_EVERY) {
        lastPeriodic = Date.now();
        await daemonRunPeriodicChecks().catch(() => {});
      }
    } catch (e: any) { dlog('tick error:', e?.message); }
  };

  await tick();
  loopTimer = setInterval(tick, 60_000);
}

function showDaemonHeadsUp() {
  try {
    if (ElectronNotification.isSupported()) {
      new ElectronNotification({
        title: 'Warroom background alerts are on',
        body: "You'll get judge, opponent, round, result and topic updates even when Warroom is closed.",
        silent: true,
      }).show();
    }
  } catch {}
}

// Auto-install the OS scheduler entry (packaged builds only). Idempotent — rewrites
// only when missing or the exec path changed. macOS = launchd LaunchAgent;
// Windows = Task Scheduler task. Linux is not supported yet.
async function ensureDaemonInstalled(): Promise<void> {
  if (!app.isPackaged) { dlog('daemon auto-install skipped (dev build)'); return; }
  try {
    if (process.platform === 'darwin') await ensureDaemonInstalledMac();
    else if (process.platform === 'win32') await ensureDaemonInstalledWin();
    else dlog('daemon auto-install unsupported on', process.platform);
  } catch (e: any) {
    console.warn('[Daemon] install error:', e?.message ?? e);
  }
}

async function ensureDaemonInstalledMac(): Promise<void> {
  const home = app.getPath('home');
  const laDir = join(home, 'Library', 'LaunchAgents');
  const plistPath = DS.launchAgentPath(home, DAEMON_LABEL);
  const execPath = process.execPath;
  await DS.ensureRuntimeDir(dataDir());
  const meta: DS.DaemonMeta = (await DS.readJsonFile<DS.DaemonMeta>(DS.daemonMetaPath(dataDir())).catch(() => null)) ?? {};

  const desiredXml = DS.launchAgentPlistXml({
    label: DAEMON_LABEL, execPath, args: ['--daemon'], interval: 600, runAtLoad: true,
    stdout: DS.daemonLogPath(dataDir()), stderr: DS.daemonLogPath(dataDir()),
  });

  let currentXml: string | null = null;
  try { currentXml = await fs.readFile(plistPath, 'utf-8'); } catch {}

  if (currentXml !== desiredXml || meta.installedExecPath !== execPath) {
    await fs.mkdir(laDir, { recursive: true });
    await fs.writeFile(plistPath, desiredXml, 'utf-8');
    await new Promise<void>((res) => execFile('launchctl', ['unload', plistPath], () => res()));
    await new Promise<void>((res) => execFile('launchctl', ['load', '-w', plistPath], () => res()));
    meta.installedExecPath = execPath;
    meta.installedVersion = app.getVersion();
    dlog('installed/updated LaunchAgent at', plistPath);
  }

  if (!meta.headsUpShown) { meta.headsUpShown = true; showDaemonHeadsUp(); }
  await DS.writeJsonFile(DS.daemonMetaPath(dataDir()), meta);
}

async function ensureDaemonInstalledWin(): Promise<void> {
  const execPath = process.execPath;
  await DS.ensureRuntimeDir(dataDir());
  const meta: DS.DaemonMeta = (await DS.readJsonFile<DS.DaemonMeta>(DS.daemonMetaPath(dataDir())).catch(() => null)) ?? {};

  // Is the task already registered for this exact exe path?
  const taskExists = await new Promise<boolean>((res) =>
    execFile('schtasks', ['/query', '/tn', DS.WINDOWS_TASK_NAME], (err) => res(!err)));

  if (!taskExists || meta.installedExecPath !== execPath) {
    const xml = DS.taskSchedulerXml({
      description: 'Warroom background notifications (judges, opponents, rounds, results, topics).',
      execPath, args: '--daemon', intervalMinutes: 10,
    });
    const xmlPath = DS.taskXmlPath(dataDir());
    // Task Scheduler expects a UTF-16LE (with BOM) XML file for /create /xml.
    await fs.writeFile(xmlPath, Buffer.from('\ufeff' + xml, 'utf16le'));
    await new Promise<void>((res) =>
      execFile('schtasks', ['/create', '/tn', DS.WINDOWS_TASK_NAME, '/xml', xmlPath, '/f'], (err, _o, stderr) => {
        if (err) dlog('schtasks create failed:', stderr || err.message);
        else dlog('registered scheduled task', DS.WINDOWS_TASK_NAME);
        res();
      }));
    meta.installedExecPath = execPath;
    meta.installedVersion = app.getVersion();
  }

  if (!meta.headsUpShown) { meta.headsUpShown = true; showDaemonHeadsUp(); }
  await DS.writeJsonFile(DS.daemonMetaPath(dataDir()), meta);
}

app.whenReady().then(async () => {
  // Headless background daemon: skip all window/CSP/UI setup and run the watchers.
  if (DAEMON_MODE) {
    await runDaemon().catch((e) => { console.error('[Daemon] fatal:', e); app.exit(1); });
    return;
  }

  // Restore paths the user previously opened via dialog so recents keep working
  await loadPersistedTrustedPaths();
  // Content-Security-Policy: block injected scripts and unauthorized outbound
  // requests from the renderer. In dev, relax eval/localhost for Vite HMR.
  //
  // Only the app's OWN renderer documents are locked down. The embedded <webview>
  // tags (Open Ev / OpenCaselist / Logos) browse the live web and must reach their
  // own backend APIs (e.g. api.opencaselist.com) — forcing `connect-src 'none'` onto
  // them breaks login/search with "Failed to fetch", so live-web responses keep their
  // own headers untouched.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const reqUrl = details.url || '';
    const isAppRenderer =
      reqUrl.startsWith('file://') || (isDev && !!rendererUrl && reqUrl.startsWith(rendererUrl));
    if (!isAppRenderer) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const csp = isDev
      ? [
          "default-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:* ws://localhost:*",
          "img-src 'self' blob: data: http://localhost:*",
          "media-src 'self' blob:",
          "font-src 'self' data:",
        ].join('; ')
      : [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' blob: data:",
          "media-src 'self' blob:",
          "font-src 'self' data:",
          "connect-src 'none'",
        ].join('; ');
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    });
  });

  await tryAutoLoginOC();
  // Pre-warm Supabase auth: reads session from file storage before the renderer
  // can call chat:getSession. Without this, the async storage read may not have
  // finished by the time the renderer fires its first IPC call, returning null
  // and triggering a spurious sign-out on every restart.
  if (sb) {
    try { await sb.auth.getSession(); } catch {}
  }

  // Cold-start deep link: the daemon spawns us with a warroom:// argv on macOS
  // (open-url won't fire for a raw argv URL), so buffer it for did-finish-load.
  const argvLink = DS.findDeepLinkArg(process.argv);
  if (argvLink) pendingDeepLink = argvLink;

  createWindow();

  // Heartbeat so the daemon knows the app is alive and defers to it.
  startHeartbeat();
  // Install the background daemon (macOS packaged builds only; idempotent).
  ensureDaemonInstalled().catch(() => {});

  // Topic check — runs after window is created, fully non-blocking
  setImmediate(() => {
    checkTopicsOnLaunch().catch(() => {});
    scheduleTopicWatcher();
    scheduleScoutingWatcher();
  });
});
// Only the GUI process owns the heartbeat file — never let a daemon process clear it.
app.on('before-quit', () => { if (!DAEMON_MODE) clearHeartbeat().catch(() => {}); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Custom URL scheme (warroom://) — recovery + daemon deep links ──────────────
// The headless daemon must NOT register as protocol client nor take the
// single-instance lock — doing either would interfere with the GUI app.
if (!DAEMON_MODE) {
  // Registering as default protocol client must happen before app is ready on
  // Windows; on macOS it can happen any time. Harmless to call unconditionally.
  app.setAsDefaultProtocolClient('warroom');

  // macOS: the OS delivers deep links via open-url even when app is already open.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // Windows / Linux: a second instance is launched with the URL as an argv arg.
  // We grab the lock so only one Warroom window exists, then forward the URL.
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', (_event, argv) => {
      const url = argv.find((a) => a.startsWith('warroom://'));
      if (url) handleDeepLink(url);
      if (mainWin) { mainWin.show(); mainWin.focus(); }
    });
  }
}

async function handleDeepLink(url: string) {
  try {
    // Scouting/topic deep links from daemon notification clicks:
    //   warroom://open/judge/<id> · warroom://open/opponent/<id>
    //   warroom://open/tournament/<id>?round=<n> · warroom://topics/<pf|ld>
    const target = DS.parseDeepLink(url);
    if (target) {
      // If the renderer isn't ready yet (cold launch), buffer and flush later.
      if (!mainWin || mainWin.webContents.isLoading()) { pendingDeepLink = url; }
      if (mainWin) { mainWin.show(); mainWin.focus(); }
      const wc = mainWin?.webContents;
      if (wc && !wc.isLoading()) {
        switch (target.kind) {
          case 'judge':      wc.send('scouting:openJudge', target.id); break;
          case 'opponent':   wc.send('scouting:openOpponent', target.id); break;
          case 'topic':      wc.send('navigate-to-topics', target.id); break;
          case 'tournament': wc.send('tabroom:monitor:notifClick', { dbTournamentId: target.id, roundNumber: target.round ?? 0 }); break;
        }
      }
      return;
    }

    // Supabase v2 PKCE recovery links look like:
    //   warroom://auth?token_hash=<hash>&type=recovery
    const parsed = new URL(url);
    const tokenHash = parsed.searchParams.get('token_hash');
    const type = parsed.searchParams.get('type');
    if (type === 'recovery' && tokenHash && sb) {
      const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
      if (!error) {
        // Bring window to front, then tell the renderer to show the new-password form.
        if (mainWin) { mainWin.show(); mainWin.focus(); }
        mainWin?.webContents.send('auth:recovery');
      }
    }
  } catch {}
}
