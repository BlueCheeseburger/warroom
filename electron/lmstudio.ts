/**
 * LM Studio provider — local, OpenAI-compatible inference.
 *
 * LM Studio (lmstudio.ai) runs models on the user's own machine and exposes an
 * OpenAI-compatible REST API on localhost with **no authentication**. That makes it
 * structurally different from every other provider Warroom supports:
 *
 *   - No API key. Nothing to store in `secure_*.json`, nothing to validate.
 *   - No cost tiers. There's one model — whichever the user loaded — so the
 *     lite/balanced/best tier system collapses to a single id.
 *   - The model id isn't ours to hardcode. It depends on how the user downloaded
 *     the model, so the id is free text with presets as a convenience only.
 *   - Failures are local, not remote: "server isn't running", "model isn't
 *     loaded", "too slow for this machine" — never quota or auth.
 *
 * The pure logic lives here (rather than inline in main.ts) so it can be exercised
 * by `scripts/test-lmstudio.ts` without booting Electron — same split as
 * `docxFlowCards.ts`.
 */

export const LMSTUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1';

/** Default model — matches the Gemma 4 12B entry in Settings' preset list. */
export const LMSTUDIO_DEFAULT_MODEL = 'google/gemma-4-12b';

/**
 * Local inference is far slower than a hosted API — a 12B model on consumer
 * hardware can spend minutes on a long completion — so LM Studio gets its own
 * generous timeout instead of the 45s the hosted providers use. A hosted call
 * hanging for ten minutes means something is broken; a local one is just working.
 */
export const LMSTUDIO_TIMEOUT_MS = 600_000;

/** Normalise a user-typed base URL to the `/v1` root, accepting it with or without. */
export function normalizeLmStudioUrl(raw: unknown): string {
  const trimmed = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return LMSTUDIO_DEFAULT_BASE_URL;
  return trimmed.replace(/\/v1$/i, '') + '/v1';
}

export interface LmStudioConfig {
  baseUrl: string;
  model: string;
  /** Extra request-body params merged over Warroom's defaults (temperature, max_tokens, ttl, …). */
  options: Record<string, any>;
  /** Whether to advertise Warroom's tools to the model — off for models that can't call them. */
  sendTools: boolean;
}

/**
 * Build a config from a raw `app_settings` object. Pure so the resolution rules
 * (defaults, URL normalisation, options parsing) are testable on their own.
 *
 * A malformed options blob is IGNORED rather than fatal: the user types into that
 * box freely, and a half-finished `{"temp` must never be the reason an AI call
 * fails. Settings surfaces the JSON error inline instead.
 *
 * `tier` is optional and only matters for the Advanced per-call override in
 * Settings: LM Studio has no cost tiers of its own (one loaded model serves
 * every task), but every AI call in the app already resolves to 'lite' /
 * 'balanced' / 'best' before reaching here (see getProviderForTask in
 * main.ts), so `settings.lmstudioPerCallModels` piggybacks on that existing
 * granularity instead of needing a new per-feature identifier plumbed through
 * every call site. Falls back to `lmstudioModel` when no override is set for
 * that tier, same as when `tier` is omitted entirely.
 */
export function resolveLmStudioConfig(settings: any, tier?: 'lite' | 'balanced' | 'best'): LmStudioConfig {
  let options: Record<string, any> = {};
  const rawOpts = settings?.lmstudioOptions;
  if (typeof rawOpts === 'string' && rawOpts.trim()) {
    try {
      const parsed = JSON.parse(rawOpts);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) options = parsed;
    } catch { /* ignored on purpose — see above */ }
  } else if (rawOpts && typeof rawOpts === 'object' && !Array.isArray(rawOpts)) {
    options = rawOpts as Record<string, any>;
  }
  const defaultModel = String(settings?.lmstudioModel ?? '').trim() || LMSTUDIO_DEFAULT_MODEL;
  const perCall = settings?.lmstudioPerCallModels;
  const override = tier && perCall && typeof perCall === 'object' ? String(perCall[tier] ?? '').trim() : '';
  return {
    baseUrl: normalizeLmStudioUrl(settings?.lmstudioBaseUrl),
    model: override || defaultModel,
    options,
    // Defaults ON: opt-out, not opt-in, so tool-capable local models work with no setup.
    sendTools: settings?.lmstudioTools !== false,
  };
}

/**
 * Build a chat-completions request body. User `options` are spread LAST so they
 * override any Warroom default — that's the whole point of the options box.
 */
