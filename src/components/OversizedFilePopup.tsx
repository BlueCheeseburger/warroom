import React from 'react';
import { formatBytes, MAX_ATTACHMENT_BYTES } from '../lib/fileSizeGate';

interface Props {
  fileName: string;
  sizeBytes: number;
  allowSummarize: boolean;
  summarizing: boolean;
  error?: string;
  onSummarize: () => void;
  onSendNameOnly: () => void;
  onCancel: () => void;
}

export default function OversizedFilePopup({ fileName, sizeBytes, allowSummarize, summarizing, error, onSummarize, onSendNameOnly, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={summarizing ? undefined : onCancel}>
      <div className="rounded-xl p-4" style={{ width: 340, background: 'var(--bg-elevated)', border: '1px solid var(--border-med)', boxShadow: '0 8px 40px rgba(0,0,0,0.28)' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>File too large</div>
        <p className="text-xs mb-1" style={{ color: 'var(--ink)' }}>
          <strong>{fileName}</strong> is {formatBytes(sizeBytes)} — over the {formatBytes(MAX_ATTACHMENT_BYTES)} limit.
        </p>
        <p className="text-xs mb-3 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
          It'll still send, but only the file name will be visible until it's summarized.
        </p>
        {error && <p className="text-xs mb-2" style={{ color: '#ef4444' }}>{error}</p>}
        <div className="flex flex-col gap-1.5">
          {allowSummarize && (
            <button
              className="ai-glow-ring w-full text-xs py-2 rounded-lg"
              style={{ background: 'transparent', border: '1px solid var(--border-side)', color: 'var(--ink)', cursor: summarizing ? 'default' : 'pointer' }}
              onClick={onSummarize}
              disabled={summarizing}
            >
              {summarizing ? 'Summarizing…' : 'Summarize with Warroom AI'}
            </button>
          )}
          <button
            className="w-full text-xs py-2 rounded-lg"
            style={{ background: 'transparent', border: '1px solid var(--border-side)', color: 'var(--ink)', cursor: summarizing ? 'default' : 'pointer' }}
            onClick={onSendNameOnly}
            disabled={summarizing}
          >
            Send name only
          </button>
          <button
            className="w-full text-xs py-1.5"
            style={{ background: 'transparent', border: 'none', color: 'var(--nav-inactive-color)', cursor: summarizing ? 'default' : 'pointer' }}
            onClick={onCancel}
            disabled={summarizing}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
