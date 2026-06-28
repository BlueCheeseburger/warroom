import React, { useEffect, useRef } from 'react';
import { CardRun, CardImage } from '../types';
import { HIGHLIGHT_CSS } from '../utils/cardFormat';
import { applyDarkModeViewerFixes, removeDarkModeViewerFixes } from '../utils/docxViewerUtils';

// Renders a formatted card body (underline / highlight / small text) read-only.
// Uses the same dark-mode highlight-readability logic as the docx viewer so
// highlight colors stay readable in every theme.
export function FormattedBody({ runs, className }: { runs: CardRun[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // Mirror SpeechDocViewer's approach: watch the <html> dark class and apply /
  // remove the same highlight-dimming DOM walk on every theme change.
  useEffect(() => {
    if (!ref.current) return;

    function applyTheme() {
      if (!ref.current) return;
      const isDark = document.documentElement.classList.contains('dark');
      if (isDark) {
        applyDarkModeViewerFixes(ref.current);
      } else {
        removeDarkModeViewerFixes(ref.current);
      }
    }

    applyTheme();

    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  // Re-run whenever the runs change so newly rendered spans get the treatment too.
  }, [runs]);

  return (
    <div ref={ref} className={`whitespace-pre-wrap leading-relaxed ${className ?? ''}`}>
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
