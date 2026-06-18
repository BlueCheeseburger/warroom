import React, { useState, useEffect } from 'react';
import { useApp, mapSettingsEvent, Direction, Theme } from '../store/appStore';
import { signOut } from '../lib/supabase';

const THEME_OPTIONS: {
  value: Direction; label: string; blurb: string;
  preview: { bg: string; card: string; accent: string; ink: string; line: string };
}[] = [
  { value: 'calm', label: 'Calm Native', blurb: 'Cool & modern',
    preview: { bg: '#edeff3', card: '#ffffff', accent: '#4b53c4', ink: '#1b1d24', line: 'rgba(30,40,70,0.12)' } },
  { value: 'paper', label: 'Warm Paper', blurb: 'Editorial serif',
    preview: { bg: '#f5f1e8', card: '#fbf9f3', accent: '#b4532a', ink: '#2b2722', line: 'rgba(60,45,25,0.16)' } },
  { value: 'editorial', label: 'Sharp Editorial', blurb: 'High contrast',
    preview: { bg: '#fafafa', card: '#ffffff', accent: '#155fff', ink: '#111113', line: 'rgba(17,17,19,0.14)' } },
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
  const { currentUser, setCurrentUser, setCurrentTeam, setTeamMembers, defaultSharePermission, setDefaultSharePermission, setEvent, setShowOnboarding, setView, view, direction, setDirection, theme, setTheme } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (view.kind === 'settings' && (view as any).scrollTo) {
      const el = document.getElementById(`settings-${(view as any).scrollTo}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);
  const [apiProvider, setApiProvider] = useState<'gemini' | 'openai' | 'anthropic'>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  // saved values per provider — used to show Edit vs Save and to restore when switching tabs
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>({ gemini: '', openai: '', anthropic: '' });
  const [geminiModel, setGeminiModel] = useState('flash');
  const [geminiModelSaved, setGeminiModelSaved] = useState(false);
  const [tokenSavingDefault, setTokenSavingDefault] = useState(false);
  const [openaiModel, setOpenaiModel] = useState('gpt-4.1-mini');
  const [openaiModelSaved, setOpenaiModelSaved] = useState(false);
  const [anthropicModel, setAnthropicModel] = useState('claude-3-5-sonnet-20241022');
  const [anthropicModelSaved, setAnthropicModelSaved] = useState(false);
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

  useEffect(() => {
    Promise.all([
      window.warroom?.secure.get('gemini'),
      window.warroom?.secure.get('oc_username'),
      window.warroom?.secure.get('oc_password'),
      window.warroom?.storage.read('app_settings'),
      window.warroom?.secure.get('openai_key'),
      window.warroom?.secure.get('anthropic_key'),
    ]).then(([k, u, p, s, oai, ant]) => {
      if (u) { setOcUser(u); setOcSavedUser(u); }
      if (p) { setOcPass(p); setOcSavedPass(p); }
      if ((s as any)?.event) setSettingsEvent((s as any).event);
      if ((s as any)?.geminiModel) setGeminiModel((s as any).geminiModel);
      if ((s as any)?.openaiModel) setOpenaiModel((s as any).openaiModel);
      if ((s as any)?.anthropicModel) setAnthropicModel((s as any).anthropicModel);
      if ((s as any)?.tokenSavingDefault !== undefined) {
        setTokenSavingDefault((s as any).tokenSavingDefault);
      } else {
        setTokenSavingDefault((s as any)?.geminiModel === 'flash-lite');
      }
      const keys = { gemini: k ?? '', openai: oai ?? '', anthropic: ant ?? '' };
      setSavedKeys(keys);
      const provider: 'gemini' | 'openai' | 'anthropic' = (s as any)?.apiProvider ?? 'gemini';
      setApiProvider(provider);
      setApiKey(keys[provider]);
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

  function detectProvider(val: string): 'gemini' | 'openai' | 'anthropic' | null {
    if (val.startsWith('AIza')) return 'gemini';
    if (val.startsWith('sk-ant-')) return 'anthropic';
    if (val.startsWith('sk-')) return 'openai';
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

  async function switchProvider(p: 'gemini' | 'openai' | 'anthropic') {
    setApiProvider(p);
    setApiKey(savedKeys[p]);
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, apiProvider: p });
    window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { apiProvider: p } }));
  }

  async function saveApiKey() {
    const val = apiKey.trim();
    if (!val) return;
    const secureKey = apiProvider === 'gemini' ? 'gemini' : apiProvider === 'openai' ? 'openai_key' : 'anthropic_key';
    await window.warroom.secure.set(secureKey, val);
    setSavedKeys((prev) => ({ ...prev, [apiProvider]: val }));
    const s = await window.warroom?.storage.read('app_settings') as any ?? {};
    await window.warroom?.storage.write('app_settings', { ...s, apiProvider });
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  }

  async function saveGeminiModel(model: string) {
    setGeminiModel(model);
    // Auto-enable token saving for flash-lite; when switching to other models, preserve current setting
    const newTokenSaving = model === 'flash-lite' ? true : tokenSavingDefault;
    setTokenSavingDefault(newTokenSaving);
    await window.warroom?.storage.write('app_settings', { event: settingsEvent, geminiModel: model, tokenSavingDefault: newTokenSaving });
    window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { tokenSavingDefault: newTokenSaving, geminiModel: model } }));
    setGeminiModelSaved(true);
    setTimeout(() => setGeminiModelSaved(false), 2000);
  }

  async function saveTokenSavingDefault(val: boolean) {
    setTokenSavingDefault(val);
    await window.warroom?.storage.write('app_settings', { event: settingsEvent, geminiModel, tokenSavingDefault: val });
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
              return (
                <button
                  key={o.value}
                  onClick={() => setDirection(o.value)}
                  className="text-left rounded-xl p-3 transition border"
                  style={{
                    background: o.preview.bg,
                    borderColor: active ? o.preview.accent : 'var(--border-med)',
                    boxShadow: active ? `0 0 0 2px ${o.preview.accent}` : 'none',
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <span className="w-3 h-3 rounded-full" style={{ background: o.preview.accent }} />
                    <span className="w-3 h-3 rounded-full" style={{ background: o.preview.card, border: `1px solid ${o.preview.line}` }} />
                  </div>
                  <div className="text-xs font-semibold" style={{ color: o.preview.ink }}>{o.label}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: o.preview.ink, opacity: 0.55 }}>{o.blurb}</div>
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

        {/* Single unified input */}
        {loaded && (
          <div>
            <p className="text-xs mb-2 text-ink/50">
              {apiProvider === 'gemini' && 'Powers card extraction and block suggestions. Stored encrypted on device.'}
              {apiProvider === 'openai' && 'OpenAI API key. Stored encrypted on device.'}
              {apiProvider === 'anthropic' && 'Anthropic API key. Stored encrypted on device.'}
            </p>
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono text-xs"
                type="password"
                placeholder={
                  apiProvider === 'gemini' ? 'AIza…' :
                  apiProvider === 'openai' ? 'sk-…' : 'sk-ant-…'
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
              <p className="text-[10px] pt-1" style={{ color: 'var(--nav-inactive-color)' }}>
                Agentic tasks will use Gemini 2.5 Flash regardless of this selection.
              </p>
              <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: '1px solid var(--border-side)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Token saving by default</div>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>
                    When attaching a speech doc to Warroom Agent, only send underlined text, cites, and headings — not small body text. Auto-enabled for Flash Lite.
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
          </div>
        )}
      </div>

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
