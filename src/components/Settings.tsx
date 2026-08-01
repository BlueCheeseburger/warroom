import React, { useState, useEffect } from 'react';
import { useApp, mapSettingsEvent, Direction, Theme, CARD_OUTDATED_YEARS_DEFAULT, TIMER_WARNING_SECS_DEFAULT } from '../store/appStore';
import { signOut } from '../lib/supabase';
import { AutoFlowTagStyle, AUTOFLOW_STYLE_DEFAULTS, readAutoFlowTagStyle, writeAutoFlowTagStyle } from '../lib/autoFlowTagStyle';
import { FlowPrefs, FLOW_PREFS_DEFAULTS, readFlowPrefs, writeFlowPrefs } from '../lib/flowPrefs';
import { exportSettings, importSettings } from '../utils/settingsExport';
import {
  FilesBarStyle, getFilesBarStyle, setFilesBarStyle,
  isQuickChatEnabled, setQuickChatEnabled, getQuickChatPins,
} from '../lib/chatPrefs';
import QuickChatPicker from './QuickChatPicker';

type Palette = { bg: string; card: string; accent: string; ink: string; line: string };
const THEME_OPTIONS: {
  value: Direction; label: string; blurb: string; light: Palette; dark: Palette;
}[] = [
  { value: 'calm', label: 'Calm Native', blurb: 'Cool & modern',
    light: { bg: '#edeff3', card: '#ffffff', accent: '#4b53c4', ink: '#1b1d24', line: 'rgba(30,40,70,0.12)' },
    dark:  { bg: '#1a1c21', card: '#25272e', accent: '#7c82ee', ink: '#eef0f6', line: 'rgba(180,195,235,0.18)' } },
  { value: 'paper', label: 'Warm Paper', blurb: 'Editorial serif',
    light: { bg: '#f5f1e8', card: '#fbf9f3', accent: '#b4532a', ink: '#2b2722', line: 'rgba(60,45,25,0.16)' },
    dark:  { bg: '#24201a', card: '#2c2820', accent: '#e08a5a', ink: '#efe7d6', line: 'rgba(239,231,214,0.2)' } },
  { value: 'editorial', label: 'Sharp Editorial', blurb: 'High contrast',
    light: { bg: '#fafafa', card: '#ffffff', accent: '#155fff', ink: '#111113', line: 'rgba(17,17,19,0.14)' },
    dark:  { bg: '#0e0e10', card: '#1a1a1d', accent: '#4d8bff', ink: '#fafafa', line: 'rgba(250,250,250,0.2)' } },
];

const MODE_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light',  label: 'Light' },
  { value: 'dark',   label: 'Dark' },
];

const EVENT_OPTIONS = [
  { value: 'hspolicy', label: 'HS Policy' },
  { value: 'hsld',     label: 'HS LD' },
  { value: 'hspf',     label: 'HS PF' },
  { value: 'ndtceda',  label: 'College Policy (NDT/CEDA)' },
  { value: 'nfald',    label: 'College LD (NFA-LD)' },
];

const GEMINI_MODEL_OPTIONS = [
  {
    value: 'flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    tooltip: 'Cheapest option — lower cost per request, faster responses. Good for most scouting tasks. Token saving auto-enabled.',
  },
  {
    value: 'flash',
    label: 'Gemini 2.5 Flash',
    tooltip: 'Best balance of cost and quality. Recommended for most users.',
  },
  {
    value: 'flash-35',
    label: 'Gemini 3.5 Flash',
    tooltip: 'Highest quality — Google\'s latest Flash model. Best for complex analysis and card evaluation.',
  },
];

const OPENAI_MODEL_OPTIONS = [
  {
    value: 'gpt-4.1-nano',
    label: 'GPT-4.1 nano',
    tooltip: 'Cheapest and fastest OpenAI model. Good for quick lookups and simple tasks.',
    default: false,
  },
  {
    value: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    tooltip: 'Best balance of speed, quality, and cost. Recommended for most users.',
    default: true,
  },
  {
    value: 'gpt-4.1',
    label: 'GPT-4.1',
    tooltip: 'Most capable GPT-4.1 model. Best for complex analysis and card evaluation.',
    default: false,
  },
];

const ANTHROPIC_MODEL_OPTIONS = [
  {
    value: 'claude-3-5-haiku-20241022',
    label: 'Claude Haiku 3.5',
    tooltip: 'Fastest and cheapest Claude model. Good for quick lookups and summaries.',
    default: false,
  },
  {
    value: 'claude-3-5-sonnet-20241022',
    label: 'Claude Sonnet 3.5',
    tooltip: 'Best balance of speed, quality, and cost. Recommended for most users.',
    default: true,
  },
  {
    value: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    tooltip: 'Most powerful Claude model. Best for deep argument analysis and complex research.',
    default: false,
  },
];

// ─── Model tier system (mirrors electron/main.ts getProviderForTask) ───────────
// Every provider has 3 tiers: lite (cheapest), balanced (default), best (highest quality).
// Some tasks always override the user's chosen tier — these are the "exceptions"
// shown in the model picker so users understand what actually happens when they pick
// Lite or Balanced.

type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'grok' | 'lmstudio';

// Keys mirror NOTIF_CATEGORY_SETTINGS_KEY in electron/main.ts — a typo in either
// place just makes a toggle a no-op rather than a crash, so keep them in sync by hand.
type NotifyKey = 'notifyPairings' | 'notifyResults' | 'notifyTopics' | 'notifyJudges' | 'notifyOpponents';
const NOTIFY_OPTIONS: { key: NotifyKey; label: string; blurb: string }[] = [
  { key: 'notifyPairings',  label: 'New pairings',       blurb: 'A round is posted on Tabroom during a tournament you’re monitoring.' },
  { key: 'notifyResults',   label: 'Round results',      blurb: 'A result is posted to your Tabroom inbox.' },
  { key: 'notifyTopics',    label: 'New topics',         blurb: 'A new PF or LD resolution is released.' },
  { key: 'notifyJudges',    label: 'Judge paradigm updates', blurb: 'A judge you’ve looked up updates their paradigm on Tabroom.' },
  { key: 'notifyOpponents', label: 'Opponent disclosures', blurb: 'A tracked opponent discloses new rounds on OpenCaselist.' },
];
type ModelTier = 'lite' | 'balanced' | 'best';

const TIER_LABELS: Record<AIProvider, { lite: string; balanced: string; best: string }> = {
  gemini:    { lite: 'Gemini 2.5 Flash Lite', balanced: 'Gemini 2.5 Flash',      best: 'Gemini 3.5 Flash' },
  openai:    { lite: 'GPT-4.1 nano',          balanced: 'GPT-4.1 mini',          best: 'GPT-4.1' },
  anthropic: { lite: 'Claude Haiku 3.5',      balanced: 'Claude Sonnet 3.5',     best: 'Claude Sonnet 4.6' },
  grok:      { lite: 'Grok 3 mini',           balanced: 'Grok 3 fast',           best: 'Grok 3' },
  // Local models have no cost tiers — the one loaded model runs every task.
  lmstudio:  { lite: 'your local model',      balanced: 'your local model',      best: 'your local model' },
};

// ─── LM Studio ────────────────────────────────────────────────────────────────
// Runs entirely on the user's machine via LM Studio's OpenAI-compatible local
// server — no API key, no per-token cost, works offline.

const LMSTUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1';
const LMSTUDIO_DEFAULT_MODEL = 'google/gemma-4-12b';

/**
 * Preset model ids. These are convenience shortcuts, NOT a whitelist — the id
 * LM Studio expects depends on how the user downloaded the model, so the free-text
 * field and the "Loaded models" list below it are the authoritative way to pick
 * one. Anything typed or fetched works just as well as a preset.
 */
const LMSTUDIO_MODEL_OPTIONS = [
  {
    value: 'google/gemma-4-12b-qat',
    label: 'Gemma 4 12B QAT',
    tooltip: 'Gemma 4 12B optimised with Quantization-Aware Training — near-12B quality at a much smaller memory footprint. Best pick if 12B is tight on your machine.',
    default: false,
  },
  {
    value: LMSTUDIO_DEFAULT_MODEL,
    label: 'Gemma 4 12B',
    tooltip: 'Gemma 4 12B unified reasoning model. The default — strongest of the three, but needs the most RAM/VRAM.',
    default: true,
  },
  {
    value: 'google/gemma-4-e4b',
    label: 'Gemma 4 E4B',
    tooltip: 'Gemma 4 effective-4B version. Fastest and lightest — use this if the 12B models are slow or run out of memory.',
    default: false,
  },
] as const;

/** Starting point for the options blob, shown as the placeholder in Settings
 *  and auto-filled in on first focus so the user edits instead of typing from scratch. */
const LMSTUDIO_OPTIONS_EXAMPLE = '{\n  "temperature": 0.1,\n  "max_tokens": 8192,\n  "top_p": 0.95,\n  "ttl": 3600\n}';

/** Same auto-fill treatment for the per-call model override field — every AI
 *  call in the app already resolves to one of these three tiers (see
 *  getProviderForTask in electron/main.ts), so this is genuinely "one entry
 *  per call" without needing a per-feature id for every handler. */
const LMSTUDIO_PERCALL_EXAMPLE = '{\n  "lite": "google/gemma-4-e4b",\n  "balanced": "google/gemma-4-12b",\n  "best": "google/gemma-4-12b-qat"\n}';

function getModelTier(provider: AIProvider, modelKey: string): ModelTier {
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
  if (provider === 'grok') {
    if (modelKey === 'grok-3-mini') return 'lite';
    if (modelKey === 'grok-3')      return 'best';
    return 'balanced';
  }
  // anthropic
  if (modelKey === 'claude-3-5-haiku-20241022') return 'lite';
  if (modelKey === 'claude-sonnet-4-6')         return 'best';
  return 'balanced';
}

/** Plain-language note explaining which tasks override the selected tier. Only Lite and
 *  Balanced have exceptions worth calling out — Best is used as-selected everywhere. */
