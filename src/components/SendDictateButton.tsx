import React from 'react';

// Single icon-only button that fills the composer's "send slot": a dictation
// mic when the box is empty, swapping to a send icon once there's content to
// send — instead of two separate always-visible buttons. Shared by team chat,
// DMs, and Warroom AI so all three composers behave and animate identically;
// only the filled (has-content) color differs — solid accent for chat,
// blue/pink gradient + a small spark for Warroom AI.

function MicIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function SendIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 11.5L21 3l-6.5 18-3.2-7.3L3 11.5z" />
    </svg>
  );
}

function SparkBadge() {
  return (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="#fff"
      style={{ position: 'absolute', bottom: -1, right: -1, filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.4))' }}>
      <path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
    </svg>
  );
}

export default function SendDictateButton({
  hasContent, sending, isRecording, dictationStatus,
  onSend, onStartDictation, onStopDictation, variant = 'solid', size = 28,
}: {
  hasContent: boolean;
  sending: boolean;
  isRecording: boolean;
  dictationStatus: 'idle' | 'transcribing';
  onSend: () => void;
  onStartDictation: () => void;
  onStopDictation: () => void;
  variant?: 'solid' | 'gradient';
  size?: number;
}) {
  const showSend = hasContent && !isRecording;
  const transcribing = dictationStatus === 'transcribing';

  return (
    <button
      title={showSend ? 'Send (Enter)' : isRecording ? 'Stop dictation' : transcribing ? 'Transcribing…' : 'Dictate'}
      onMouseDown={(e) => { if (!showSend) e.preventDefault(); }}
      onClick={showSend ? onSend : isRecording ? onStopDictation : transcribing ? undefined : onStartDictation}
      disabled={sending || transcribing}
      className="relative flex items-center justify-center rounded-full transition shrink-0"
      style={{
        width: size, height: size,
        background: showSend
          ? (variant === 'gradient' ? 'linear-gradient(135deg,#3b82f6,#ec4899)' : 'var(--item-selected-bg)')
          : isRecording ? 'rgba(239,68,68,0.12)' : 'transparent',
        border: showSend ? 'none' : isRecording ? '1.5px solid #ef4444' : '1.5px solid var(--border-side)',
        color: showSend ? '#fff' : isRecording ? '#ef4444' : transcribing ? '#4285F4' : 'var(--nav-inactive-color)',
        cursor: sending || transcribing ? 'default' : 'pointer',
        opacity: sending ? 0.6 : 1,
        animation: isRecording || transcribing ? 'mic-pulse 1.2s ease-in-out infinite' : undefined,
      }}
      onMouseEnter={(e) => { if (!showSend && !isRecording && !transcribing) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
      onMouseLeave={(e) => { if (!showSend && !isRecording && !transcribing) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <style>{`@keyframes mic-pulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
      {showSend ? <SendIcon /> : <MicIcon />}
      {showSend && variant === 'gradient' && <SparkBadge />}
    </button>
  );
}
