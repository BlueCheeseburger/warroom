// Exercises the LM Studio provider (electron/lmstudio.ts) — config resolution,
// URL normalisation, request-body construction, response/error parsing — and then
// runs the real request bodies against a MOCK OpenAI-compatible server on a
// throwaway port. No Electron, no LM Studio install, no user data touched.
//
// Run:  npx tsx scripts/test-lmstudio.ts

import http from 'http';
import type { AddressInfo } from 'net';
import {
  LMSTUDIO_DEFAULT_BASE_URL, LMSTUDIO_DEFAULT_MODEL,
  normalizeLmStudioUrl, resolveLmStudioConfig, buildLmStudioChatBody,
  lmstudioHttpError, lmstudioConnError, looksLikeToolUnsupported,
  parseLmStudioModels, readLmStudioText, readLmStudioToolCalls, lmstudioHeaders,
} from '../electron/lmstudio';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  →  ' + extra : ''}`); }
}
function eq(name: string, actual: any, expected: any) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, want ${e}`);
}

// ── URL normalisation ────────────────────────────────────────────────────────
console.log('\nnormalizeLmStudioUrl');
eq('empty → default', normalizeLmStudioUrl(''), LMSTUDIO_DEFAULT_BASE_URL);
eq('undefined → default', normalizeLmStudioUrl(undefined), LMSTUDIO_DEFAULT_BASE_URL);
eq('bare host gains /v1', normalizeLmStudioUrl('http://localhost:1234'), 'http://localhost:1234/v1');
eq('already has /v1 (not doubled)', normalizeLmStudioUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1');
eq('trailing slash', normalizeLmStudioUrl('http://localhost:1234/'), 'http://localhost:1234/v1');
eq('trailing slash after /v1', normalizeLmStudioUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1');
eq('surrounding whitespace', normalizeLmStudioUrl('  http://localhost:1234  '), 'http://localhost:1234/v1');
eq('custom port', normalizeLmStudioUrl('http://127.0.0.1:5000'), 'http://127.0.0.1:5000/v1');
eq('LAN host', normalizeLmStudioUrl('http://192.168.1.50:1234/v1'), 'http://192.168.1.50:1234/v1');
eq('uppercase /V1 still not doubled', normalizeLmStudioUrl('http://localhost:1234/V1'), 'http://localhost:1234/v1');

// ── Config resolution ────────────────────────────────────────────────────────
console.log('\nresolveLmStudioConfig');
{
  const c = resolveLmStudioConfig(null);
  eq('null settings → defaults', [c.baseUrl, c.model, c.options, c.sendTools],
    [LMSTUDIO_DEFAULT_BASE_URL, LMSTUDIO_DEFAULT_MODEL, {}, true]);
}
{
  const c = resolveLmStudioConfig({});
  eq('empty settings → defaults', [c.baseUrl, c.model], [LMSTUDIO_DEFAULT_BASE_URL, LMSTUDIO_DEFAULT_MODEL]);
  check('default model is Gemma 4 12B', c.model === 'google/gemma-4-12b', c.model);
}
{
  const c = resolveLmStudioConfig({ lmstudioModel: '   ' });
  eq('blank model falls back to default', c.model, LMSTUDIO_DEFAULT_MODEL);
}
{
  const c = resolveLmStudioConfig({ lmstudioModel: '  my/custom-model  ' });
  eq('custom model trimmed', c.model, 'my/custom-model');
}
{
  const s = { lmstudioModel: 'default-model', lmstudioPerCallModels: { lite: 'lite-model', best: '  spaced-model  ' } };
  eq('per-call override for tier', resolveLmStudioConfig(s, 'lite').model, 'lite-model');
  eq('per-call override trimmed', resolveLmStudioConfig(s, 'best').model, 'spaced-model');
  eq('no tier passed falls back to default', resolveLmStudioConfig(s).model, 'default-model');
  eq('blank override falls back through chain to default', resolveLmStudioConfig({ lmstudioModel: 'default-model', lmstudioPerCallModels: { lite: '   ' } }, 'lite').model, 'default-model');
}
{
  // Tier fallback chain: best -> balanced -> lite; balanced -> lite; lite -> balanced (its one exception).
  eq('balanced missing borrows lite',
    resolveLmStudioConfig({ lmstudioModel: 'default', lmstudioPerCallModels: { lite: 'lite-model' } }, 'balanced').model,
    'lite-model');
  eq('best missing borrows balanced first',
    resolveLmStudioConfig({ lmstudioModel: 'default', lmstudioPerCallModels: { balanced: 'balanced-model', lite: 'lite-model' } }, 'best').model,
    'balanced-model');
  eq('best falls through balanced to lite when balanced unset',
    resolveLmStudioConfig({ lmstudioModel: 'default', lmstudioPerCallModels: { lite: 'lite-model' } }, 'best').model,
    'lite-model');
  eq('lite missing borrows balanced (no tier below lite)',
    resolveLmStudioConfig({ lmstudioModel: 'default', lmstudioPerCallModels: { balanced: 'balanced-model' } }, 'lite').model,
    'balanced-model');
  eq('lite missing does NOT fall to best (only borrows balanced)',
    resolveLmStudioConfig({ lmstudioModel: 'default', lmstudioPerCallModels: { best: 'best-model' } }, 'lite').model,
    'default');
  eq('own tier always wins over the fallback chain',
    resolveLmStudioConfig({ lmstudioModel: 'default', lmstudioPerCallModels: { best: 'best-model', balanced: 'balanced-model', lite: 'lite-model' } }, 'best').model,
    'best-model');
  eq('empty chain falls all the way to default model',
    resolveLmStudioConfig({ lmstudioModel: 'default', lmstudioPerCallModels: {} }, 'best').model,
    'default');
}
{
  const c = resolveLmStudioConfig({ lmstudioOptions: '{"temperature":0.7,"ttl":60}' });
  eq('options parsed from JSON string', c.options, { temperature: 0.7, ttl: 60 });
}
{
  const c = resolveLmStudioConfig({ lmstudioOptions: '{"temperature": ' });
  eq('malformed options ignored, not fatal', c.options, {});
}
{
  const c = resolveLmStudioConfig({ lmstudioOptions: '[1,2,3]' });
  eq('JSON array rejected (must be object)', c.options, {});
}
{
  const c = resolveLmStudioConfig({ lmstudioOptions: '"just a string"' });
  eq('JSON string rejected', c.options, {});
}
{
  const c = resolveLmStudioConfig({ lmstudioOptions: { temperature: 0.2 } });
  eq('options accepted as a real object too', c.options, { temperature: 0.2 });
}
{
  eq('tools default ON', resolveLmStudioConfig({}).sendTools, true);
  eq('tools explicit false → OFF', resolveLmStudioConfig({ lmstudioTools: false }).sendTools, false);
  eq('tools explicit true → ON', resolveLmStudioConfig({ lmstudioTools: true }).sendTools, true);
  eq('tools undefined → ON', resolveLmStudioConfig({ lmstudioTools: undefined }).sendTools, true);
}

// ── Request body ─────────────────────────────────────────────────────────────
console.log('\nbuildLmStudioChatBody');
{
  const cfg = resolveLmStudioConfig({});
  const body = JSON.parse(buildLmStudioChatBody(cfg, { messages: [{ role: 'user', content: 'hi' }] }));
  eq('model set', body.model, LMSTUDIO_DEFAULT_MODEL);
  eq('messages passed through', body.messages, [{ role: 'user', content: 'hi' }]);
  eq('stream pinned off', body.stream, false);
  eq('default temperature', body.temperature, 0.1);
  eq('default max_tokens', body.max_tokens, 8192);
  check('no tools key when none given', !('tools' in body));
  check('no tool_choice when no tools', !('tool_choice' in body));
}
{
  const cfg = resolveLmStudioConfig({});
  const tools = [{ type: 'function', function: { name: 'search', parameters: {} } }];
  const body = JSON.parse(buildLmStudioChatBody(cfg, { messages: [], tools }));
  eq('tools included', body.tools, tools);
  eq('tool_choice auto', body.tool_choice, 'auto');
}
{
  const cfg = resolveLmStudioConfig({});
  const body = JSON.parse(buildLmStudioChatBody(cfg, { messages: [], tools: [] }));
  check('empty tools array omits the key', !('tools' in body));
}
{
  // The whole point of the options box: user values must win over Warroom defaults.
  const cfg = resolveLmStudioConfig({ lmstudioOptions: '{"temperature":0.9,"max_tokens":100,"top_p":0.5}' });
  const body = JSON.parse(buildLmStudioChatBody(cfg, { messages: [], temperature: 0.1, maxTokens: 8192 }));
  eq('user temperature overrides default', body.temperature, 0.9);
  eq('user max_tokens overrides default', body.max_tokens, 100);
  eq('extra user param passed through', body.top_p, 0.5);
}
{
  const cfg = resolveLmStudioConfig({ lmstudioOptions: '{"ttl":3600}' });
  const body = JSON.parse(buildLmStudioChatBody(cfg, { messages: [] }));
  eq('ttl (auto-unload) passed through', body.ttl, 3600);
}

// ── Error mapping ────────────────────────────────────────────────────────────
console.log('\nlmstudioHttpError');
check('OpenAI-shaped error uses provider text verbatim',
  lmstudioHttpError(400, JSON.stringify({ error: { message: 'Model does not support tools' } }), 'u')
    .message === 'LM Studio [400]: Model does not support tools');
check('bare-string error field',
  lmstudioHttpError(404, JSON.stringify({ error: 'No models loaded' }), 'u')
    .message === 'LM Studio [404]: No models loaded');
check('top-level message field',
  lmstudioHttpError(500, JSON.stringify({ message: 'kaboom' }), 'u')
    .message === 'LM Studio [500]: kaboom');
check('non-JSON body used as the message',
  lmstudioHttpError(502, 'Bad Gateway', 'u').message === 'LM Studio [502]: Bad Gateway');
check('404 with empty body names the URL and the fix',
  /no model matching/.test(lmstudioHttpError(404, '', 'http://x/v1').message)
  && lmstudioHttpError(404, '', 'http://x/v1').message.includes('http://x/v1'));
check('unknown status with empty body still names the URL',
  lmstudioHttpError(418, '', 'http://x/v1').message.includes('http://x/v1'));
check('huge non-JSON body is not dumped into the message',
  !lmstudioHttpError(500, 'x'.repeat(5000), 'http://x/v1').message.includes('xxxxxxxxxx'));

console.log('\nlmstudioConnError');
check('ECONNREFUSED tells the user to start the server',
  (() => {
    const m = lmstudioConnError({ cause: { code: 'ECONNREFUSED' } }, 'http://localhost:1234/v1').message;
    return m.includes('Start Server') && m.includes('http://localhost:1234/v1') && m.includes('ECONNREFUSED');
  })());
check('AbortError is reported as a timeout, not unreachable',
  (() => {
    const m = lmstudioConnError({ name: 'AbortError' }, 'http://x/v1').message;
    return m.includes('timed out') && !m.includes('Start Server');
  })());
check('timeout message suggests a smaller model',
  lmstudioConnError({ name: 'AbortError' }, 'http://x/v1').message.includes('E4B'));
check('unknown error still produces actionable copy',
  lmstudioConnError({}, 'http://x/v1').message.includes('Start Server'));

console.log('\nlooksLikeToolUnsupported');
check('"does not support tools"', looksLikeToolUnsupported('Model does not support tools'));
check('"function calling not supported"', looksLikeToolUnsupported('function calling is not supported'));
check('"tool_calls" mention', looksLikeToolUnsupported('{"error":"invalid tool_calls"}'));
check('unrelated 400 is NOT treated as a tools problem',
  !looksLikeToolUnsupported('context length exceeded'));
check('empty body is not a tools problem', !looksLikeToolUnsupported(''));

// ── Response parsing ─────────────────────────────────────────────────────────
console.log('\nresponse parsing');
eq('parseLmStudioModels', parseLmStudioModels({ data: [{ id: 'a' }, { id: ' b ' }, { id: '' }, {}] }), ['a', 'b']);
eq('parseLmStudioModels on garbage', parseLmStudioModels({}), []);
eq('parseLmStudioModels on null', parseLmStudioModels(null), []);
eq('readLmStudioText', readLmStudioText({ choices: [{ message: { content: 'hello' } }] }), 'hello');
eq('readLmStudioText empty string is valid', readLmStudioText({ choices: [{ message: { content: '' } }] }), '');
eq('readLmStudioText missing → null', readLmStudioText({ choices: [{ message: {} }] }), null);
eq('readLmStudioText no choices → null', readLmStudioText({}), null);
eq('readLmStudioToolCalls',
  readLmStudioToolCalls({ choices: [{ message: { tool_calls: [{ function: { name: 'f', arguments: '{"a":1}' } }] } }] }),
  [{ name: 'f', args: { a: 1 } }]);
eq('readLmStudioToolCalls with bad JSON args → {}',
  readLmStudioToolCalls({ choices: [{ message: { tool_calls: [{ function: { name: 'f', arguments: 'not json' } }] } }] }),
  [{ name: 'f', args: {} }]);
eq('readLmStudioToolCalls drops nameless calls',
  readLmStudioToolCalls({ choices: [{ message: { tool_calls: [{ function: { arguments: '{}' } }] } }] }), []);
eq('readLmStudioToolCalls none → []', readLmStudioToolCalls({ choices: [{ message: {} }] }), []);
check('headers carry JSON + bearer', lmstudioHeaders()['Content-Type'] === 'application/json'
  && lmstudioHeaders()['Authorization'] === 'Bearer lm-studio');
check('headers can omit Content-Type for GET', !('Content-Type' in lmstudioHeaders(false)));

// ── Live round-trip against a mock OpenAI-compatible server ──────────────────
(async () => {
  console.log('\nlive round-trip (mock server)');

  /** Records what the client actually sent, and replies however the test wants. */
  let lastBody: any = null;
  let lastPath = '';
  let mode: 'ok' | 'tool' | 'reject-tools' | 'err404' = 'ok';

  const server = http.createServer((req, res) => {
    lastPath = req.url ?? '';
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (lastPath.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'google/gemma-4-12b' }, { id: 'google/gemma-4-e4b' }] }));
        return;
      }
      try { lastBody = JSON.parse(raw); } catch { lastBody = null; }
      if (mode === 'err404') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Model "nope" not found' }));
        return;
      }
      if (mode === 'reject-tools') {
        if (lastBody?.tools) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Model does not support tools' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'google/gemma-4-12b', choices: [{ message: { role: 'assistant', content: 'answered without tools' } }] }));
        return;
      }
      if (mode === 'tool') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_warroom', arguments: '{"query":"nukes"}' } }] } }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'google/gemma-4-12b', choices: [{ message: { role: 'assistant', content: 'ready' } }] }));
    });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = normalizeLmStudioUrl(`http://127.0.0.1:${port}`);
  const cfg = resolveLmStudioConfig({ lmstudioBaseUrl: `http://127.0.0.1:${port}`, lmstudioOptions: '{"ttl":120}' });

  const post = (body: string) => fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST', headers: lmstudioHeaders(), body,
  });

  try {
    // 1. Plain completion — the shape callLMStudio uses.
    {
      const res = await post(buildLmStudioChatBody(cfg, { messages: [{ role: 'user', content: 'say ready' }] }));
      check('chat completion returns 200', res.ok, String(res.status));
      eq('assistant text read back', readLmStudioText(await res.json()), 'ready');
      eq('server saw the configured model', lastBody?.model, 'google/gemma-4-12b');
      eq('server saw stream:false', lastBody?.stream, false);
      eq('server saw the user ttl option', lastBody?.ttl, 120);
      check('posted to /v1/chat/completions', lastPath === '/v1/chat/completions', lastPath);
    }

    // 2. Model listing — what the Settings "Loaded models" button does.
    {
      const res = await fetch(`${baseUrl}/models`, { headers: lmstudioHeaders(false) });
      check('models endpoint returns 200', res.ok);
      eq('model ids parsed', parseLmStudioModels(await res.json()), ['google/gemma-4-12b', 'google/gemma-4-e4b']);
    }

    // 3. Tool calls come back parsed.
    {
      mode = 'tool';
      const res = await post(buildLmStudioChatBody(cfg, {
        messages: [{ role: 'user', content: 'find cards' }],
        tools: [{ type: 'function', function: { name: 'search_warroom', parameters: {} } }],
      }));
      eq('tool call parsed', readLmStudioToolCalls(await res.json()),
        [{ name: 'search_warroom', args: { query: 'nukes' } }]);
      check('server received the tools array', Array.isArray(lastBody?.tools));
    }

    // 4. The Gemma case: model rejects `tools`, so the agent retries without them.
    {
      mode = 'reject-tools';
      const tools = [{ type: 'function', function: { name: 'search_warroom', parameters: {} } }];
      let res = await post(buildLmStudioChatBody(cfg, { messages: [], tools }));
      check('tools request is rejected 400', res.status === 400, String(res.status));
      const errBody = await res.text();
      check('rejection is recognised as a tools problem', looksLikeToolUnsupported(errBody), errBody);
      res = await post(buildLmStudioChatBody(cfg, { messages: [], tools: null }));
      check('retry without tools succeeds', res.ok, String(res.status));
      eq('fallback answer returned', readLmStudioText(await res.json()), 'answered without tools');
    }

    // 5. A real 404 surfaces the server's own wording.
    {
      mode = 'err404';
      const res = await post(buildLmStudioChatBody(cfg, { messages: [] }));
      const err = lmstudioHttpError(res.status, await res.text(), cfg.baseUrl);
      check('404 message is the provider text verbatim',
        err.message === 'LM Studio [404]: Model "nope" not found', err.message);
      check('404 body is NOT mistaken for a tools problem',
        !looksLikeToolUnsupported('Model "nope" not found'));
    }
  } finally {
    server.close();
  }

  // 6. Nothing listening → the "start the server" message, via the real fetch failure.
  {
    // Port 1 is privileged and never has an LM Studio on it.
    const dead = normalizeLmStudioUrl('http://127.0.0.1:1');
    try {
      await fetch(`${dead}/chat/completions`, { method: 'POST', headers: lmstudioHeaders(), body: '{}' });
      check('unreachable server throws', false, 'fetch unexpectedly succeeded');
    } catch (e) {
      const msg = lmstudioConnError(e, dead).message;
      check('unreachable → "Start Server" guidance', msg.includes('Start Server'), msg);
      check('unreachable message names the URL', msg.includes(dead), msg);
    }
  }

  // 7. Abort maps to the timeout message (not "unreachable").
  {
    const ac = new AbortController();
    ac.abort();
    try {
      await fetch('http://127.0.0.1:1/v1/models', { signal: ac.signal });
      check('aborted fetch throws', false);
    } catch (e) {
      check('abort → timeout guidance', lmstudioConnError(e, 'http://x/v1').message.includes('timed out'));
    }
  }

  // 8. Regression: the Settings buttons must never fail silently.
  //    The original bug was `window.warroom?.lmstudio.test()` — the `?.` guards
  //    `window.warroom` but NOT `.lmstudio`, so on an app instance whose preload
  //    predates this provider the call threw a TypeError that a bare try/finally
  //    swallowed, leaving the button looking completely dead.
  console.log('\nbridge-missing guard (Settings regression)');
  {
    const withBridge: any = { lmstudio: { test: () => {}, listModels: () => {} } };
    const noNamespace: any = {};
    const partial: any = { lmstudio: { listModels: () => {} } }; // test() missing
    const lmBridge = (w: any) => {
      const b = w?.lmstudio;
      return (b?.test && b?.listModels) ? b : null;
    };
    check('bridge present → usable', lmBridge(withBridge) !== null);
    check('namespace missing → null, not a throw', lmBridge(noNamespace) === null);
    check('undefined window → null, not a throw', lmBridge(undefined) === null);
    check('partial bridge → null (would have thrown on .test())', lmBridge(partial) === null);
    // Prove the OLD pattern is what threw, so this test documents the actual defect.
    let threw = false;
    try { (noNamespace?.lmstudio as any).test(); } catch { threw = true; }
    check('old `w?.lmstudio.test()` pattern does throw (the bug)', threw);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
