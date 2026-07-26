import React, { useState, useEffect } from 'react';
import { useApp, mapSettingsEvent, Direction, Theme } from '../store/appStore';
import { signOut } from '../lib/supabase';
import { AutoFlowTagStyle, AUTOFLOW_STYLE_DEFAULTS, readAutoFlowTagStyle, writeAutoFlowTagStyle } from '../lib/autoFlowTagStyle';
import { FlowPrefs, FLOW_PREFS_DEFAULTS, readFlowPrefs, writeFlowPrefs } from '../lib/flowPrefs';

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

/** Starting point for the options blob, shown as the placeholder in Settings. */
const LMSTUDIO_OPTIONS_EXAMPLE = '{\n  "temperature": 0.1,\n  "max_tokens": 8192,\n  "top_p": 0.95,\n  "ttl": 3600\n}';

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
  } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);

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
  const [lmSaved, setLmSaved] = useState(false);
  /** Model ids fetched from the running server — null until the user asks for them. */
  const [lmFound, setLmFound] = useState<string[] | null>(null);
  const [lmBusy, setLmBusy] = useState<null | 'list' | 'test'>(null);
  const [lmMsg, setLmMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

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
      if ((s as any)?.lmstudioBaseUrl) setLmBaseUrl((s as any).lmstudioBaseUrl);
      if ((s as any)?.lmstudioModel) setLmModel((s as any).lmstudioModel);
      if (typeof (s as any)?.lmstudioOptions === 'string') setLmOptions((s as any).lmstudioOptions);
      if ((s as any)?.lmstudioTools !== undefined) setLmTools((s as any).lmstudioTools !== false);
      // No 'lmstudio' entry — it's a local server with no key to store.
      setNotifySettingsState({
        notifyPairings:  (s as any)?.notifyPairings  !== false,
        notifyResults:   (s as any)?.notifyResults   !== false,
        notifyTopics:    (s as any)?.notifyTopics    !== false,
        notifyJudges:    (s as any)?.notifyJudges    !== false,
        notifyOpponents: (s as any)?.notifyOpponents !== false,
      });
      const keys: Record<string, string> = { gemini: k ?? '', openai: oai ?? '', anthropic: ant ?? '', grok: grok ?? '' };
      setSavedKeys(keys);
      const provider: AIProvider = (s as any)?.apiProvider ?? 'gemini';
      setApiProvider(provider);
      setApiKey(keys[provider] ?? '');
      setLoaded(true);
    });
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

  /** Persist the whole LM Studio block at once — URL, model, options, tool toggle. */
  async function saveLmStudio(patch?: Partial<{ lmstudioModel: string }>) {
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    const next = {
      ...s,
      apiProvider: 'lmstudio',
      lmstudioBaseUrl: lmBaseUrl.trim() || LMSTUDIO_DEFAULT_BASE_URL,
      lmstudioModel: (patch?.lmstudioModel ?? lmModel).trim() || LMSTUDIO_DEFAULT_MODEL,
      lmstudioOptions: lmOptions,
      lmstudioTools: lmTools,
    };
    await window.warroom?.storage.write('app_settings', next);
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

  return (
    <div className="p-8 max-w-xl">
      <div className="label mb-1">Settings</div>
      <h1 className="text-lg font-semibold mb-6 text-ink">App settings</h1>

      {/* Appearance */}
      <div className="glass-card rounded-sm p-4 space-y-4 mb-4">
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
      </div>

      {/* Speech docs & cases */}
      <div className="glass-card rounded-sm p-4 space-y-4 mb-4">
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
      </div>

      {/* Event */}
      <div className="glass-card rounded-sm p-4 space-y-3 mb-4">
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
      <div className="glass-card rounded-sm p-4 space-y-3 mb-4">
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
              <div className="space-y-1.5">
                {LMSTUDIO_MODEL_OPTIONS.map((o) => (
                  <div key={o.value} className="relative group">
                    <button
                      className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition border"
                      style={{
                        background: lmModel === o.value ? 'var(--item-selected-bg)' : 'var(--bg-input)',
                        color: lmModel === o.value ? 'var(--item-selected-text)' : 'rgb(var(--ink-rgb))',
                        borderColor: lmModel === o.value ? 'transparent' : 'var(--border-med)',
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
                <button className="btn text-xs" onClick={fetchLmModels} disabled={lmBusy !== null}>
                  {lmBusy === 'list' ? 'Checking…' : 'Loaded models'}
                </button>
              </div>
            </div>

            {/* Models actually available on the running server */}
            {lmFound && lmFound.length > 0 && (
              <div>
                <div className="label mb-1">Loaded models</div>
                <p className="text-xs mb-2 text-ink/50">Reported by your server — click one to use it.</p>
                <div className="space-y-1">
                  {lmFound.map((id) => (
                    <button
                      key={id}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition border"
                      style={{
                        background: lmModel === id ? 'var(--item-selected-bg)' : 'var(--bg-input)',
                        color: lmModel === id ? 'var(--item-selected-text)' : 'rgb(var(--ink-rgb))',
                        borderColor: lmModel === id ? 'transparent' : 'var(--border-med)',
                      }}
                      onClick={() => pickLmModel(id)}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>
            )}

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

            {/* Save + end-to-end test */}
            <div className="flex items-center gap-2">
              <button className="btn-primary" onClick={() => saveLmStudio()}>
                {lmSaved ? 'Saved ✓' : 'Save'}
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
      <div className="glass-card rounded-sm p-4 space-y-3 mb-4">
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
      <div className="glass-card rounded-sm p-4 space-y-3 mb-4">
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
            { label: 'Sender names, timestamps & attachment labels', tag: 'plaintext' },
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
      <div className="glass-card rounded-sm p-4 mb-4 flex items-center justify-between gap-4">
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
      <div className="glass-card rounded-sm p-4 mb-4 flex items-center justify-between gap-4">
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
      <div className="glass-card rounded-sm p-4 mb-4 flex items-center justify-between gap-4">
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

      {/* More settings */}
      <div className="mb-4">
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
  );
}