function ModelExceptionNote({ provider, tier }: { provider: AIProvider; tier: ModelTier }) {
  const labels = TIER_LABELS[provider];
  if (tier === 'lite') {
    return (
      <p className="text-[11px] mt-2 px-3 py-2 rounded-lg leading-relaxed"
        style={{ background: 'var(--bg-input)', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-side)' }}>
        <strong style={{ color: 'var(--ink)' }}>Heads up:</strong> the AI chat and card extraction will still
        run on <strong style={{ color: 'var(--ink)' }}>{labels.balanced}</strong> even with Lite selected —
        Lite alone isn't reliable enough for those. Lite is used for cheap, low-stakes jobs like naming your
        chats and suggesting blocks.
      </p>
    );
  }
  if (tier === 'balanced') {
    return (
      <p className="text-[11px] mt-2 px-3 py-2 rounded-lg leading-relaxed"
        style={{ background: 'var(--bg-input)', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-side)' }}>
        <strong style={{ color: 'var(--ink)' }}>Heads up:</strong> chat titles are still generated with the
        cheaper <strong style={{ color: 'var(--ink)' }}>{labels.lite}</strong> to save cost — everything else
        (chat, card extraction) uses {labels.balanced} as selected.
      </p>
    );
  }
  return null;
}

// ─── Settings outline nav ───────────────────────────────────────────────────
// Jump-to-section list down the left side, mirroring the `settings-*` ids on
// each card below in document order. Highlights whichever section is nearest
// the top of the viewport via IntersectionObserver, so it also works as a
// passive "where am I" indicator while scrolling, not just a click target.

const SETTINGS_NAV: { id: string; label: string }[] = [
  { id: 'settings-appearance',      label: 'Appearance' },
  { id: 'settings-speechdocs',      label: 'Speech docs & cases' },
  { id: 'settings-general',         label: 'General' },
  { id: 'settings-event',           label: 'Debate event' },
  { id: 'settings-apikey',          label: 'AI API key' },
  { id: 'settings-opencaselist',    label: 'OpenCaselist & Tabroom' },
  { id: 'settings-gdrive',          label: 'Google Drive' },
  { id: 'settings-flow',            label: 'Flow' },
  { id: 'settings-autoflow-style',  label: 'Auto Flow style' },
  { id: 'settings-storage',         label: 'Storage' },
  { id: 'settings-documentation',   label: 'Documentation' },
  { id: 'settings-usermanual',      label: 'User Manual' },
  { id: 'settings-shortcuts',       label: 'Keyboard Shortcuts' },
  { id: 'settings-importexport',    label: 'Import / Export' },
  { id: 'settings-more',            label: 'More settings' },
];

function SettingsOutline() {
  const [active, setActive] = useState(SETTINGS_NAV[0].id);
  const [query, setQuery] = useState('');
  // Bumped whenever any settings content could have changed shape (loaded
  // async, a collapsible opened, a toggle changed) so the search below
  // re-reads fresh DOM text instead of a stale snapshot.
  const [, bumpSearchIndex] = useState(0);

  useEffect(() => {
    const els = SETTINGS_NAV
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-88px 0px -65% 0px', threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));

    // Settings sections re-render constantly (toggles, async-loaded values,
    // the LM Studio Advanced panel opening/closing) — rather than hand-
    // maintain a keyword list that inevitably drifts from what's actually on
    // the page, re-index on every DOM mutation inside the settings column so
    // the filter box always searches the words that are really there right now.
    const mutObserver = new MutationObserver(() => bumpSearchIndex((n) => n + 1));
    const root = els[0].closest('.max-w-2xl') ?? els[0].parentElement;
    if (root) mutObserver.observe(root, { childList: true, subtree: true, characterData: true });

    return () => { observer.disconnect(); mutObserver.disconnect(); };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? SETTINGS_NAV.filter((s) => {
        if (s.label.toLowerCase().includes(q)) return true;
        const text = document.getElementById(s.id)?.textContent ?? '';
        return text.toLowerCase().includes(q);
      })
    : SETTINGS_NAV;

  return (
    <nav className="hidden lg:block shrink-0 sticky self-start" style={{ width: 172, top: 24 }}>
      <div className="relative mb-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter settings…"
          className="input w-full text-xs"
          style={{ paddingLeft: 24 }}
        />
        <svg width="11" height="11" viewBox="0 0 20 20" fill="none"
          stroke="var(--nav-inactive-color)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <circle cx="8.5" cy="8.5" r="5" />
          <path d="M12.5 12.5L17 17" />
        </svg>
      </div>
      {filtered.length === 0 ? (
        <p className="text-[11px] px-2.5 py-2" style={{ color: 'var(--nav-inactive-color)' }}>No matches</p>
      ) : (
        filtered.map((s) => {
          const isActive = active === s.id;
          return (
            <button
              key={s.id}
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="w-full text-left px-2.5 py-1.5 rounded-md text-xs transition truncate block"
              style={{
                background: isActive ? 'var(--nav-active-bg)' : 'transparent',
                color: isActive ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
                fontWeight: isActive ? 600 : 400,
                border: 'none', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
              onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {s.label}
            </button>
          );
        })
      )}
    </nav>
  );
}

function GDriveSettings() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [savedId, setSavedId] = useState('');
  const [savedSecret, setSavedSecret] = useState('');
  const [credSaved, setCredSaved] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectErr, setConnectErr] = useState('');

  useEffect(() => {
    Promise.all([
      window.warroom?.secure.get('gdrive_client_id'),
      window.warroom?.secure.get('gdrive_client_secret'),
      window.warroom?.gdrive?.status(),
    ]).then(([id, sec, status]) => {
      if (id) { setClientId(id); setSavedId(id); }
      if (sec) { setClientSecret(sec); setSavedSecret(sec); }
      setConnected(!!status?.connected);
    });
  }, []);

  async function saveCredentials() {
    if (!clientId.trim() || !clientSecret.trim()) return;
    await window.warroom.secure.set('gdrive_client_id', clientId.trim());
    await window.warroom.secure.set('gdrive_client_secret', clientSecret.trim());
    setSavedId(clientId.trim()); setSavedSecret(clientSecret.trim());
    setCredSaved(true); setTimeout(() => setCredSaved(false), 2000);
  }

  async function connect() {
    setConnecting(true); setConnectErr('');
    const res = await window.warroom.gdrive.connect();
    setConnecting(false);
    if (!res.ok) { setConnectErr(res.error ?? 'Connection failed'); return; }
    setConnected(true);
  }

  async function disconnect() {
    await window.warroom.gdrive.disconnect();
    setConnected(false);
  }

  const credsSaved = savedId && savedSecret;
  const credsUnchanged = clientId === savedId && clientSecret === savedSecret && credsSaved;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className="input flex-1 font-mono text-xs" type="text"
          placeholder="Client ID (…apps.googleusercontent.com)"
          value={clientId} onChange={e => setClientId(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <input className="input flex-1 font-mono text-xs" type="password"
          placeholder="Client Secret (GOCSPX-…)"
          value={clientSecret} onChange={e => setClientSecret(e.target.value)} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn-primary" onClick={saveCredentials}
          disabled={!clientId.trim() || !clientSecret.trim()}>
          {credSaved ? 'Saved ✓' : credsUnchanged ? 'Edit' : 'Save credentials'}
        </button>
        {credsSaved && !connected && (
          <button className="btn-primary" onClick={connect} disabled={connecting}>
            {connecting ? 'Opening browser…' : 'Connect Drive'}
          </button>
        )}
        {connected && (
          <>
            <span className="text-xs font-medium" style={{ color: '#0f9d58' }}>Connected ✓</span>
            <button className="text-xs transition"
              style={{ color: 'var(--nav-inactive-color)', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--danger, #ef4444)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}
              onClick={disconnect}>Disconnect</button>
          </>
        )}
      </div>
      {connectErr && <p className="text-xs" style={{ color: 'var(--danger, #ef4444)' }}>{connectErr}</p>}
    </div>
  );
}

export default function Settings() {
  const {
    currentUser, setCurrentUser, setCurrentTeam, setTeamMembers, defaultSharePermission, setDefaultSharePermission,
    setEvent, setShowOnboarding, setView, view, direction, setDirection, theme, setTheme, setShortcutsOpen,
    cardOutdatedYears, setCardOutdatedYears, reduceMotion, setReduceMotion, skipDeleteConfirm, setSkipDeleteConfirm,
    timerWarningSecs, setTimerWarningSecs,
  } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);
  const [filesBarStyle, setFilesBarStyleLocal] = useState<FilesBarStyle>(getFilesBarStyle());
  const [quickChatEnabled, setQuickChatEnabledLocal] = useState(isQuickChatEnabled());
  const [showQuickChatPicker, setShowQuickChatPicker] = useState(false);
  const [settingsExportStatus, setSettingsExportStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [settingsExportMsg, setSettingsExportMsg] = useState('');
  const [settingsImportStatus, setSettingsImportStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [settingsImportMsg, setSettingsImportMsg] = useState('');

  async function handleExportSettings() {
    setSettingsExportStatus('working'); setSettingsExportMsg('');
    const res = await exportSettings();
    if (res.canceled) { setSettingsExportStatus('idle'); return; }
    if (!res.ok) { setSettingsExportStatus('error'); setSettingsExportMsg(res.error ?? 'Export failed'); return; }
    setSettingsExportStatus('done');
    setTimeout(() => setSettingsExportStatus('idle'), 2500);
  }

  async function handleImportSettings() {
    setSettingsImportStatus('working'); setSettingsImportMsg('');
    const res = await importSettings();
    if (res.canceled) { setSettingsImportStatus('idle'); return; }
    if (!res.ok) { setSettingsImportStatus('error'); setSettingsImportMsg(res.error ?? 'Import failed'); return; }
    setSettingsImportStatus('done');
    setSettingsImportMsg('Some settings (like theme) need a restart to fully apply.');
  }

  // Whether the app is *effectively* dark right now, so the theme previews
  // reflect the live mode (system follows the OS preference).
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handle = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handle);
    return () => mq.removeEventListener('change', handle);
  }, []);
  const isDark = theme === 'dark' || (theme === 'system' && systemDark);

  useEffect(() => {
    if (view.kind === 'settings' && (view as any).scrollTo) {
      const el = document.getElementById(`settings-${(view as any).scrollTo}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);
  const [apiProvider, setApiProvider] = useState<AIProvider>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  // saved values per provider — used to show Edit vs Save and to restore when switching tabs
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>({ gemini: '', openai: '', anthropic: '', grok: '' });
  // ── LM Studio (local server — no API key) ──────────────────────────────────
  const [lmBaseUrl, setLmBaseUrl] = useState(LMSTUDIO_DEFAULT_BASE_URL);
  const [lmModel, setLmModel] = useState(LMSTUDIO_DEFAULT_MODEL);
  const [lmOptions, setLmOptions] = useState('');
  const [lmTools, setLmTools] = useState(true);
  const [lmPerCallModels, setLmPerCallModels] = useState('');
  const [lmAdvancedOpen, setLmAdvancedOpen] = useState(false);
  const [lmSaved, setLmSaved] = useState(false);
  // What's actually persisted — the Save button's label/style is driven off
  // whether the current fields differ from this, not off an ephemeral flash,
  // so it doesn't misleadingly say "Save" again just because a re-render or
  // scroll happened after a successful save.
  const [lmSnapshot, setLmSnapshot] = useState({
    baseUrl: LMSTUDIO_DEFAULT_BASE_URL, model: LMSTUDIO_DEFAULT_MODEL, options: '', tools: true, perCallModels: '',
  });
  const lmDirty =
    lmBaseUrl.trim() !== lmSnapshot.baseUrl ||
    (lmModel.trim() || LMSTUDIO_DEFAULT_MODEL) !== lmSnapshot.model ||
    lmOptions !== lmSnapshot.options ||
    lmTools !== lmSnapshot.tools ||
    lmPerCallModels !== lmSnapshot.perCallModels;
  // API key box has its own draft-vs-saved gap too (typed but not yet clicked
  // Save/Edit) — folded into the same "unsaved changes" concept below.
  const apiKeyDirty = apiProvider !== 'lmstudio' && apiKey !== (savedKeys[apiProvider] ?? '');
  /** Model ids fetched from the running server — null until the user asks for them. */
  const [lmFound, setLmFound] = useState<string[] | null>(null);
  // Separate from `lmFound` itself so re-collapsing doesn't throw away the last
  // fetch — clicking "Loaded models" again just toggles visibility unless the
  // list has never been fetched yet.
  const [lmLoadedOpen, setLmLoadedOpen] = useState(false);
  const [lmBusy, setLmBusy] = useState<null | 'list' | 'test'>(null);
  const [lmMsg, setLmMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const lmPerCallModelsError = (() => {
    const raw = lmPerCallModels.trim();
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object' || Array.isArray(p)) return 'Must be a JSON object, e.g. { "lite": "…", "balanced": "…", "best": "…" }';
      return null;
    } catch (e: any) {
      return `Not valid JSON — ${e?.message ?? 'check the syntax'}`;
    }
  })();
  // True once any tier has a real (non-blank) override — at that point the
  // presets/Loaded models buttons above stop reflecting a "current" model,
  // since the user is choosing per-tier models in the JSON instead.
  const lmPerCallActive = !lmPerCallModelsError && (() => {
    const raw = lmPerCallModels.trim();
    if (!raw) return false;
    try {
      const p = JSON.parse(raw);
      return p && typeof p === 'object' && !Array.isArray(p) &&
        (['lite', 'balanced', 'best'] as const).some((t) => String(p[t] ?? '').trim());
    } catch { return false; }
  })();

  /** Invalid JSON in the options box is surfaced inline; main.ts also ignores it rather than failing a call. */
  const lmOptionsError = (() => {
    const raw = lmOptions.trim();
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object' || Array.isArray(p)) return 'Must be a JSON object, e.g. { "temperature": 0.1 }';
      return null;
    } catch (e: any) {
      return `Not valid JSON — ${e?.message ?? 'check the syntax'}`;
    }
  })();
  const [geminiModel, setGeminiModel] = useState('flash');
  const [geminiModelSaved, setGeminiModelSaved] = useState(false);
  const [tokenSavingDefault, setTokenSavingDefault] = useState(false);
  // Background notification categories — main-process state (electron/main.ts's
  // fireNotif gate), not localStorage, since the headless daemon fires these too
  // and needs the same app_settings file the GUI reads/writes. All default ON.
  const [notifySettings, setNotifySettingsState] = useState<Record<NotifyKey, boolean>>({
    notifyPairings: true, notifyResults: true, notifyTopics: true, notifyJudges: true, notifyOpponents: true,
  });
  async function setNotifySetting(key: NotifyKey, val: boolean) {
    setNotifySettingsState((prev) => ({ ...prev, [key]: val }));
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, [key]: val });
  }
  // Card Cutter's current-year short-cite style — main-process state (read by
  // electron/main.ts's cutter_read_source prompt), not localStorage, for the
  // same reason as the notify categories above. Default 'month-day' matches
  // the card_cutting skill's long-standing built-in convention.
  const [citeYearFormat, setCiteYearFormatState] = useState<'month-day' | 'year'>('month-day');
  async function setCiteYearFormat(val: 'month-day' | 'year') {
    setCiteYearFormatState(val);
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, citeYearFormat: val });
  }
  const generalSettingsAreDefault =
    cardOutdatedYears === CARD_OUTDATED_YEARS_DEFAULT &&
    citeYearFormat === 'month-day' &&
    timerWarningSecs === TIMER_WARNING_SECS_DEFAULT &&
    !reduceMotion && !skipDeleteConfirm &&
    Object.values(notifySettings).every(Boolean);
  async function resetGeneralSettings() {
    setCardOutdatedYears(CARD_OUTDATED_YEARS_DEFAULT);
    setCiteYearFormat('month-day');
    setTimerWarningSecs(TIMER_WARNING_SECS_DEFAULT);
    setReduceMotion(false);
    setSkipDeleteConfirm(false);
    (Object.keys(notifySettings) as NotifyKey[]).forEach((k) => setNotifySetting(k, true));
  }
  // Offline dictation (Beta) — a local Whisper model via @huggingface/transformers,
  // main-process state (electron/offlineWhisper.ts) since that's where the model
  // actually lives and runs. Not part of resetGeneralSettings: a ~40-80MB model
  // download shouldn't get silently undone by a "reset to defaults" click.
  const [dictationUseOffline, setDictationUseOfflineState] = useState(false);
  const [offlineModelReady, setOfflineModelReady] = useState(false);
  const [offlineDownloading, setOfflineDownloading] = useState(false);
  // Aggregate percentage across every file in the model download (the model
  // is several separate files — weights, tokenizer, config — each of which
  // reports its own 0-100 independently; this is the running total across
  // all of them, not whatever the most recent file happens to report, so it
  // doesn't visibly reset to 0 every time a new file starts).
  const [offlineDownloadPct, setOfflineDownloadPct] = useState<number | null>(null);
  const [offlineDownloadLabel, setOfflineDownloadLabel] = useState('');
  const [offlineDownloadError, setOfflineDownloadError] = useState('');
  async function setDictationUseOffline(val: boolean) {
    setDictationUseOfflineState(val);
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, dictationUseOffline: val });
  }
  /** Same "silently does nothing" failure mode as the LM Studio bridge check
   *  above, same fix: this API only exists on `window.warroom` once the
   *  preload script that defines it has actually loaded, which — unlike the
   *  renderer's own hot-reloaded code — only happens when Electron's main
   *  process starts. A build that added this IPC surface after the app was
   *  already running leaves the button looking dead instead of erroring. */
  function dictationBridge() {
    const bridge = (window.warroom as any)?.dictation;
    if (!bridge?.downloadOfflineModel || !bridge?.offlineModelStatus) return null;
    return bridge;
  }
  const DICTATION_NO_BRIDGE = 'Warroom needs a restart to load offline dictation (it is set up when the app starts). Quit and reopen Warroom, then try again.';

  async function downloadOfflineModel() {
    // Set the loading state before anything async, including the bridge
    // check itself — the button's own disabled/label change is the first
    // bit of feedback, so it must never wait on an IPC round-trip to appear.
    setOfflineDownloading(true);
    setOfflineDownloadPct(null);
    setOfflineDownloadLabel('');
    setOfflineDownloadError('');
    const bridge = dictationBridge();
    if (!bridge) {
      setOfflineDownloading(false);
      setOfflineDownloadError(DICTATION_NO_BRIDGE);
      return;
    }
    const unsub = bridge.onOfflineModelProgress?.((p: any) => {
      if (typeof p?.overallPct === 'number') setOfflineDownloadPct(p.overallPct);
      if (typeof p?.label === 'string' && p.label) setOfflineDownloadLabel(p.label);
    });
    try {
      const res = await bridge.downloadOfflineModel();
      if (res?.ok) { setOfflineModelReady(true); setDictationUseOffline(true); }
      else setOfflineDownloadError(res?.error ?? 'Download failed.');
    } catch (e: any) {
      setOfflineDownloadError(e?.message ?? 'Download failed.');
    } finally {
      unsub?.();
      setOfflineDownloading(false);
      setOfflineDownloadPct(null);
      setOfflineDownloadLabel('');
    }
  }
  // Speech doc reading pref (renderer-only display setting, like flow colors —
  // no main-process/IPC need). Default ON: dark-mode users still read the
  // actual doc page as light "paper" while the rest of the app stays dark.
  const [docLightInDark, setDocLightInDarkState] = useState(
    () => localStorage.getItem('warroom-doc-light-in-dark') !== 'false'
  );
  function setDocLightInDark(val: boolean) {
    localStorage.setItem('warroom-doc-light-in-dark', String(val));
    setDocLightInDarkState(val);
    window.dispatchEvent(new CustomEvent('warroom-doc-light-changed', { detail: { docLightInDark: val } }));
  }
  // How much of the doc's real Word page margins to keep, as a percentage —
  // 0 = edge-to-edge text, 100 = the full margin the doc was authored with.
  // Same renderer-only pattern as docLightInDark just above.
  const [docMarginPct, setDocMarginPctState] = useState(() => {
    const v = parseInt(localStorage.getItem('warroom-doc-margin-pct') ?? '50', 10);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 25;
  });
  function setDocMarginPct(val: number) {
    localStorage.setItem('warroom-doc-margin-pct', String(val));
    setDocMarginPctState(val);
    window.dispatchEvent(new CustomEvent('warroom-doc-margin-changed', { detail: { pct: val } }));
  }
  // Reading-scale for the whole doc page (text, cards, everything) — a plain
  // CSS zoom on the render container, same renderer-only pattern as above.
  const [docZoomPct, setDocZoomPctState] = useState(() => {
    const v = parseInt(localStorage.getItem('warroom-doc-zoom-pct') ?? '100', 10);
    return Number.isFinite(v) ? Math.min(150, Math.max(80, v)) : 100;
  });
  function setDocZoomPct(val: number) {
    localStorage.setItem('warroom-doc-zoom-pct', String(val));
    setDocZoomPctState(val);
    window.dispatchEvent(new CustomEvent('warroom-doc-zoom-changed', { detail: { pct: val } }));
  }
  // On: every doc opens with the outline drawer showing. Off: it never
  // auto-opens (the user can still open it manually via the pull-tab).
  const [docAutoOutline, setDocAutoOutlineState] = useState(
    () => localStorage.getItem('warroom-doc-auto-outline') === 'true'
  );
  function setDocAutoOutline(val: boolean) {
    localStorage.setItem('warroom-doc-auto-outline', String(val));
    setDocAutoOutlineState(val);
  }
  // Start every doc already in Focus mode (hide body text, show card structure).
  const [docStartFocus, setDocStartFocusState] = useState(
    () => localStorage.getItem('warroom-doc-start-focus') === 'true'
  );
  function setDocStartFocus(val: boolean) {
    localStorage.setItem('warroom-doc-start-focus', String(val));
    setDocStartFocusState(val);
  }
  // How opening an outline in a multi-pane compare view affects the other
  // panes — 'space' (default) opens a dedicated non-adjustable column and
  // reflows the row (may scroll horizontally); 'squish' just borrows the
  // outline's width from a neighboring pane, staying within the viewport.
  const [docOutlineLayout, setDocOutlineLayoutState] = useState<'squish' | 'space'>(
    () => (localStorage.getItem('warroom-doc-outline-layout') === 'squish' ? 'squish' : 'space')
  );
  function setDocOutlineLayout(val: 'squish' | 'space') {
    localStorage.setItem('warroom-doc-outline-layout', val);
    setDocOutlineLayoutState(val);
    window.dispatchEvent(new CustomEvent('warroom-doc-outline-layout-changed', { detail: { method: val } }));
  }
  const speechDocSettingsAreDefault =
    docLightInDark && docMarginPct === 50 && docZoomPct === 100 && !docAutoOutline && !docStartFocus && docOutlineLayout === 'space';
  function resetSpeechDocSettings() {
    setDocLightInDark(true);
    setDocMarginPct(50);
    setDocZoomPct(100);
    setDocAutoOutline(false);
    setDocStartFocus(false);
    setDocOutlineLayout('space');
  }
  const [openaiModel, setOpenaiModel] = useState('gpt-4.1-mini');
  const [openaiModelSaved, setOpenaiModelSaved] = useState(false);
  const [anthropicModel, setAnthropicModel] = useState('claude-3-5-sonnet-20241022');
  const [anthropicModelSaved, setAnthropicModelSaved] = useState(false);
  const [grokModel, setGrokModel] = useState('grok-3-mini');
  const [grokModelSaved, setGrokModelSaved] = useState(false);
  const [ocUser, setOcUser] = useState('');
  const [ocPass, setOcPass] = useState('');
  const [ocSavedUser, setOcSavedUser] = useState('');
  const [ocSavedPass, setOcSavedPass] = useState('');
  const [ocSaved, setOcSaved] = useState(false);
  const [ocError, setOcError] = useState('');
  const [ocLoading, setOcLoading] = useState(false);
  const [tabroomWarning, setTabroomWarning] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [settingsEvent, setSettingsEvent] = useState('hspolicy');
  const [eventSaved, setEventSaved] = useState(false);

  // Flow column colors (display prefs — plain localStorage, read live by FlowView)
  const [flowAffColor, setFlowAffColor] = useState(
    () => localStorage.getItem('warroom-flow-aff-color') || '#2563eb'
  );
  const [flowNegColor, setFlowNegColor] = useState(
    () => localStorage.getItem('warroom-flow-neg-color') || '#16a34a'
  );
  const setFlowColor = (side: 'aff' | 'neg', hex: string) => {
    if (side === 'aff') {
      localStorage.setItem('warroom-flow-aff-color', hex);
      setFlowAffColor(hex);
    } else {
      localStorage.setItem('warroom-flow-neg-color', hex);
      setFlowNegColor(hex);
    }
    window.dispatchEvent(new CustomEvent('warroom-flow-colors-changed'));
  };
  const resetFlowColors = () => {
    localStorage.setItem('warroom-flow-aff-color', '#2563eb');
    localStorage.setItem('warroom-flow-neg-color', '#16a34a');
    setFlowAffColor('#2563eb');
    setFlowNegColor('#16a34a');
    window.dispatchEvent(new CustomEvent('warroom-flow-colors-changed'));
  };

  // Flow editor preferences (display/behavior prefs — plain localStorage, read
  // live by FlowView/GeminiPanel; see lib/flowPrefs.ts)
  const [flowPrefs, setFlowPrefsState] = useState<FlowPrefs>(() => readFlowPrefs());
  const setFlowPref = <K extends keyof FlowPrefs>(key: K, value: FlowPrefs[K]) => {
    const next = { ...flowPrefs, [key]: value };
    setFlowPrefsState(next);
    writeFlowPrefs(next);
  };
  const resetFlowPrefs = () => {
    setFlowPrefsState({ ...FLOW_PREFS_DEFAULTS });
    writeFlowPrefs({ ...FLOW_PREFS_DEFAULTS });
  };
  // One button at the bottom of the unified Flow card resets both halves —
  // colors and prefs are still two separate stores under the hood (see the
  // comment on the card itself), but the user just sees "Flow settings".
  const resetAllFlowSettings = () => {
    resetFlowColors();
    resetFlowPrefs();
  };

  // Auto Flow tag style (display pref — plain localStorage, read live by AutoFlow's write step)
  const [autoFlowStyle, setAutoFlowStyleState] = useState<AutoFlowTagStyle>(() => readAutoFlowTagStyle());
  const setAutoFlowStyleProp = <K extends keyof AutoFlowTagStyle>(key: K, value: AutoFlowTagStyle[K]) => {
    const next = { ...autoFlowStyle, [key]: value };
    setAutoFlowStyleState(next);
    writeAutoFlowTagStyle(next);
  };
  const resetAutoFlowStyle = () => {
    setAutoFlowStyleState({ ...AUTOFLOW_STYLE_DEFAULTS });
    writeAutoFlowTagStyle({ ...AUTOFLOW_STYLE_DEFAULTS });
  };

  useEffect(() => {
    Promise.all([
      window.warroom?.secure.get('gemini'),
      window.warroom?.secure.get('oc_username'),
      window.warroom?.secure.get('oc_password'),
      window.warroom?.storage.read('app_settings'),
      window.warroom?.secure.get('openai_key'),
      window.warroom?.secure.get('anthropic_key'),
      window.warroom?.secure.get('grok_key'),
    ]).then(([k, u, p, s, oai, ant, grok]) => {
      if (u) { setOcUser(u); setOcSavedUser(u); }
      if (p) { setOcPass(p); setOcSavedPass(p); }
      if ((s as any)?.event) setSettingsEvent((s as any).event);
      if ((s as any)?.geminiModel) setGeminiModel((s as any).geminiModel);
      if ((s as any)?.openaiModel) setOpenaiModel((s as any).openaiModel);
      if ((s as any)?.anthropicModel) setAnthropicModel((s as any).anthropicModel);
      if ((s as any)?.grokModel) setGrokModel((s as any).grokModel);
      if ((s as any)?.tokenSavingDefault !== undefined) {
        setTokenSavingDefault((s as any).tokenSavingDefault);
      } else {
        setTokenSavingDefault((s as any)?.geminiModel === 'flash-lite');
      }
      const lmBaseUrlLoaded = (s as any)?.lmstudioBaseUrl || LMSTUDIO_DEFAULT_BASE_URL;
      const lmModelLoaded = (s as any)?.lmstudioModel || LMSTUDIO_DEFAULT_MODEL;
      const lmOptionsLoaded = typeof (s as any)?.lmstudioOptions === 'string' ? (s as any).lmstudioOptions : '';
      const lmToolsLoaded = (s as any)?.lmstudioTools !== false;
      const lmPerCallLoaded = (s as any)?.lmstudioPerCallModels && typeof (s as any).lmstudioPerCallModels === 'object'
        ? JSON.stringify((s as any).lmstudioPerCallModels, null, 2) : '';
      setLmBaseUrl(lmBaseUrlLoaded);
      setLmModel(lmModelLoaded);
      setLmOptions(lmOptionsLoaded);
      setLmTools(lmToolsLoaded);
      setLmPerCallModels(lmPerCallLoaded);
      setLmSnapshot({ baseUrl: lmBaseUrlLoaded, model: lmModelLoaded, options: lmOptionsLoaded, tools: lmToolsLoaded, perCallModels: lmPerCallLoaded });
      // No 'lmstudio' entry — it's a local server with no key to store.
      setNotifySettingsState({
        notifyPairings:  (s as any)?.notifyPairings  !== false,
        notifyResults:   (s as any)?.notifyResults   !== false,
        notifyTopics:    (s as any)?.notifyTopics    !== false,
        notifyJudges:    (s as any)?.notifyJudges    !== false,
        notifyOpponents: (s as any)?.notifyOpponents !== false,
      });
      setCiteYearFormatState((s as any)?.citeYearFormat === 'year' ? 'year' : 'month-day');
      setDictationUseOfflineState(!!(s as any)?.dictationUseOffline);
      const keys: Record<string, string> = { gemini: k ?? '', openai: oai ?? '', anthropic: ant ?? '', grok: grok ?? '' };
      setSavedKeys(keys);
      const provider: AIProvider = (s as any)?.apiProvider ?? 'gemini';
      setApiProvider(provider);
      setApiKey(keys[provider] ?? '');
      setLoaded(true);
    });
    (window.warroom as any)?.dictation?.offlineModelStatus?.().then((res: any) => {
      if (res?.ok) setOfflineModelReady(!!res.ready);
    }).catch(() => {});
  }, []);

  // Apply the debate event immediately on selection — updates the live store (so the
  // timer, flows, opponent stats, and forms follow it right away) and persists it,
  // merging into existing app_settings so other keys (apiProvider, models) are kept.
  async function applyEvent(value: string) {
    setSettingsEvent(value);
    setEvent(mapSettingsEvent(value));
    const s = (await window.warroom?.storage.read('app_settings')) as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, event: value });
    setEventSaved(true);
    setTimeout(() => setEventSaved(false), 2000);
  }

  function detectProvider(val: string): AIProvider | null {
    if (val.startsWith('AIza')) return 'gemini';
    if (val.startsWith('sk-ant-')) return 'anthropic';
    if (val.startsWith('sk-')) return 'openai';
    if (val.startsWith('xai-')) return 'grok';
    return null;
  }

  function handleApiKeyChange(val: string) {
    setApiKey(val);
    const detected = detectProvider(val);
    if (detected && detected !== apiProvider) {
      setApiProvider(detected);
      window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { apiProvider: detected } }));
    }
  }

  async function switchProvider(p: AIProvider) {
    setApiProvider(p);
    setApiKey(savedKeys[p] ?? '');
    setLmMsg(null);
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, apiProvider: p });
    window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { apiProvider: p } }));
  }

  // ── LM Studio actions ──────────────────────────────────────────────────────

  /**
   * The `window.warroom.lmstudio` bridge is installed by the preload script, which
   * Electron only loads at window creation — so an app instance started before this
   * provider existed has no bridge, and calling through it throws. Checked up front
   * so the user gets "restart Warroom" instead of a button that appears to do nothing.
   */
  function lmBridge() {
    const bridge = (window.warroom as any)?.lmstudio;
    if (!bridge?.test || !bridge?.listModels) return null;
    return bridge as NonNullable<typeof window.warroom>['lmstudio'];
  }
  const LM_NO_BRIDGE = 'Warroom needs a restart to load the LM Studio connection (it is set up when the app starts). Quit and reopen Warroom, then try again.';

  /** Persist the whole LM Studio block at once — URL, model, options, tool toggle,
   *  per-call overrides. A malformed per-call JSON block is dropped rather than
   *  failing the save (same tolerance as the options field — see resolveLmStudioConfig). */
  async function saveLmStudio(patch?: Partial<{ lmstudioModel: string }>) {
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    const resolvedModel = (patch?.lmstudioModel ?? lmModel).trim() || LMSTUDIO_DEFAULT_MODEL;
    let perCallModels: Record<string, string> | undefined;
    const rawPerCall = lmPerCallModels.trim();
    if (rawPerCall) {
      try {
        const parsed = JSON.parse(rawPerCall);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) perCallModels = parsed;
      } catch { /* ignored on purpose, same as lmstudioOptions */ }
    }
    const next = {
      ...s,
      apiProvider: 'lmstudio',
      lmstudioBaseUrl: lmBaseUrl.trim() || LMSTUDIO_DEFAULT_BASE_URL,
      lmstudioModel: resolvedModel,
      lmstudioOptions: lmOptions,
      lmstudioTools: lmTools,
      lmstudioPerCallModels: perCallModels ?? {},
    };
    await window.warroom?.storage.write('app_settings', next);
    if (patch?.lmstudioModel !== undefined) setLmModel(resolvedModel);
    setLmSnapshot({
      baseUrl: next.lmstudioBaseUrl, model: resolvedModel, options: lmOptions, tools: lmTools, perCallModels: lmPerCallModels,
    });
    setLmSaved(true);
    setTimeout(() => setLmSaved(false), 2000);
    window.dispatchEvent(new CustomEvent('warroom-settings-change', {
      detail: { apiKeySaved: true, lmstudioModel: next.lmstudioModel },
    }));
  }

  /** Pick a model from the fetched list (or a preset) — selects and saves in one go. */
  async function pickLmModel(id: string) {
    setLmModel(id);
    setLmMsg(null);
    try {
      await saveLmStudio({ lmstudioModel: id });
    } catch (e: any) {
      setLmMsg({ kind: 'err', text: `Couldn't save: ${e?.message ?? String(e)}` });
    }
  }

  async function fetchLmModels() {
    const bridge = lmBridge();
    if (!bridge) { setLmMsg({ kind: 'err', text: LM_NO_BRIDGE }); return; }
    setLmBusy('list');
    setLmMsg(null);
    try {
      const res = await bridge.listModels(lmBaseUrl.trim());
      if (!res?.ok) { setLmFound(null); setLmMsg({ kind: 'err', text: res?.error ?? 'Could not reach LM Studio.' }); return; }
      setLmFound(res.data.models);
      setLmMsg(res.data.models.length
        ? { kind: 'ok', text: `Found ${res.data.models.length} model${res.data.models.length === 1 ? '' : 's'} at ${res.data.baseUrl}.` }
        : { kind: 'err', text: `Connected to ${res.data.baseUrl}, but no models are loaded — load one in LM Studio first.` });
    } catch (e: any) {
      // Never fail silently: an unexpected throw here used to leave the button
      // looking like it did nothing at all.
      setLmFound(null);
      setLmMsg({ kind: 'err', text: e?.message ?? String(e) });
    } finally {
      setLmBusy(null);
    }
  }

  /** Saves first, so the round-trip tests exactly what the app will actually use. */
  async function testLmStudio() {
    const bridge = lmBridge();
    if (!bridge) { setLmMsg({ kind: 'err', text: LM_NO_BRIDGE }); return; }
    setLmBusy('test');
    setLmMsg(null);
    try {
      await saveLmStudio();
      const res = await bridge.test();
      if (!res?.ok) { setLmMsg({ kind: 'err', text: res?.error ?? 'Test failed.' }); return; }
      const { model, reply, ms } = res.data;
      setLmMsg({ kind: 'ok', text: `Working — ${model} replied "${reply}" in ${(ms / 1000).toFixed(1)}s.` });
    } catch (e: any) {
      setLmMsg({ kind: 'err', text: e?.message ?? String(e) });
    } finally {
      setLmBusy(null);
    }
  }

  async function saveApiKey() {
    const val = apiKey.trim();
    if (!val) return;
    if (apiProvider === 'lmstudio') return; // local server — no key to store
    const secureKey = apiProvider === 'gemini' ? 'gemini' : apiProvider === 'openai' ? 'openai_key' : apiProvider === 'grok' ? 'grok_key' : 'anthropic_key';
    await window.warroom.secure.set(secureKey, val);
    setSavedKeys((prev) => ({ ...prev, [apiProvider]: val }));
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, apiProvider });
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
    window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { apiKeySaved: true } }));
  }

  // Both of these MERGE into existing app_settings rather than replacing it. They
  // used to write a fresh `{ event, geminiModel, tokenSavingDefault }` object, which
  // silently wiped every other key in the file — apiProvider, the per-provider model
  // choices, and the whole LM Studio block — so toggling token saving reset the user
  // back to Gemini and threw away their local-model config.
  async function saveGeminiModel(model: string) {
    setGeminiModel(model);
    // Auto-enable token saving for flash-lite; when switching to other models, preserve current setting
    const newTokenSaving = model === 'flash-lite' ? true : tokenSavingDefault;
    setTokenSavingDefault(newTokenSaving);
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, geminiModel: model, tokenSavingDefault: newTokenSaving });
    window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { tokenSavingDefault: newTokenSaving, geminiModel: model } }));
    setGeminiModelSaved(true);
    setTimeout(() => setGeminiModelSaved(false), 2000);
  }

  async function saveTokenSavingDefault(val: boolean) {
    setTokenSavingDefault(val);
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, tokenSavingDefault: val });
    window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { tokenSavingDefault: val } }));
  }

  async function saveOpenaiModel(model: string) {
    setOpenaiModel(model);
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, openaiModel: model });
    window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { openaiModel: model } }));
    setOpenaiModelSaved(true);
    setTimeout(() => setOpenaiModelSaved(false), 2000);
  }

  async function saveAnthropicModel(model: string) {
    setAnthropicModel(model);
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, anthropicModel: model });
    window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { anthropicModel: model } }));
    setAnthropicModelSaved(true);
    setTimeout(() => setAnthropicModelSaved(false), 2000);
  }

  async function saveGrokModel(model: string) {
    setGrokModel(model);
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, grokModel: model });
    window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { grokModel: model } }));
    setGrokModelSaved(true);
    setTimeout(() => setGrokModelSaved(false), 2000);
  }

  async function saveOC() {
    if (!ocUser.trim() || !ocPass.trim()) return;
    setOcLoading(true); setOcError(''); setTabroomWarning('');
    try {
      if (!window.warroom) throw new Error('App bridge not ready — restart the app and try again');
      const u = ocUser.trim();
      const p = ocPass.trim();
      const tbLogin = window.warroom.tabroom?.testLogin;
      const [ocRes, tbRes] = await Promise.all([
        window.warroom.opencaselist.login(u, p).catch((e: any) => ({ ok: false, error: e?.message ?? 'Login failed' })),
        tbLogin
          ? tbLogin(u, p).catch((e: any) => ({ ok: false, error: e?.message ?? 'Login failed' }))
          : Promise.resolve({ ok: false, error: 'testLogin unavailable in this build — update the app' }),
      ]);
      const ocOk = ocRes && typeof ocRes === 'object' && (ocRes as any).ok;
      const tbOk = tbRes && typeof tbRes === 'object' && (tbRes as any).ok;
      if (!ocOk && !tbOk) {
        throw new Error(`Neither service accepted these credentials. OpenCaselist: ${(ocRes as any)?.error ?? 'failed'}. Tabroom: ${(tbRes as any)?.error ?? 'failed'}.`);
      }
      await window.warroom.secure.set('oc_username', u);
      await window.warroom.secure.set('oc_password', p);
      setOcSavedUser(u);
      setOcSavedPass(p);
      setOcSaved(true);
      setTimeout(() => setOcSaved(false), 2000);
      if (ocOk && !tbOk) {
        setTabroomWarning(`Saved — but Tabroom rejected these credentials (${(tbRes as any)?.error ?? 'login failed'}). Judge search and paradigm fetch will not work. Your Tabroom password may differ from your OpenCaselist password — update it on tabroom.com or enter your Tabroom password here instead.`);
      } else if (!ocOk && tbOk) {
        setTabroomWarning(`Saved — but OpenCaselist rejected these credentials (${(ocRes as any)?.error ?? 'login failed'}). Disclosure search and Open Ev will not work.`);
      }
    } catch (e: any) {
      setOcError(e?.message ?? 'Login failed — check credentials');
    } finally {
      setOcLoading(false);
    }
  }

  // Warn before leaving Settings with an unsaved LM Studio edit or a typed-but-
  // not-yet-saved API key. Most fields on this page auto-save the instant you
  // click/toggle them (theme, event, notifications, model picks…) — these two
  // are the only real "draft" inputs, since they need an explicit Save click.
  const unsavedRef = React.useRef(false);
  unsavedRef.current = lmDirty || apiKeyDirty;
  const settingsViewRef = React.useRef(view);
  settingsViewRef.current = view;
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsavedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (unsavedRef.current) {
        const leave = window.confirm('You have unsaved changes in Settings (LM Studio or API key). Leave without saving?');
        if (!leave) setTimeout(() => setView(settingsViewRef.current), 0);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="label mb-1">Settings</div>
      <h1 className="text-lg font-semibold mb-6 text-ink">App settings</h1>

      <div className="flex items-start gap-8">
        <SettingsOutline />
        <div className="flex-1 min-w-0 max-w-2xl">

      {/* Appearance */}
      <div id="settings-appearance" className="glass-card rounded-sm p-4 space-y-4 mb-4">
        <div>
          <div className="label mb-1">Theme</div>
          <p className="text-xs mb-3 text-ink/50">
            Sets the overall look — colors, typography, and shape.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((o) => {
              const active = direction === o.value;
              const p = isDark ? o.dark : o.light;
              return (
                <button
                  key={o.value}
                  onClick={() => setDirection(o.value)}
                  className="text-left rounded-xl p-3 transition border"
                  style={{
                    background: p.bg,
                    borderColor: active ? p.accent : 'var(--border-med)',
                    boxShadow: active ? `0 0 0 2px ${p.accent}` : 'none',
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <span className="w-3 h-3 rounded-full" style={{ background: p.accent }} />
                    <span className="w-3 h-3 rounded-full" style={{ background: p.card, border: `1px solid ${p.line}` }} />
                  </div>
                  <div className="text-xs font-semibold" style={{ color: p.ink }}>{o.label}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: p.ink, opacity: 0.55 }}>{o.blurb}</div>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="label mb-2">Mode</div>
          <div className="inline-flex rounded-lg p-0.5" style={{ background: 'var(--mode-toggle-bg)' }}>
            {MODE_OPTIONS.map((m) => (
              <button
                key={m.value}
                onClick={() => setTheme(m.value)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold transition"
                style={{
                  background: theme === m.value ? 'var(--bg-card)' : 'transparent',
                  color: theme === m.value ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
                  boxShadow: theme === m.value ? 'var(--nav-active-shadow)' : 'none',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {(direction !== 'calm' || theme !== 'system') && (
          <button
            type="button"
            title="Reset theme and mode to default"
            onClick={() => { setDirection('calm'); setTheme('system'); }}
            className="text-xs text-ink/50 hover:text-ink/80 underline underline-offset-2"
          >
            Reset to defaults
          </button>
        )}
      </div>

      {/* Speech docs & cases */}
      <div id="settings-speechdocs" className="glass-card rounded-sm p-4 space-y-4 mb-4">
        <div>
          <div className="label mb-1">Speech docs & cases</div>
          <p className="text-xs mb-1 text-ink/50">
            How the speech doc viewer reads and behaves when you open a case.
          </p>
        </div>

        {isDark && (
          <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Keep speech docs light</div>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>
                Reads the doc itself on a light page, like paper, while the rest of Warroom stays in dark mode.
              </p>
            </div>
            <button
              onClick={() => setDocLightInDark(!docLightInDark)}
              className="ml-4 shrink-0 w-9 h-5 rounded-full relative transition-colors duration-200"
              style={{ background: docLightInDark ? '#4285F4' : 'var(--border-med)', border: 'none', cursor: 'pointer' }}
            >
              <span
                className="absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: docLightInDark ? 'translateX(18px)' : 'translateX(2px)' }}
              />
            </button>
          </div>
        )}

        <div className="pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Speech doc margins</div>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>
                How much of the doc's original left/right page margins to keep. Lower gives the text more width.
              </p>
            </div>
            <span className="ml-4 shrink-0 text-xs tabular-nums font-medium" style={{ color: 'var(--nav-inactive-color)' }}>
              {docMarginPct}%
            </span>
          </div>
          <input
            type="range" min={0} max={100} step={5} value={docMarginPct}
            onChange={(e) => setDocMarginPct(parseInt(e.target.value, 10))}
            className="w-full" style={{ accentColor: '#4285F4' }}
          />
        </div>

        <div className="pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Speech doc text size</div>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>
                Scales the whole doc page — text, cards, everything — for easier reading.
              </p>
            </div>
            <span className="ml-4 shrink-0 text-xs tabular-nums font-medium" style={{ color: 'var(--nav-inactive-color)' }}>
              {docZoomPct}%
            </span>
          </div>
          <input
            type="range" min={80} max={150} step={10} value={docZoomPct}
            onChange={(e) => setDocZoomPct(parseInt(e.target.value, 10))}
            className="w-full" style={{ accentColor: '#4285F4' }}
          />
        </div>

        <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Always open the outline</div>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>
              On shows the outline drawer every time you open a doc. Off, it never opens on its own.
            </p>
          </div>
          <button
            onClick={() => setDocAutoOutline(!docAutoOutline)}
            className="ml-4 shrink-0 w-9 h-5 rounded-full relative transition-colors duration-200"
            style={{ background: docAutoOutline ? '#4285F4' : 'var(--border-med)', border: 'none', cursor: 'pointer' }}
          >
            <span
              className="absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
              style={{ transform: docAutoOutline ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </button>
        </div>

        <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Start docs in Focus mode</div>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>
              Hide body text and show only card structure as soon as a doc opens.
            </p>
          </div>
          <button
            onClick={() => setDocStartFocus(!docStartFocus)}
            className="ml-4 shrink-0 w-9 h-5 rounded-full relative transition-colors duration-200"
            style={{ background: docStartFocus ? '#4285F4' : 'var(--border-med)', border: 'none', cursor: 'pointer' }}
          >
            <span
              className="absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
              style={{ transform: docStartFocus ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </button>
        </div>

        <div className="pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div className="mb-1.5">
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Outline layout in compare view</div>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>
              How opening an outline affects the other panes when 2-3 docs are open side by side.
            </p>
          </div>
          <div className="flex rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            {([
              { value: 'space' as const, label: 'Dedicated space', hint: 'New fixed-width column; other panes shrink and the row can scroll.' },
              { value: 'squish' as const, label: 'Squish neighbor', hint: 'Borrows width from one neighboring pane; everything stays on screen.' },
            ]).map((o) => (
              <button
                key={o.value}
                onClick={() => setDocOutlineLayout(o.value)}
                title={o.hint}
                className="flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition"
                style={{
                  background: docOutlineLayout === o.value ? 'var(--bg-card)' : 'transparent',
                  color: docOutlineLayout === o.value ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
                  boxShadow: docOutlineLayout === o.value ? 'var(--nav-active-shadow)' : 'none',
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {!speechDocSettingsAreDefault && (
          <button
            type="button"
            title="Reset speech doc settings to default"
            onClick={resetSpeechDocSettings}
            className="text-xs text-ink/50 hover:text-ink/80 underline underline-offset-2"
          >
            Reset to defaults
          </button>
        )}
      </div>

      {/* General */}
      <div id="settings-general" className="glass-card rounded-sm p-4 space-y-4 mb-4">
        <div className="label mb-1">General</div>

        <div className="flex items-center justify-between">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Card staleness (years)</div>
            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
              Cards older than this are flagged "outdated" in Library, blocks, Mission Brief, and when you cut a new one.
            </p>
          </div>
          <input
            type="number"
            min={1}
            max={50}
            className="input w-16 text-center ml-4 shrink-0"
            value={cardOutdatedYears}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setCardOutdatedYears(n);
            }}
          />
        </div>

        <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Current-year short cite</div>
            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
              How the AI card cutter writes the short cite for a source published this year — e.g.
              "Guitierrez 7-31" vs "Guitierrez 26". Past-year sources always use the two-digit year either way.
            </p>
          </div>
          <div className="flex rounded-lg p-0.5 ml-4 shrink-0" style={{ background: 'var(--mode-toggle-bg)' }}>
            {([
              { value: 'month-day', label: 'Month-day' },
              { value: 'year',      label: 'Year' },
            ] as const).map((o) => (
              <button
                key={o.value}
                onClick={() => setCiteYearFormat(o.value)}
                className="px-3 py-1 text-xs rounded-md transition-all"
                style={citeYearFormat === o.value
                  ? { background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', fontWeight: 600 }
                  : { background: 'transparent', color: 'var(--nav-inactive-color)' }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Timer warning threshold</div>
            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
              Seconds remaining when the top-bar speech timer turns amber. It always turns red at 0:00.
            </p>
          </div>
          <div className="flex items-center gap-1.5 ml-4 shrink-0">
            <input
              type="number"
              min={1}
              max={999}
              className="input w-16 text-center"
              value={timerWarningSecs}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setTimerWarningSecs(n);
              }}
            />
            <span className="text-xs text-ink/40">sec</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Reduce motion</div>
            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
              Turn off transitions and animations across the app.
            </p>
          </div>
          <button
            onClick={() => setReduceMotion(!reduceMotion)}
            className="ml-4 shrink-0 w-9 h-5 rounded-full relative transition-colors duration-200"
            style={{ background: reduceMotion ? '#4285F4' : 'var(--border-med)', border: 'none', cursor: 'pointer' }}
          >
            <span
              className="absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
              style={{ transform: reduceMotion ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </button>
        </div>

        <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Skip delete confirmations</div>
            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
              Delete cases, blocks, tournaments, rounds, and impact library entries immediately, without
              an "are you sure?" prompt. The Undo toast still shows either way, so you can always get it back.
            </p>
          </div>
          <button
            onClick={() => setSkipDeleteConfirm(!skipDeleteConfirm)}
            className="ml-4 shrink-0 w-9 h-5 rounded-full relative transition-colors duration-200"
            style={{ background: skipDeleteConfirm ? '#4285F4' : 'var(--border-med)', border: 'none', cursor: 'pointer' }}
          >
            <span
              className="absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
              style={{ transform: skipDeleteConfirm ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </button>
        </div>

        <div className="pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div className="text-sm font-medium mb-0.5" style={{ color: 'var(--ink)' }}>Background notifications</div>
          <p className="text-[11px] mb-2 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
            Desktop notifications that can fire even when Warroom is closed, via the background watcher (see
            Documentation → Background notifications). Turn off anything you don't want to be pinged about.
          </p>
          <div className="space-y-2.5">
            {NOTIFY_OPTIONS.map((o) => (
              <div key={o.key} className="flex items-center justify-between">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="text-xs font-medium" style={{ color: 'var(--ink)' }}>{o.label}</div>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>{o.blurb}</p>
                </div>
                <button
                  onClick={() => setNotifySetting(o.key, !notifySettings[o.key])}
                  className="ml-4 shrink-0 w-9 h-5 rounded-full relative transition-colors duration-200"
                  style={{ background: notifySettings[o.key] ? '#4285F4' : 'var(--border-med)', border: 'none', cursor: 'pointer' }}
                >
                  <span
                    className="absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                    style={{ transform: notifySettings[o.key] ? 'translateX(18px)' : 'translateX(2px)' }}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-3" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div className="flex items-center justify-between">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                Offline dictation model
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--border-med)', color: 'var(--label-color)' }}>Beta</span>
              </div>
              <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
                Transcribes dictation with a small local Whisper model — no API key, no internet, works with
                any AI provider (or none). Downloads once (~75MB) and runs on your device from then on. Once
                downloaded, it's also used automatically as a silent fallback if Gemini/OpenAI dictation ever
                fails — even while the toggle below is off. Beta: slower and less accurate than Gemini/OpenAI,
                and speech recognition quality can vary by device.
              </p>
            </div>
            {offlineModelReady && (
              <button
                onClick={() => setDictationUseOffline(!dictationUseOffline)}
                className="ml-4 shrink-0 w-9 h-5 rounded-full relative transition-colors duration-200"
                style={{ background: dictationUseOffline ? '#4285F4' : 'var(--border-med)', border: 'none', cursor: 'pointer' }}
              >
                <span
                  className="absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                  style={{ transform: dictationUseOffline ? 'translateX(18px)' : 'translateX(2px)' }}
                />
              </button>
            )}
          </div>
          {!offlineModelReady && (
            <>
              <button
                className="btn text-xs mt-2"
                onClick={downloadOfflineModel}
                disabled={offlineDownloading}
              >
                {offlineDownloading
                  ? `Downloading ${offlineDownloadLabel || 'model'}… ${offlineDownloadPct !== null ? `${offlineDownloadPct}%` : ''}`
                  : 'Download offline model'}
              </button>
              {offlineDownloading && (
                <div className="w-full rounded-full overflow-hidden mt-1.5" style={{ height: 4, background: 'var(--border-subtle)', maxWidth: 220 }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${offlineDownloadPct ?? 0}%`,
                      background: '#4285F4',
                      // Indeterminate shimmer until the first file reports a real
                      // total, so the bar reads as "working" rather than stuck at 0.
                      ...(offlineDownloadPct === null ? { width: '30%', animation: 'wr-indeterminate 1.2s ease-in-out infinite' } : {}),
                    }}
                  />
                </div>
              )}
            </>
          )}
          {offlineModelReady && (
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--nav-inactive-color)' }}>
              Model downloaded and ready. {dictationUseOffline ? 'Dictation is using it now.' : 'Turn on the toggle above to use it.'}
            </p>
          )}
          {offlineDownloadError && (
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--danger, #e5484d)' }}>{offlineDownloadError}</p>
          )}
        </div>

        {!generalSettingsAreDefault && (
          <button
            type="button"
            title="Reset General settings to default"
            onClick={resetGeneralSettings}
            className="text-xs text-ink/50 hover:text-ink/80 underline underline-offset-2"
          >
            Reset to defaults
          </button>
        )}
      </div>

      {/* Event */}
      <div id="settings-event" className="glass-card rounded-sm p-4 space-y-3 mb-4">
        <div>
          <div className="label mb-1">Debate event</div>
          <p className="text-xs mb-3 text-ink/50">
            Sets the default event for flows, opponent stats, and tournament forms.
          </p>
          {loaded && (
            <div className="space-y-1.5">
              {EVENT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition border"
                  style={{
                    background: settingsEvent === o.value ? 'var(--item-selected-bg)' : 'var(--bg-input)',
                    color: settingsEvent === o.value ? 'var(--item-selected-text)' : 'rgb(var(--ink-rgb))',
                    borderColor: settingsEvent === o.value ? 'transparent' : 'var(--border-med)',
                  }}
                  onClick={() => applyEvent(o.value)}
                >
                  {o.label}
                </button>
              ))}
              <div className="pt-1 h-4">
                {eventSaved && (
                  <span className="text-xs" style={{ color: 'var(--nav-active-color)' }}>Saved ✓</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* API key */}
      <div id="settings-apikey" className="glass-card rounded-sm p-4 space-y-3 mb-4">
        <div className="label mb-1">AI API key</div>

        {/* Provider toggle — auto-switches on key entry, also manually selectable */}
        <div className="flex rounded-lg p-0.5 w-fit" style={{ background: 'var(--mode-toggle-bg)' }}>
          {([
            { value: 'gemini',    label: 'Gemini' },
            { value: 'openai',    label: 'OpenAI' },
            { value: 'anthropic', label: 'Anthropic' },
            { value: 'grok',      label: 'Grok' },
            { value: 'lmstudio',  label: 'LM Studio' },
          ] as const).map((p) => (
            <button
              key={p.value}
              onClick={() => switchProvider(p.value)}
              className="px-3 py-1 text-xs rounded-md transition-all"
              style={apiProvider === p.value
                ? { background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', fontWeight: 600 }
                : { background: 'transparent', color: 'var(--nav-inactive-color)' }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Single unified input — hidden for LM Studio, which is a local server with no key */}
        {loaded && apiProvider !== 'lmstudio' && (
          <div>
            <p className="text-xs mb-2 text-ink/50">
              {apiProvider === 'gemini' && 'Powers card extraction and block suggestions. Stored encrypted on device.'}
              {apiProvider === 'openai' && 'OpenAI API key. Stored encrypted on device.'}
              {apiProvider === 'anthropic' && 'Anthropic API key. Stored encrypted on device.'}
              {apiProvider === 'grok' && 'xAI Grok API key (starts with xai-). Stored encrypted on device.'}
            </p>
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono text-xs"
                type="password"
                placeholder={
                  apiProvider === 'gemini' ? 'AIza…' :
                  apiProvider === 'openai' ? 'sk-…' :
                  apiProvider === 'grok' ? 'xai-…' : 'sk-ant-…'
                }
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveApiKey()}
              />
              <button className="btn-primary" onClick={saveApiKey}>
                {apiKeySaved ? 'Saved ✓' : apiKey === savedKeys[apiProvider] && savedKeys[apiProvider] ? 'Edit' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* LM Studio — local server: base URL, model, load/inference options */}
        {apiProvider === 'lmstudio' && loaded && (
          <div className="space-y-4">
            <p className="text-xs text-ink/50 leading-relaxed">
              Runs models on <strong style={{ color: 'var(--ink)' }}>your own machine</strong> through
              LM Studio's local server — no API key, no per-token cost, works offline. In LM Studio:
              load a model, then open the <strong style={{ color: 'var(--ink)' }}>Developer</strong> tab
              and click <strong style={{ color: 'var(--ink)' }}>Start Server</strong>.
            </p>

            {/* Base URL */}
            <div>
              <div className="label mb-1">Server URL</div>
              <p className="text-xs mb-2 text-ink/50">
                LM Studio's default is <code>http://localhost:1234</code>. Works with or without the
                trailing <code>/v1</code>.
              </p>
              <input
                className="input w-full font-mono text-xs"
                placeholder={LMSTUDIO_DEFAULT_BASE_URL}
                value={lmBaseUrl}
                onChange={(e) => setLmBaseUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveLmStudio()}
              />
            </div>

            {/* Model presets */}
            <div>
              <div className="label mb-1">Model</div>
              <p className="text-xs mb-2 text-ink/50">
                Gemma 4 12B is the default. Presets are shortcuts — the exact id depends on how you
                downloaded the model, so use <strong style={{ color: 'var(--ink)' }}>Loaded models</strong> below
                if a preset doesn't match.
              </p>
              {lmPerCallActive && (
                <p className="text-[11px] mb-2 px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--bg-input)', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-side)' }}>
                  Nothing shown as selected below — you've set per-call model overrides under{' '}
                  <strong style={{ color: 'var(--ink)' }}>Advanced</strong>, so this picker is just the fallback default now.
                </p>
              )}
              <div className="space-y-1.5">
                {LMSTUDIO_MODEL_OPTIONS.map((o) => (
                  <div key={o.value} className="relative group">
                    <button
                      className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition border"
                      style={{
                        background: !lmPerCallActive && lmModel === o.value ? 'var(--item-selected-bg)' : 'var(--bg-input)',
                        color: !lmPerCallActive && lmModel === o.value ? 'var(--item-selected-text)' : 'rgb(var(--ink-rgb))',
                        borderColor: !lmPerCallActive && lmModel === o.value ? 'transparent' : 'var(--border-med)',
                      }}
                      onClick={() => pickLmModel(o.value)}
                    >
                      <span>{o.label}</span>
                      {o.default && <span className="text-[10px] ml-2 opacity-60">default</span>}
                      <span className="block text-[11px] font-mono opacity-50 mt-0.5">{o.value}</span>
                    </button>
                    <div
                      className="absolute left-0 right-0 top-full mt-1 z-20 px-3 py-2 rounded-lg text-[11px] leading-relaxed opacity-0 group-hover:opacity-100 pointer-events-none transition"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-med)', color: 'var(--nav-inactive-color)' }}
                    >
                      {o.tooltip}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom model id */}
            <div>
              <div className="label mb-1">Or enter any model id</div>
              <p className="text-xs mb-2 text-ink/50">
                Anything LM Studio has loaded — not limited to the presets above.
              </p>
              <div className="flex gap-2">
                <input
                  className="input flex-1 font-mono text-xs"
                  placeholder={LMSTUDIO_DEFAULT_MODEL}
                  value={lmModel}
                  onChange={(e) => setLmModel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveLmStudio()}
                />
                <button
                  className="btn text-xs"
                  onClick={() => {
                    if (lmLoadedOpen) { setLmLoadedOpen(false); return; }
                    setLmLoadedOpen(true);
                    if (!lmFound) fetchLmModels();
                  }}
                  disabled={lmBusy !== null}
                >
                  {lmBusy === 'list' ? 'Checking…' : lmLoadedOpen ? 'Hide loaded models' : 'Loaded models'}
                </button>
              </div>
            </div>

            {/* Models actually available on the running server — collapses back
                into the button above instead of staying pinned open once fetched. */}
            {lmLoadedOpen && lmFound && lmFound.length > 0 && (
              <div>
                <div className="label mb-1">Loaded models</div>
                <p className="text-xs mb-2 text-ink/50">Reported by your server — click one to use it.</p>
                <div className="space-y-1">
                  {lmFound.map((id) => (
                    <button
                      key={id}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition border"
                      style={{
                        background: !lmPerCallActive && lmModel === id ? 'var(--item-selected-bg)' : 'var(--bg-input)',
                        color: !lmPerCallActive && lmModel === id ? 'var(--item-selected-text)' : 'rgb(var(--ink-rgb))',
                        borderColor: !lmPerCallActive && lmModel === id ? 'transparent' : 'var(--border-med)',
                      }}
                      onClick={() => pickLmModel(id)}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Advanced — closed by default so the common path (pick a preset,
                Save) isn't buried under rarely-touched knobs. */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
              <button
                onClick={() => setLmAdvancedOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium transition"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink)', opacity: 0.75 }}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: lmAdvancedOpen ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' }}>
                  <polyline points="4 2 8 6 4 10" />
                </svg>
                Advanced
              </button>

              {lmAdvancedOpen && (
                <div className="space-y-4 mt-3">
                  {/* Request options */}
                  <div>
                    <div className="label mb-1">Model options <span className="opacity-50 font-normal">(optional)</span></div>
                    <p className="text-xs mb-2 text-ink/50 leading-relaxed">
                      JSON merged into every request, overriding Warroom's defaults — <code>temperature</code>,{' '}
                      <code>max_tokens</code>, <code>top_p</code>, <code>top_k</code>,{' '}
                      <code>repeat_penalty</code>, <code>seed</code>, and <code>ttl</code> (seconds before
                      LM Studio auto-unloads the model). Context length and GPU offload are set in LM Studio
                      itself when you load the model — they aren't settable over its API.
                    </p>
                    <textarea
                      className="input w-full font-mono text-xs"
                      rows={5}
                      spellCheck={false}
                      placeholder={LMSTUDIO_OPTIONS_EXAMPLE}
                      value={lmOptions}
                      onFocus={() => { if (!lmOptions.trim()) setLmOptions(LMSTUDIO_OPTIONS_EXAMPLE); }}
                      onChange={(e) => setLmOptions(e.target.value)}
                    />
                    {lmOptionsError && (
                      <p className="text-[11px] mt-1" style={{ color: 'var(--danger, #e5484d)' }}>{lmOptionsError}</p>
                    )}
                  </div>

                  {/* Tool-calling toggle */}
                  <div>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={lmTools}
                        onChange={(e) => setLmTools(e.target.checked)}
                      />
                      <span className="text-xs text-ink/70 leading-relaxed">
                        Let the model call Warroom's tools (search cards, read flows, save tournaments…).
                        Gemma 4 supports this natively, and for models that don't, LM Studio falls back to
                        a prompt-based format rather than failing — so leave this on unless a model is
                        clearly struggling with it.
                      </span>
                    </label>
                  </div>

                  {/* Per-call model override */}
                  <div>
                    <div className="label mb-1">Model per AI call <span className="opacity-50 font-normal">(optional)</span></div>
                    <p className="text-xs mb-2 text-ink/50 leading-relaxed">
                      Every AI call in Warroom runs as one of three tiers:
                    </p>
                    <ul className="text-xs mb-2 text-ink/50 leading-relaxed space-y-1 pl-4" style={{ listStyle: 'disc' }}>
                      <li><code>lite</code> — cheap, low-stakes jobs: naming a chat, grading a single cross-ex answer, summarizing a flow sheet.</li>
                      <li><code>balanced</code> — most everyday use: the Warroom AI chat itself, card extraction, Auto Flow, Round Analysis, cross-ex question/trap generation, card credibility scoring.</li>
                      <li><code>best</code> — deep analysis: Impact Calc (Outweigh game, compare docs), Impact Library drafting/review, card-cutting's AI pass, importing a flow via AI.</li>
                    </ul>
                    <p className="text-xs mb-2 text-ink/50 leading-relaxed">
                      Set a different loaded model id per tier below. You don't have to fill in all three —
                      a missing tier borrows the next one down (<code>best</code> → <code>balanced</code> →{' '}
                      <code>lite</code>), except <code>lite</code> itself, which has nothing below it and
                      borrows <code>balanced</code> instead. Any tier that's still empty after that uses the{' '}
                      <strong style={{ color: 'var(--ink)' }}>Model</strong> picked above. When any tier is
                      set here, the presets and Loaded models list above stop showing a selection — you're
                      choosing models in this box now, not up there.
                    </p>
                    <textarea
                      className="input w-full font-mono text-xs"
                      rows={4}
                      spellCheck={false}
                      placeholder={LMSTUDIO_PERCALL_EXAMPLE}
                      value={lmPerCallModels}
                      onFocus={() => { if (!lmPerCallModels.trim()) setLmPerCallModels(LMSTUDIO_PERCALL_EXAMPLE); }}
                      onChange={(e) => setLmPerCallModels(e.target.value)}
                    />
                    {lmPerCallModelsError && (
                      <p className="text-[11px] mt-1" style={{ color: 'var(--danger, #e5484d)' }}>{lmPerCallModelsError}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Save + end-to-end test. Save only reads as actionable ("Save",
                accent) while something differs from what's persisted — once it
                matches, it settles into the same neutral styling as Test
                connection and just says "Saved", not a transient checkmark. */}
            <div className="flex items-center gap-2">
              <button
                className={lmDirty ? 'btn-primary' : 'btn text-xs'}
                onClick={() => saveLmStudio()}
                disabled={!lmDirty}
              >
                {lmDirty ? 'Save' : 'Saved'}
              </button>
              <button className="btn text-xs" onClick={testLmStudio} disabled={lmBusy !== null}>
                {lmBusy === 'test' ? 'Testing…' : 'Test connection'}
              </button>
            </div>

            {lmMsg && (
              <p className="text-[11px] px-3 py-2 rounded-lg leading-relaxed"
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-side)',
                  color: lmMsg.kind === 'ok' ? 'var(--ink)' : 'var(--danger, #e5484d)',
                }}>
                {lmMsg.text}
              </p>
            )}
          </div>
        )}

        {/* OpenAI model selector */}
        {apiProvider === 'openai' && loaded && (
          <div>
            <div className="label mb-1">OpenAI model</div>
            <p className="text-xs mb-2 text-ink/50">
              Used for scouting reports and analysis. Hover each option for details.
            </p>
            <div className="space-y-1.5">
              {OPENAI_MODEL_OPTIONS.map((o) => (
                <div key={o.value} className="relative group">
                  <button
                    className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition border"
                    style={{
                      background: openaiModel === o.value ? 'var(--item-selected-bg)' : 'var(--bg-input)',
                      color: openaiModel === o.value ? 'var(--item-selected-text)' : 'rgb(var(--ink-rgb))',
                      borderColor: openaiModel === o.value ? 'transparent' : 'var(--border-med)',
                    }}
                    onClick={() => saveOpenaiModel(o.value)}
                  >
                    <span>{o.label}</span>
                    {o.default && (
                      <span className="ml-2 text-[10px] opacity-50 font-normal">(default)</span>
                    )}
                  </button>
                  <div
                    className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
                      opacity-0 group-hover:opacity-100 transition-opacity duration-150
                      w-56 rounded-sm px-3 py-2 text-xs leading-relaxed"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                      color: 'rgb(var(--ink-rgb))',
                    }}
                  >
                    {o.tooltip}
                  </div>
                </div>
              ))}
              {openaiModelSaved && (
                <p className="text-xs text-emerald-500 pt-0.5">Model saved ✓</p>
              )}
              <ModelExceptionNote provider="openai" tier={getModelTier('openai', openaiModel)} />
            </div>
          </div>
        )}

        {/* Anthropic model selector */}
        {apiProvider === 'anthropic' && loaded && (
          <div>
            <div className="label mb-1">Anthropic model</div>
            <p className="text-xs mb-2 text-ink/50">
              Used for scouting reports and analysis. Hover each option for details.
            </p>
            <div className="space-y-1.5">
              {ANTHROPIC_MODEL_OPTIONS.map((o) => (
                <div key={o.value} className="relative group">
                  <button
                    className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition border"
                    style={{
                      background: anthropicModel === o.value ? 'var(--item-selected-bg)' : 'var(--bg-input)',
                      color: anthropicModel === o.value ? 'var(--item-selected-text)' : 'rgb(var(--ink-rgb))',
                      borderColor: anthropicModel === o.value ? 'transparent' : 'var(--border-med)',
                    }}
                    onClick={() => saveAnthropicModel(o.value)}
                  >
                    <span>{o.label}</span>
                    {o.default && (
                      <span className="ml-2 text-[10px] opacity-50 font-normal">(default)</span>
                    )}
                  </button>
                  <div
                    className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
                      opacity-0 group-hover:opacity-100 transition-opacity duration-150
                      w-56 rounded-sm px-3 py-2 text-xs leading-relaxed"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                      color: 'rgb(var(--ink-rgb))',
                    }}
                  >
                    {o.tooltip}
                  </div>
                </div>
              ))}
              {anthropicModelSaved && (
                <p className="text-xs text-emerald-500 pt-0.5">Model saved ✓</p>
              )}
              <ModelExceptionNote provider="anthropic" tier={getModelTier('anthropic', anthropicModel)} />
            </div>
          </div>
        )}

        {/* Grok model selector */}
        {apiProvider === 'grok' && loaded && (
          <div>
            <div className="label mb-1">Grok model</div>
            <p className="text-xs mb-2 text-ink/50">
              Used for scouting reports and analysis. Hover each option for details.
            </p>
            <div className="space-y-1.5">
              {[
                { value: 'grok-3-mini', label: 'Grok 3 mini', tooltip: 'Fast and cost-efficient. Good for quick analysis.', default: true },
                { value: 'grok-3',      label: 'Grok 3',      tooltip: 'Full flagship model. Best quality for complex reasoning.' },
                { value: 'grok-3-fast', label: 'Grok 3 fast', tooltip: 'Fast version of Grok 3 with slightly reduced quality.' },
              ].map((o) => (
                <div key={o.value} className="relative group">
                  <button
                    className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition border"
                    style={{
                      background: grokModel === o.value ? 'var(--item-selected-bg)' : 'var(--bg-input)',
                      color: grokModel === o.value ? 'var(--item-selected-text)' : 'rgb(var(--ink-rgb))',
                      borderColor: grokModel === o.value ? 'transparent' : 'var(--border-med)',
                    }}
                    onClick={() => saveGrokModel(o.value)}
                  >
                    <span>{o.label}</span>
                    {o.default && (
                      <span className="ml-2 text-[10px] opacity-50 font-normal">(default)</span>
                    )}
                  </button>
                  <div
                    className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
                      opacity-0 group-hover:opacity-100 transition-opacity duration-150
                      w-56 rounded-sm px-3 py-2 text-xs leading-relaxed"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                      color: 'rgb(var(--ink-rgb))',
                    }}
                  >
                    {o.tooltip}
                  </div>
                </div>
              ))}
              {grokModelSaved && (
                <p className="text-xs text-emerald-500 pt-0.5">Model saved ✓</p>
              )}
              <ModelExceptionNote provider="grok" tier={getModelTier('grok', grokModel)} />
            </div>
          </div>
        )}

        {/* Gemini-specific: model + token saving */}
        {apiProvider === 'gemini' && loaded && (
          <div>
            <div className="label mb-1">Gemini model</div>
            <p className="text-xs mb-2 text-ink/50">
              Used for scouting reports and card extraction. Hover each option for details.
            </p>
            <div className="space-y-1.5">
              {GEMINI_MODEL_OPTIONS.map((o) => (
                <div key={o.value} className="relative group">
                  <button
                    className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition border"
                    style={{
                      background: geminiModel === o.value ? 'var(--item-selected-bg)' : 'var(--bg-input)',
                      color: geminiModel === o.value ? 'var(--item-selected-text)' : 'rgb(var(--ink-rgb))',
                      borderColor: geminiModel === o.value ? 'transparent' : 'var(--border-med)',
                    }}
                    onClick={() => saveGeminiModel(o.value)}
                  >
                    <span>{o.label}</span>
                    {o.value === 'flash' && (
                      <span className="ml-2 text-[10px] opacity-50 font-normal">(default)</span>
                    )}
                  </button>
                  <div
                    className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
                      opacity-0 group-hover:opacity-100 transition-opacity duration-150
                      w-56 rounded-sm px-3 py-2 text-xs leading-relaxed"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                      color: 'rgb(var(--ink-rgb))',
                    }}
                  >
                    {o.tooltip}
                  </div>
                </div>
              ))}
              {geminiModelSaved && (
                <p className="text-xs text-emerald-500 pt-0.5">Model saved ✓</p>
              )}
              <ModelExceptionNote provider="gemini" tier={getModelTier('gemini', geminiModel)} />
            </div>
          </div>
        )}
      </div>

      {/* Token saving — provider-independent, so it lives outside every provider
          block. It's about what Warroom SENDS (speech-doc body text), not about
          which model receives it, and it was previously nested inside the Gemini
          block where nobody on another provider could reach it. */}
      {loaded && (
        <div className="glass-card rounded-sm p-4 mb-4">
          <div className="flex items-center justify-between">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Token saving by default</div>
              <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
                When attaching a speech doc to Warroom AI, send only underlined text, cites, and
                headings — not small body text. Applies to every provider.
                {apiProvider === 'gemini' && ' Auto-enabled for Flash Lite.'}
                {apiProvider === 'lmstudio' && ' Worth leaving on for local models, which are slower and usually have a smaller context window.'}
              </p>
            </div>
            <button
              onClick={() => saveTokenSavingDefault(!tokenSavingDefault)}
              className="ml-4 shrink-0 w-9 h-5 rounded-full relative transition-colors duration-200"
              style={{ background: tokenSavingDefault ? '#4285F4' : 'var(--border-med)', border: 'none', cursor: 'pointer' }}
            >
              <span
                className="absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: tokenSavingDefault ? 'translateX(18px)' : 'translateX(2px)' }}
              />
            </button>
          </div>
        </div>
      )}

      {/* OpenCaselist */}
      <div id="settings-opencaselist" className="glass-card rounded-sm p-4 space-y-3 mb-4">
        <div>
          <div className="label mb-1">OpenCaselist / Tabroom login</div>
          <p className="text-xs mb-2 text-ink/50">
            Required for opponent disclosure search, Open Ev, and judge paradigm lookups. OpenCaselist and Tabroom usually share one username and password, but if you reset either service's password you may end up with different ones — the app will warn you if that's the case. Credentials stored encrypted.
          </p>
          {loaded && (
            <div className="space-y-2">
              <input
                className="input w-full"
                placeholder="Username"
                value={ocUser}
                onChange={(e) => setOcUser(e.target.value)}
              />
              <input
                className="input w-full"
                type="password"
                placeholder="Password"
                value={ocPass}
                onChange={(e) => setOcPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveOC()}
              />
              {ocError && <div className="text-xs text-red-600">{ocError}</div>}
              {tabroomWarning && <div className="text-xs text-amber-600 dark:text-amber-400">{tabroomWarning}</div>}
              <div className="flex gap-2">
                <button className="btn-primary" onClick={saveOC} disabled={ocLoading}>
                  {ocLoading ? 'Logging in…' : ocSaved ? 'Saved ✓' : (ocUser === ocSavedUser && ocPass === ocSavedPass && ocSavedUser) ? 'Save & login' : 'Save & login'}
                </button>
                {ocSavedUser && (
                  <button
                    className="btn-secondary text-xs"
                    disabled={ocLoading}
                    onClick={async () => {
                      setOcLoading(true); setOcError(''); setTabroomWarning('');
                      try {
                        const res = await window.warroom.tabroom?.retestLogin?.();
                        if (res?.ok) { setOcSaved(true); setTimeout(() => setOcSaved(false), 2000); }
                        else setTabroomWarning(res?.error ?? 'Tabroom login failed.');
                      } catch (e: any) { setTabroomWarning(e?.message ?? 'Error'); }
                      finally { setOcLoading(false); }
                    }}
                  >
                    Re-test Tabroom login
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Google Drive */}
      <div id="settings-gdrive" className="glass-card rounded-sm p-4 space-y-3 mb-4">
        <div>
          <div className="label mb-1">Google Drive</div>
          <p className="text-xs mb-3 text-ink/50">
            Connect Google Drive to browse Word docs and spreadsheets in-app.
            Requires a free OAuth credential from Google Cloud (Desktop app type).
          </p>
          {loaded && <GDriveSettings />}
        </div>
      </div>

      {/* Flow — one unified card: colors, new-flow defaults, and live editor
          behavior. Was two separate cards (Flow colors / Flow); merged since
          they're all "how flows work by default" to the user, even though the
          two halves persist to different storage (colors: two standalone
          localStorage keys read directly by FlowView for backward compat;
          everything else: one FlowPrefs blob via lib/flowPrefs.ts). */}
      <div id="settings-flow" className="glass-card rounded-sm p-4 space-y-4 mb-4">
        <div>
          <div className="label mb-1">Flow</div>
          <p className="text-xs mb-3 text-ink/50">
            Defaults for a brand-new flow, and live behavior in the flow editor. None of this
            touches a flow you've already opened — those keep whatever they were last saved at.
          </p>

          {/* ── Colors ── */}
          <div id="settings-flow-colors" className="text-xs text-ink/70 font-medium mb-1.5">Column colors</div>
          <p className="text-[11px] text-ink/40 mb-2">
            Aff/Pro columns use the first color; Neg/Con columns use the second.
          </p>
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2">
              <span
                className="shrink-0 w-4 h-4 rounded"
                style={{ background: flowAffColor, border: '1px solid var(--border-side)' }}
              />
              <span className="text-xs text-ink/70 flex-1">Aff / Pro</span>
              <input
                type="color"
                value={flowAffColor}
                onChange={(e) => setFlowColor('aff', e.target.value)}
                className="w-8 h-7 rounded cursor-pointer bg-transparent border-0 p-0"
              />
            </div>
            <div className="flex items-center gap-2">
              <span
                className="shrink-0 w-4 h-4 rounded"
                style={{ background: flowNegColor, border: '1px solid var(--border-side)' }}
              />
              <span className="text-xs text-ink/70 flex-1">Neg / Con</span>
              <input
                type="color"
                value={flowNegColor}
                onChange={(e) => setFlowColor('neg', e.target.value)}
                className="w-8 h-7 rounded cursor-pointer bg-transparent border-0 p-0"
              />
            </div>
          </div>

          {/* ── New-flow defaults ── */}
          <div style={{ borderTop: '1px solid var(--border-subtle)' }} className="pt-4 mb-4">
            <div className="text-xs text-ink/70 font-medium mb-1.5">New-flow defaults</div>

            <div className="space-y-1.5 mb-4">
              <div className="text-xs text-ink/70">Default layout for a new policy flow</div>
              <p className="text-[11px] text-ink/40">
                Only affects the plain <strong>+</strong> new-flow button. Auto Flow always guesses its
                own layout from the doc, per flow.
              </p>
              <div className="flex gap-2 mt-1.5">
                <button
                  type="button"
                  title="Default to Stock issues"
                  className={`btn text-xs flex-1 ${flowPrefs.defaultVariant === 'stock-issues' ? 'btn-primary' : ''}`}
                  onClick={() => setFlowPref('defaultVariant', 'stock-issues')}
                >
                  Stock issues
                </button>
                <button
                  type="button"
                  title="Default to Advantage"
                  className={`btn text-xs flex-1 ${flowPrefs.defaultVariant === 'advantage' ? 'btn-primary' : ''}`}
                  onClick={() => setFlowPref('defaultVariant', 'advantage')}
                >
                  Advantage
                </button>
              </div>
            </div>

            <div className="space-y-1.5 mb-4">
              <div className="text-xs text-ink/70">Default speech order for a new PF flow</div>
              <p className="text-[11px] text-ink/40">
                Same scope as above — the plain <strong>+</strong> button only.
              </p>
              <div className="flex gap-2 mt-1.5">
                <button
                  type="button"
                  title="Default to Pro first"
                  className={`btn text-xs flex-1 ${flowPrefs.defaultPfOrder === 'pro-first' ? 'btn-primary' : ''}`}
                  onClick={() => setFlowPref('defaultPfOrder', 'pro-first')}
                >
                  Pro first
                </button>
                <button
                  type="button"
                  title="Default to Con first"
                  className={`btn text-xs flex-1 ${flowPrefs.defaultPfOrder === 'con-first' ? 'btn-primary' : ''}`}
                  onClick={() => setFlowPref('defaultPfOrder', 'con-first')}
                >
                  Con first
                </button>
              </div>
            </div>

            <div className="space-y-1.5 mb-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-ink/70">Default zoom</div>
                <span className="text-xs text-ink/50 tabular-nums">{flowPrefs.defaultZoom}%</span>
              </div>
              <input
                type="range"
                min={50}
                max={150}
                step={5}
                value={flowPrefs.defaultZoom}
                onChange={(e) => setFlowPref('defaultZoom', Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-xs text-ink/70">Default text size</div>
                <span className="text-xs text-ink/50 tabular-nums">{flowPrefs.defaultFontSize}px</span>
              </div>
              <input
                type="range"
                min={10}
                max={20}
                step={1}
                value={flowPrefs.defaultFontSize}
                onChange={(e) => setFlowPref('defaultFontSize', Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          {/* ── Editor behavior ── */}
          <div style={{ borderTop: '1px solid var(--border-subtle)' }} className="pt-4">
            <div className="text-xs text-ink/70 font-medium mb-2">Editor behavior</div>

            <label className="flex items-start gap-2.5 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={flowPrefs.autoFitColumns}
                onChange={(e) => setFlowPref('autoFitColumns', e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <div className="text-xs font-medium text-ink/80">Auto-fit columns to window</div>
                <div className="text-[11px] text-ink/45 mt-0.5 leading-snug">
                  Columns continuously stretch or shrink to fill the window — collapsing the sidebar,
                  resizing, or opening the AI chat panel all re-fit automatically. Turn this off if you'd
                  rather set zoom yourself and have it stay put.
                </div>
              </span>
            </label>

            <label className="ai-glow-ring flex items-start gap-2.5 rounded-sm border border-line p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={flowPrefs.aiTabSummaries}
                onChange={(e) => setFlowPref('aiTabSummaries', e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <div className="text-xs font-medium text-ink/80">AI tab summaries on hover</div>
                <div className="text-[11px] text-ink/45 mt-0.5 leading-snug">
                  Hovering a flow tab asks Warroom AI for a one-sentence summary of the argument on that
                  sheet, the first time you hover it after its content changes — then it's cached, so it
                  doesn't cost another call until something on that sheet actually changes. Off means tabs
                  only ever show the free local tag preview; Warroom AI is never called from a hover.
                </div>
              </span>
            </label>
          </div>

          <button
            type="button"
            title="Reset all Flow settings"
            onClick={resetAllFlowSettings}
            className="text-xs text-ink/50 hover:text-ink/80 underline underline-offset-2 mt-3"
          >
            Reset to defaults
          </button>
        </div>
      </div>

      {/* Auto Flow tag style */}
      <div id="settings-autoflow-style" className="glass-card rounded-sm p-4 space-y-3 mb-4">
        <div>
          <div className="label mb-1">Auto Flow tag style</div>
          <p className="text-xs mb-3 text-ink/50">
            How Auto Flow writes each card's tag into a flow cell when it sorts uploaded speech docs
            into your flow. The cite line underneath the tag is always plain text.
          </p>
          <div
            className="rounded-sm border border-line px-3 py-2.5 mb-3"
            style={{ background: 'var(--bg-elevated)' }}
          >
            <div className="text-[10px] text-ink/40 mb-1">Preview</div>
            <div
              style={{
                fontWeight: autoFlowStyle.bold ? 700 : 400,
                fontStyle: autoFlowStyle.italic ? 'italic' : 'normal',
                textDecoration: autoFlowStyle.underline ? 'underline' : 'none',
                color: autoFlowStyle.color || 'inherit',
                fontSize: `${autoFlowStyle.fontSize}px`,
              }}
            >
              Guitteriez 25
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <label className="flex items-center gap-1.5 text-xs text-ink/70 cursor-pointer">
              <input
                type="checkbox"
                checked={autoFlowStyle.bold}
                onChange={(e) => setAutoFlowStyleProp('bold', e.target.checked)}
              />
              Bold
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink/70 cursor-pointer">
              <input
                type="checkbox"
                checked={autoFlowStyle.italic}
                onChange={(e) => setAutoFlowStyleProp('italic', e.target.checked)}
              />
              Italic
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink/70 cursor-pointer">
              <input
                type="checkbox"
                checked={autoFlowStyle.underline}
                onChange={(e) => setAutoFlowStyleProp('underline', e.target.checked)}
              />
              Underline
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink/55">Color</span>
              <input
                type="color"
                value={autoFlowStyle.color || '#111111'}
                onChange={(e) => setAutoFlowStyleProp('color', e.target.value)}
                className="w-8 h-7 rounded cursor-pointer bg-transparent border-0 p-0"
              />
              {autoFlowStyle.color && (
                <button
                  type="button"
                  onClick={() => setAutoFlowStyleProp('color', null)}
                  className="text-[11px] text-ink/40 hover:text-ink/70 underline underline-offset-2"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink/55">Size</span>
              <input
                type="number"
                min={8}
                max={32}
                value={autoFlowStyle.fontSize}
                onChange={(e) => setAutoFlowStyleProp('fontSize', Number(e.target.value) || AUTOFLOW_STYLE_DEFAULTS.fontSize)}
                className="input w-16 text-xs"
              />
            </div>
          </div>
          <p className="text-[11px] text-ink/40 mt-2">
            Only bold, italic, and underline actually reach the flow — a cell can't carry a custom
            color or size, so those two only affect this preview.
          </p>
          <button
            type="button"
            onClick={resetAutoFlowStyle}
            className="text-xs text-ink/50 hover:text-ink/80 underline underline-offset-2 mt-2"
          >
            Reset to defaults
          </button>
        </div>
      </div>

      {/* Storage */}
      <div id="settings-storage" className="glass-card rounded-sm p-4 space-y-3 mb-4">
        <div className="label mb-1">Storage</div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-ink/70">On device (local)</p>
          <div className="space-y-1.5">
            {[
              { label: 'Cases, blocks & cards', note: 'userData/warroom/db.json', tag: 'plaintext' },
              { label: 'Opponents, tournaments & rounds', note: 'userData/warroom/db.json', tag: 'plaintext' },
              { label: 'Flows index', note: 'userData/warroom/flows_index.json', tag: 'plaintext' },
              { label: 'App settings (event, model)', note: 'userData/warroom/app_settings.json', tag: 'plaintext' },
              { label: 'Gemini API key', note: 'secure_gemini.json', tag: 'encrypted' },
              { label: 'OpenCaselist credentials', note: 'secure_oc_username/password.json', tag: 'encrypted' },
              { label: 'Google Drive OAuth tokens', note: 'secure_gdrive_*.json', tag: 'encrypted' },
              { label: 'Chat credentials', note: 'secure_chat_*.json', tag: 'encrypted' },
            ].map(({ label, note, tag }) => (
              <div key={label} className="flex items-center gap-2">
                <span
                  className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                  style={tag === 'encrypted'
                    ? { background: '#10b98122', color: '#10b981' }
                    : { background: 'var(--bg-input)', color: 'var(--nav-inactive-color)' }}
                >
                  {tag}
                </span>
                <span className="text-xs text-ink/70 flex-1">{label}</span>
                <code className="text-[10px] font-mono text-ink/30 truncate max-w-[160px]">{note}</code>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-side)' }} className="pt-3 space-y-1.5">
          <p className="text-xs font-medium text-ink/70">In backend (Supabase)</p>
          {[
            { label: 'Team chat message text', tag: 'encrypted' },
            { label: 'Direct message text', tag: 'encrypted' },
            { label: 'Shared attachment data (cases, blocks, flows, opponents, tournaments, speech docs)', tag: 'encrypted' },
            { label: 'Quoted reply snippets', tag: 'encrypted' },
            { label: 'Team Files — file names & content', tag: 'encrypted' },
            { label: 'Team Files — AI-generated summary (oversized files)', tag: 'encrypted' },
            { label: 'Sender names, timestamps & attachment labels', tag: 'plaintext' },
            { label: 'Team Files — uploader names, modified time & removed flag', tag: 'plaintext' },
            { label: 'User accounts & team membership', tag: 'plaintext' },
          ].map(({ label, tag }) => (
            <div key={label} className="flex items-center gap-2">
              <span
                className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={tag === 'encrypted'
                  ? { background: '#10b98122', color: '#10b981' }
                  : { background: 'var(--bg-input)', color: 'var(--nav-inactive-color)' }}
              >
                {tag}
              </span>
              <span className="text-xs text-ink/70">{label}</span>
            </div>
          ))}
          <p className="text-[10px] pt-1" style={{ color: 'var(--nav-inactive-color)' }}>
            Only synced when you are signed in to chat.
          </p>
        </div>

        <p className="text-[10px]" style={{ color: 'var(--nav-inactive-color)' }}>
          Encrypted secrets use OS-level encryption (macOS Keychain / Windows DPAPI) via Electron safeStorage.
          Chat message content and shared attachments are end-to-end encrypted (AES-256-GCM) with a key
          derived from your team's invite code — Supabase only ever stores ciphertext.
        </p>
      </div>

      {/* Documentation */}
      <div id="settings-documentation" className="glass-card rounded-sm p-4 mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="label mb-1">Documentation</div>
          <p className="text-xs text-ink/50">Full reference for all features, data model, and architecture. Warroom is primarily built for policy debate but also supports PF and LD.</p>
        </div>
        <button
          className="btn shrink-0"
          onClick={() => setView({ kind: 'docs' })}
        >
          View docs
        </button>
      </div>

      {/* User Manual */}
      <div id="settings-usermanual" className="glass-card rounded-sm p-4 mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="label mb-1">User Manual</div>
          <p className="text-xs text-ink/50">Step-by-step guide to using every feature — navigation, cases, flows, the speech timer, AI tools, and more. Searchable with ⌘F.</p>
        </div>
        <button
          className="btn shrink-0"
          onClick={() => setView({ kind: 'user-manual' })}
        >
          Open manual
        </button>
      </div>

      {/* Keyboard Shortcuts */}
      <div id="settings-shortcuts" className="glass-card rounded-sm p-4 mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="label mb-1">Keyboard Shortcuts</div>
          <p className="text-xs text-ink/50">
            The full list of shortcuts across the app — global search, flow editing, AI chat, and more.
            Press <span className="font-mono">{window.warroom?.platform === 'darwin' ? '⌘' : 'Ctrl'}/</span> anytime to open it.
          </p>
        </div>
        <button
          className="btn shrink-0"
          onClick={() => setShortcutsOpen(true)}
        >
          View shortcuts
        </button>
      </div>

      {/* Import / Export Settings */}
      <div id="settings-importexport" className="glass-card rounded-sm p-4 mb-4">
        <div className="label mb-1">Import / Export Settings</div>
        <p className="text-xs text-ink/50 mb-3">
          Save your preferences (debate event, AI provider/model, theme, notifications, and more) to a
          file, or load them on another device. <strong>API keys and passwords are never included</strong> —
          you'll need to re-enter those after importing.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn shrink-0" onClick={handleExportSettings} disabled={settingsExportStatus === 'working'}>
            {settingsExportStatus === 'working' ? 'Exporting…' : settingsExportStatus === 'done' ? 'Saved ✓' : 'Export settings'}
          </button>
          <button className="btn shrink-0" onClick={handleImportSettings} disabled={settingsImportStatus === 'working'}>
            {settingsImportStatus === 'working' ? 'Importing…' : settingsImportStatus === 'done' ? 'Imported ✓' : 'Import settings'}
          </button>
        </div>
        {settingsExportStatus === 'error' && (
          <p className="text-xs mt-2" style={{ color: 'var(--danger, #ef4444)' }}>{settingsExportMsg}</p>
        )}
        {settingsImportStatus === 'error' && (
          <p className="text-xs mt-2" style={{ color: 'var(--danger, #ef4444)' }}>{settingsImportMsg}</p>
        )}
        {settingsImportStatus === 'done' && (
          <p className="text-xs mt-2" style={{ color: 'var(--nav-inactive-color)' }}>{settingsImportMsg}</p>
        )}
      </div>

      {/* More settings */}
      <div id="settings-more" className="mb-4">
        <button
          className="flex items-center gap-2 w-full px-1 py-1.5 text-xs font-medium transition"
          style={{ color: 'var(--nav-inactive-color)', background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <svg
            width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: moreOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
          >
            <path d="M7 5l5 5-5 5" />
          </svg>
          More settings
        </button>

        {moreOpen && (
          <div className="mt-2 space-y-4">
            {/* Chat / sign out */}
            <div className="glass-card rounded-sm p-4">
              <div className="label mb-1">Chat</div>
              {currentUser ? (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-ink">{(currentUser as any).displayName ?? (currentUser as any).email ?? 'Signed in'}</p>
                    <p className="text-xs text-ink/40 mt-0.5">Signed in to team chat</p>
                  </div>
                  <button
                    className="btn text-xs px-3 py-1.5"
                    style={{ color: 'var(--danger, #b3261e)', borderColor: 'var(--danger, #b3261e)' }}
                    onClick={async () => {
                      try {
                        await signOut();
                        await window.warroom?.secure.set('chat_email', '');
                        await window.warroom?.secure.set('chat_password', '');
                        localStorage.removeItem('warroom-chat-user');
                        localStorage.removeItem('warroom-chat-team');
                      } catch {}
                      setCurrentUser(null);
                      setCurrentTeam(null);
                      setTeamMembers([]);
                    }}
                  >
                    Log out of chat
                  </button>
                </div>
              ) : (
                <p className="text-xs text-ink/50">Not signed in to chat. Open the chat panel to sign in.</p>
              )}
            </div>

            {/* Files display (team rooms) */}
            <div className="glass-card rounded-sm p-4">
              <div className="label mb-1">Team files display</div>
              <p className="text-xs text-ink/50 mb-3">How to reach a team room's Files list.</p>
              <div className="flex rounded-lg p-0.5 w-fit" style={{ background: 'var(--mode-toggle-bg)' }}>
                {([['split', 'Chat / Files bar'], ['icon', 'Files icon']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => { setFilesBarStyle(v); setFilesBarStyleLocal(v); }}
                    className="px-3 py-1 text-xs rounded-md transition-all"
                    style={filesBarStyle === v
                      ? { background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', fontWeight: 600 }
                      : { background: 'transparent', color: 'var(--nav-inactive-color)' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick chat */}
            <div className="glass-card rounded-sm p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="label mb-1">Quick chat</div>
                  <p className="text-xs text-ink/50">Pin team rooms and DMs to the top bar for one-click access.</p>
                </div>
                <button
                  role="switch"
                  aria-checked={quickChatEnabled}
                  onClick={() => {
                    const next = !quickChatEnabled;
                    setQuickChatEnabled(next);
                    setQuickChatEnabledLocal(next);
                    if (next) setShowQuickChatPicker(true);
                  }}
                  className="relative shrink-0 transition-colors"
                  style={{ width: 34, height: 20, borderRadius: 10, background: quickChatEnabled ? 'var(--accent)' : 'var(--border-med)', border: 'none', cursor: 'pointer' }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: quickChatEnabled ? 16 : 2, width: 16, height: 16,
                    borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
                  }} />
                </button>
              </div>
              {quickChatEnabled && (
                <button className="btn text-xs px-2.5 py-1 mt-3" onClick={() => setShowQuickChatPicker(true)}>
                  {getQuickChatPins().length > 0 ? 'Edit pins…' : 'Choose pins…'}
                </button>
              )}
            </div>
            {showQuickChatPicker && <QuickChatPicker onClose={() => setShowQuickChatPicker(false)} />}

            {/* Sharing */}
            <div className="glass-card rounded-sm p-4">
              <div className="label mb-1">Sharing</div>
              <p className="text-xs text-ink/50 mb-3">
                Default permission when sharing flows and cases via the Share button.
              </p>
              <div className="flex rounded-lg p-0.5 w-fit" style={{ background: 'var(--mode-toggle-bg)' }}>
                {(['edit', 'view'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setDefaultSharePermission(p)}
                    className="px-3 py-1 text-xs rounded-md transition-all capitalize"
                    style={defaultSharePermission === p
                      ? { background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', fontWeight: 600 }
                      : { background: 'transparent', color: 'var(--nav-inactive-color)' }}
                  >
                    {p === 'edit' ? 'Can edit (default)' : 'Can view'}
                  </button>
                ))}
              </div>
            </div>

            {/* Setup wizard */}
            <div className="glass-card rounded-sm p-4 flex items-center justify-between gap-4">
              <div>
                <div className="label mb-1">Setup wizard</div>
                <p className="text-xs text-ink/50">Re-run the onboarding flow to update your event, credentials, or API key.</p>
              </div>
              <button
                className="btn shrink-0"
                onClick={() => setShowOnboarding(true)}
              >
                Restart setup
              </button>
            </div>
          </div>
        )}
      </div>

        </div>
      </div>
    </div>
  );
}
