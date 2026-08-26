type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'grok' | 'lmstudio';

const PROVIDER_INFO: Record<AIProvider, { name: string; quotaHost: string }> = {
  gemini:    { name: 'Gemini',     quotaHost: 'aistudio.google.com' },
  openai:    { name: 'OpenAI',     quotaHost: 'platform.openai.com' },
  anthropic: { name: 'Claude',     quotaHost: 'console.anthropic.com' },
  grok:      { name: 'Grok',       quotaHost: 'console.x.ai' },
  lmstudio:  { name: 'LM Studio',  quotaHost: 'lmstudio.ai' },
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
  const effective = provider ?? currentProvider;
  const info = PROVIDER_INFO[effective];
  const msg = (raw ?? '').toLowerCase();

  // LM Studio runs locally, so almost none of the hosted-provider advice below
  // applies — there's no API key, no quota, and no internet dependency. Its
  // failure modes are "server isn't running", "model isn't loaded", and "too slow".
  if (effective === 'lmstudio') {
    if (msg.includes('econnrefused') || msg.includes("can't reach") || msg.includes('fetch failed') || msg.includes('enotfound'))
      return "Warroom can't reach LM Studio. Open LM Studio → Developer tab → Start Server, and check the port matches Settings.";
    if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('abort'))
      return 'LM Studio took too long to respond. The model may be too large for this machine — try a smaller one like Gemma 4 E4B.';
    if (msg.includes('404') || (msg.includes('model') && msg.includes('not found')))
      return "That model isn't loaded in LM Studio. Load it there, or pick one from “Loaded models” in Settings.";
    if (msg.includes('context') && (msg.includes('long') || msg.includes('length') || msg.includes('limit')))
      return "The conversation exceeded the model's context length. Start a new chat, or raise the context length when loading the model in LM Studio.";
    if (raw && raw.length > 0 && raw.length < 160) return raw;
    return 'LM Studio ran into a problem. Check that the local server is running and the model is loaded.';
  }

  if (msg.includes('resource_exhausted') || msg.includes('quota') || msg.includes('429') || msg.includes('rate limit'))
    return `You've hit your ${info.name} usage limit. Wait a minute, then try again — or check your quota at ${info.quotaHost}.`;

  if (msg.includes('api_key_invalid') || msg.includes('invalid api key') || msg.includes('api key not valid'))
    return `Your ${info.name} API key isn't working. Double-check it in Settings → AI.`;

  if (msg.includes('permission_denied') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('401'))
    return `${info.name} rejected the request — your API key may not have access to this model. Check Settings → AI.`;

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
    return `Add your ${info.name} API key in Settings → AI to use AI features.`;

  if (msg.includes('model') && (msg.includes('not found') || msg.includes('deprecated') || msg.includes('unsupported')))
    return `The selected ${info.name} model isn't available. Try switching models in Settings.`;

  // Non-empty but unrecognized — trim it down to something readable
  if (raw && raw.length > 0 && raw.length < 120) return raw;

  return `Something went wrong with ${info.name}. Try again, or start a new chat if the problem persists.`;
}
