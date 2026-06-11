export function humanizeGeminiError(raw: string | undefined | null): string {
  const msg = (raw ?? '').toLowerCase();

  if (msg.includes('resource_exhausted') || msg.includes('quota') || msg.includes('429') || msg.includes('rate limit'))
    return "You've hit your Gemini usage limit. Wait a minute, then try again — or check your quota at aistudio.google.com.";

  if (msg.includes('api_key_invalid') || msg.includes('invalid api key') || msg.includes('api key not valid'))
    return "Your Gemini API key isn't working. Double-check it in Settings → API Keys.";

  if (msg.includes('permission_denied') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('401'))
    return "Gemini rejected the request — your API key may not have access to this model. Check Settings → API Keys.";

  if (msg.includes('safety') || msg.includes('blocked') || msg.includes('harm'))
    return "Gemini flagged that response for safety reasons. Try rephrasing or adjusting your question.";

  if (msg.includes('context') && (msg.includes('long') || msg.includes('length') || msg.includes('limit')))
    return "The conversation is too long for Gemini to handle. Start a new chat to continue.";

  if (msg.includes('overload') || msg.includes('unavailable') || msg.includes('503'))
    return "Gemini is overloaded right now. Try again in a few seconds.";

  if (msg.includes('internal') || msg.includes('500') || msg.includes('backend'))
    return "Gemini ran into a problem on their end. Try again in a moment.";

  if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('timeout'))
    return "Couldn't reach Gemini — check your internet connection and try again.";

  if (msg.includes('no_key') || msg.includes('no gemini') || msg.includes('api key'))
    return "Add your Gemini API key in Settings → API Keys to use AI features.";

  if (msg.includes('model') && (msg.includes('not found') || msg.includes('deprecated') || msg.includes('unsupported')))
    return "The selected Gemini model isn't available. Try switching models in Settings.";

  // Non-empty but unrecognized — trim it down to something readable
  if (raw && raw.length > 0 && raw.length < 120) return raw;

  return "Something went wrong with Gemini. Try again, or start a new chat if the problem persists.";
}
