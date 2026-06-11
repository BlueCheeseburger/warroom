// ─── Chat encryption ────────────────────────────────────────────────────────
//
// All chat content (message text + attachment data) is encrypted client-side
// before it is sent to Supabase, and decrypted client-side after it is read, so
// the message/attachment tables hold only ciphertext.
//
// THREAT MODEL — read this before trusting it with anything truly sensitive.
// The team key is derived from the team's invite code (see below), and the invite
// code is itself stored server-side in the `teams` table (it has to be: the server
// matches on it at join time) and is handed to every member's client. So this is
// NOT end-to-end / zero-knowledge encryption:
//   • It DOES protect message/attachment content if only those rows leak — e.g. an
//     over-broad RLS SELECT on `messages`, or a partial dump that excludes `teams`.
//   • It does NOT protect against a full database compromise or a malicious
//     operator: anyone who can also read `teams.invite_code` can re-derive every
//     team key and decrypt everything. Treat it as defense-in-depth over RLS, not
//     as a guarantee that the operator can't read your messages.
//
// Key model
// ─────────
// Every team has a single symmetric AES-GCM key, used for BOTH room messages and
// DM messages within that team. The key is *derived* on the client from the team's
// invite code via PBKDF2, salted with the stable team id:
//
//     key = PBKDF2(invite_code, salt = "warroom-chat-v1:" + teamId)
//
// Any member who can join the team already knows the invite code, so every member
// can derive the exact same key with zero key-distribution handshake. The invite
// code is never rotated, so the key is stable for the life of the team and old
// messages stay readable forever. The derived key itself is never transmitted —
// but, as noted above, its input (the invite code) lives server-side.
//
// Wire format
// ───────────
// Encrypted strings are tagged with a version prefix so we can tell ciphertext
// from legacy plaintext (messages sent before encryption shipped) and decrypt
// transparently:
//
//     wre1:<base64(iv)>.<base64(ciphertext)>
//
// Anything that does not start with the prefix is returned as-is.

const PREFIX = 'wre1:';
const KDF_ITERATIONS = 200_000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Cache derived keys so we don't run PBKDF2 (intentionally slow) on every message.
const keyCache = new Map<string, Promise<CryptoKey>>();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Returns an ArrayBuffer (not the typed-array view) so it satisfies BufferSource
// cleanly across DOM lib versions that distinguish ArrayBuffer from ArrayBufferLike.
function bytesFromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function bytesFromText(text: string): ArrayBuffer {
  const view = textEncoder.encode(text);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

async function deriveKey(teamId: string, inviteCode: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(inviteCode),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: textEncoder.encode('warroom-chat-v1:' + teamId),
      iterations: KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Get (and cache) the AES-GCM key for a team. */
export function getTeamKey(teamId: string, inviteCode: string): Promise<CryptoKey> {
  const cacheKey = teamId + '|' + inviteCode;
  let p = keyCache.get(cacheKey);
  if (!p) {
    p = deriveKey(teamId, inviteCode);
    keyCache.set(cacheKey, p);
  }
  return p;
}

/** Encrypt a string. Returns the tagged wire format. */
export async function encryptText(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    bytesFromText(plaintext ?? ''),
  );
  return PREFIX + toBase64(iv) + '.' + toBase64(new Uint8Array(ct));
}

/**
 * Decrypt a wire-format string. Plaintext / legacy values (no prefix) are passed
 * through unchanged. A genuine decryption failure (wrong key, corruption) returns
 * a visible placeholder rather than throwing, so one bad row can't blank the UI.
 */
export async function decryptText(key: CryptoKey, payload: unknown): Promise<string> {
  if (typeof payload !== 'string') return (payload as any) ?? '';
  if (!payload.startsWith(PREFIX)) return payload; // legacy plaintext
  try {
    const [ivB64, ctB64] = payload.slice(PREFIX.length).split('.');
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytesFromBase64(ivB64) },
      key,
      bytesFromBase64(ctB64),
    );
    return textDecoder.decode(pt);
  } catch {
    return '🔒 [unable to decrypt]';
  }
}

/** Encrypt an attachment's `data` object into an opaque envelope. */
export async function encryptAttachmentData(key: CryptoKey, data: any): Promise<{ _enc: string }> {
  const json = JSON.stringify(data ?? {});
  return { _enc: await encryptText(key, json) };
}

/** Decrypt an attachment `data` envelope back into its original object. */
export async function decryptAttachmentData(key: CryptoKey, data: any): Promise<any> {
  if (data && typeof data === 'object' && typeof data._enc === 'string') {
    const json = await decryptText(key, data._enc);
    try { return JSON.parse(json); } catch { return {}; }
  }
  return data ?? {}; // legacy plaintext attachment
}

// ─── Whole-message helpers ───────────────────────────────────────────────────

interface OutgoingAttachment { id?: string; type: string; name: string; data: any; permission?: string }

/** Encrypt a message's content + every attachment's data, ready to send. */
export async function encryptOutgoing(
  key: CryptoKey,
  content: string,
  attachments: OutgoingAttachment[] = [],
): Promise<{ content: string; attachments: OutgoingAttachment[] }> {
  const [encContent, encAtts] = await Promise.all([
    encryptText(key, content),
    Promise.all(
      attachments.map(async (a) => ({ ...a, data: await encryptAttachmentData(key, a.data) })),
    ),
  ]);
  return { content: encContent, attachments: encAtts };
}

/** Decrypt a message row (content + attachments) coming back from Supabase. */
export async function decryptMessage<T extends { content?: string; attachments?: any[] }>(
  key: CryptoKey,
  msg: T,
): Promise<T> {
  const [content, attachments] = await Promise.all([
    decryptText(key, msg.content),
    Promise.all(
      (msg.attachments ?? []).map(async (a) => ({ ...a, data: await decryptAttachmentData(key, a.data) })),
    ),
  ]);
  return { ...msg, content, attachments };
}
