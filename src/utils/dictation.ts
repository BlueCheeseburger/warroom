// Shared dictation transcription helper — used by GeminiPanel.tsx and both
// Chat.tsx composers (team room + DM), which otherwise each duplicated this
// same base64-encode-and-invoke block.
//
// Two paths:
//  - Cloud (Gemini/OpenAI, chosen via Settings → AI): the raw recorded blob
//    (webm/opus) is sent as-is — both providers accept it directly.
//  - Offline (Beta, Settings → General): decoded and resampled to 16kHz mono
//    Float32 PCM via the Web Audio API *here in the renderer*, since the
//    main process has no audio-codec decoding of its own. That's the one
//    format the local Whisper pipeline in electron/offlineWhisper.ts accepts
//    without needing anything beyond a raw byte reinterpretation on the
//    other end.

async function decodeToFloat32Mono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer();
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuf);
  } finally {
    ctx.close();
  }
  const targetRate = 16000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * targetRate)), targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  // Destination has 1 channel, so a multi-channel source is mixed down to
  // mono automatically by the Web Audio API's own channel-summing rules.
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(bin);
  });
}

/** Transcribes a recorded audio blob, routing through whichever dictation
 *  path the user has configured. Returns null on any failure (matching the
 *  three call sites' prior best-effort `catch {}` behavior) rather than
 *  throwing — dictation failing shouldn't interrupt whatever the user was
 *  doing in the composer. */
export async function transcribeRecording(blob: Blob, recorderMimeType: string): Promise<string | null> {
  const w = window.warroom as any;
  if (!w?.dictation?.transcribe) return null;

  let useOffline = false;
  try {
    const s = await w.storage.read('app_settings');
    useOffline = !!s?.dictationUseOffline;
  } catch { /* best effort */ }

  try {
    if (useOffline) {
      const pcm = await decodeToFloat32Mono16k(blob);
      const b64 = float32ToBase64(pcm);
      const res = await w.dictation.transcribe(b64, 'audio/pcm-f32-16k', true);
      return res?.ok && typeof res.data === 'string' ? res.data.trim() : null;
    }
    const b64 = await blobToBase64(blob);
    const mime = recorderMimeType.split(';')[0] || 'audio/webm';
    const res = await w.dictation.transcribe(b64, mime, false);
    return res?.ok && typeof res.data === 'string' ? res.data.trim() : null;
  } catch {
    return null;
  }
}
