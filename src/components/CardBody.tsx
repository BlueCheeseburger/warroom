import React from 'react';
import { CardRun, CardImage } from '../types';
import { HIGHLIGHT_CSS } from '../utils/cardFormat';

// Renders a formatted card body (underline / highlight / small text) read-only.
// Used anywhere a card with bodyRuns is displayed.
export function FormattedBody({ runs, className }: { runs: CardRun[]; className?: string }) {
  return (
    <div className={`whitespace-pre-wrap leading-relaxed ${className ?? ''}`}>
      {runs.map((r, i) => {
        const style: React.CSSProperties = {};
        if (r.highlight) style.backgroundColor = HIGHLIGHT_CSS[r.highlight];
        if (r.underline) style.textDecoration = 'underline';
        if (r.small) { style.fontSize = '0.78em'; style.opacity = 0.6; }
        return (
          <span key={i} style={style}>{r.text}</span>
        );
      })}
    </div>
  );
}

// Thumbnails for images attached to a card.
export function CardImages({ images, className }: { images: CardImage[]; className?: string }) {
  if (!images?.length) return null;
  return (
    <div className={`flex flex-wrap gap-2 mt-2 ${className ?? ''}`}>
      {images.map((img, i) => (
        <img
          key={i}
          src={img.src}
          alt={img.alt || ''}
          title={img.alt || ''}
          className="max-h-28 rounded-sm border border-line object-contain bg-white"
        />
      ))}
    </div>
  );
}