export function buildLmStudioChatBody(
  cfg: LmStudioConfig,
  args: {
    messages: any[];
    tools?: any[] | null;
    temperature?: number;
    maxTokens?: number;
  },
): string {
  const withTools = !!(args.tools && args.tools.length > 0);
  return JSON.stringify({
    model: cfg.model,
    messages: args.messages,
    ...(withTools ? { tools: args.tools, tool_choice: 'auto' } : {}),
    temperature: args.temperature ?? 0.1,
    max_tokens: args.maxTokens ?? 8192,
    // Warroom reads whole responses rather than streaming them, and LM Studio
    // streams by default in some clients — pin it off explicitly.
    stream: false,
    ...cfg.options,
  });
}

/**
 * Turn an HTTP failure into an error whose message is the text LM Studio actually
 * sent, per CLAUDE.md's rule that the toast shows the provider's real message and
 * never a paraphrase. Only falls back to Warroom-authored copy when the body
 * isn't parseable at all.
 */
export function lmstudioHttpError(status: number, body: string, baseUrl: string): Error {
  let msg: string | undefined;
  try {
    const parsed = JSON.parse(body);
    const err = parsed?.error ?? parsed;
    msg = typeof err === 'string' ? err : err?.message;
  } catch {
    // LM Studio sometimes returns a bare string body rather than JSON.
    if (body && body.trim() && body.length < 300) msg = body.trim();
  }
  if (msg) return new Error(`LM Studio [${status}]: ${msg}`);
  if (status === 404) {
    return new Error(`LM Studio [404]: no model matching that name is loaded at ${baseUrl} — load it in LM Studio, or pick one from "Loaded models" in Settings.`);
  }
  return new Error(`LM Studio request failed (HTTP ${status}) at ${baseUrl}.`);
}

/**
 * Network-level failure. This is by far the most common LM Studio problem (server
 * not started, wrong port), and a bare "fetch failed" tells the user nothing — so
 * the message names the URL it tried and what to actually go do about it.
 */
export function lmstudioConnError(e: any, baseUrl: string): Error {
  const code = e?.cause?.code || e?.code || e?.name || '';
  if (e?.name === 'AbortError' || String(code).includes('Abort')) {
    return new Error(`LM Studio timed out after ${Math.round(LMSTUDIO_TIMEOUT_MS / 1000)}s at ${baseUrl} — the model may be too large for this machine, or is still loading. Try a smaller model (e.g. Gemma 4 E4B).`);
  }
  return new Error(`Can't reach LM Studio at ${baseUrl}${code ? ` (${code})` : ''} — in LM Studio open the Developer tab and click "Start Server", and make sure the port matches the one in Settings.`);
}

/**
 * True when an error body looks like "this model can't do tool calling".
 *
 * Plenty of local models — Gemma among them — don't implement OpenAI-style
 * function calling and reject the `tools` field outright. The agent turn uses this
 * to decide whether retrying WITHOUT tools is worth a shot, so the chat degrades to
 * a plain conversation instead of failing. Kept narrow on purpose: a genuine 400
 * about something else must still surface as itself rather than being retried into
 * a confusing second error.
 */
export function looksLikeToolUnsupported(body: string): boolean {
  return /tool|function[ _-]?call/i.test(String(body ?? ''));
}

/** Parse an OpenAI-compatible `GET /v1/models` payload into a plain id list. */
export function parseLmStudioModels(payload: any): string[] {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((m: any) => String(m?.id ?? '').trim()).filter(Boolean);
}

/** Extract the assistant text from a chat-completions response, or null if absent. */
export function readLmStudioText(payload: any): string | null {
  const text = payload?.choices?.[0]?.message?.content;
  return typeof text === 'string' ? text : null;
}

/** Extract OpenAI-style tool calls, normalised to `{ name, args }`. */
export function readLmStudioToolCalls(payload: any): { name: string; args: Record<string, any> }[] {
  const calls = payload?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.map((tc: any) => ({
    name: String(tc?.function?.name ?? ''),
    args: (() => {
      try { return JSON.parse(tc?.function?.arguments ?? '{}'); } catch { return {}; }
    })(),
  })).filter((c) => c.name);
}

/**
 * Headers for every LM Studio request. LM Studio ignores auth entirely; the bearer
 * token is sent only because reverse proxies people put in front of it often
 * expect the header to exist.
 */
export function lmstudioHeaders(json = true): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'Authorization': 'Bearer lm-studio',
  };
}
