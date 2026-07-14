type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'grok';

const PROVIDER_INFO: Record<AIProvider, { name: string; quotaHost: string }> = {
  gemini:    { name: 'Gemini', quotaHost: 'aistudio.google.com' },
  openai:    { name: 'OpenAI', quotaHost: 'platform.openai.com' },
  anthropic: { name: 'Claude', quotaHost: 'console.anthropic.com' },
  grok:      { name: 'Grok',   quotaHost: 'console.x.ai' },
};

// Tracks the user's currently selected AI provider so error copy can name the
// right service. Kept in sync the same way TitleBar tracks it: an initial read
// plus a listener for the app-wide settings-change event.
let currentProvider: AIProvider = 'gemini';

if (typeof window !== 'undefined') {
  window.warroom?.storage.read('app_settings').then((s: any) => {
    if (s?.apiProvider) currentProvider = s.apiProvider;
  }).catch(() => {});
  window.addEventListener('warroom-settings-change', (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.apiProvider) currentProvider = detail.apiProvider;
  });
}

export function humanizeGeminiError(raw: string | undefined | null, provider?: AIProvider): string {
  const info = PROVIDER_INFO[provider ?? currentProvider];
  const msg = (raw ?? '').toLowerCase();

  if (msg.includes('resource_exhausted') || msg.includes('quota') || msg.includes('429') || msg.includes('rate limit'))
    return `You've hit your ${info.name} usage limit. Wait a minute, then try again — or check your quota at ${info.quotaHost}.`;

  if (msg.includes('api_key_invalid') || msg.includes('invalid api key') || msg.includes('api key not valid'))
    return `Your ${info.name} API key isn't working. Double-check it in Settings → API Keys.`;

  if (msg.includes('permission_denied') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('401'))
    return `${info.name} rejected the request — your API key may not have access to this model. Check Settings → API Keys.`;

  if (msg.includes('safety') || msg.includes('blocked') || msg.includes('harm'))
    return `${info.name} flagged that response for safety reasons. Try rephrasing or adjusting your question.`;

  if (msg.includes('context') && (msg.includes('long') || msg.includes('length') || msg.includes('limit')))
    return `The conversation is too long for ${info.name} to handle. Start a new chat to continue.`;

  if (msg.includes('overload') || msg.includes('unavailable') || msg.includes('503'))
    return `${info.name} is overloaded right now. Try again in a few seconds.`;

  if (msg.includes('internal') || msg.includes('500') || msg.includes('backend'))
    return `${info.name} ran into a problem on their end. Try again in a moment.`;

  if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('timeout'))
    return `Couldn't reach ${info.name} — check your internet connection and try again.`;

  if (msg.includes('no_key') || msg.includes('api key'))
    return `Add your ${info.name} API key in Settings → API Keys to use AI features.`;

  if (msg.includes('model') && (msg.includes('not found') || msg.includes('deprecated') || msg.includes('unsupported')))
    return `The selected ${info.name} model isn't available. Try switching models in Settings.`;

  // Non-empty but unrecognized — trim it down to something readable
  if (raw && raw.length > 0 && raw.length < 120) return raw;

  return `Something went wrong with ${info.name}. Try again, or start a new chat if the problem persists.`;
}
