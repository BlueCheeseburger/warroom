import React from 'react';

// Base style — no underline by default; hover underline via inline onMouseEnter/Leave.
// Color inherits from the parent so links match their context (red in error messages, normal in chat).
const LINK_STYLE: React.CSSProperties = {
  color: 'inherit',
  textDecoration: 'none',
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
};

function openLink(rawUrl: string) {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  window.warroom?.shell?.openExternal(url);
}

/**
 * Splits `text` into an array of strings and <button> link elements.
 * Handles:
 *   - Markdown links:      [label](https://…)
 *   - Protocol URLs:       https://tabroom.com/…  or  http://…
 *   - Bare domains:        tabroom.com/…  aistudio.google.com  opencaselist.com/…
 *
 * Bare domain detection: word boundary + known TLD pattern + optional path.
 * Deliberately conservative to avoid false-positives on normal words.
 */
export function linkifyText(text: string, keyPrefix: string | number = ''): React.ReactNode[] {
  // Guard against pathological backtracking on very long, adversarial strings
  // (chat messages are attacker-controlled). Past ~20k chars we skip link parsing
  // and render the text as-is — far longer than any real URL-bearing message.
  if (text.length > 20000) return [text];

  const pattern = new RegExp(
    // 1) Markdown link: [label](url)
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.source +
    '|' +
    // 2) Protocol URL: http(s)://…
    /https?:\/\/[^\s<>"')\],;]+/.source +
    '|' +
    // 3) Bare domain: e.g. tabroom.com, aistudio.google.com/path
    //    Must start at a word boundary (not preceded by @, /, letters that would be part of a word)
    /(?<![/@\w])(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|org|net|edu|gov|io|ai|co|us|uk|app|dev)[^\s<>"')\],;]*/.source,
    'g'
  );

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    let displayText: string;
    let url: string;

    if (match[1] && match[2]) {
      // Markdown link
      displayText = match[1];
      url = match[2];
    } else {
      displayText = match[0];
      url = match[0];
    }

    nodes.push(
      <button
        key={`${keyPrefix}-link-${match.index}`}
        style={LINK_STYLE}
        onClick={() => openLink(url)}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'underline'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'none'; }}
      >
        {displayText}
      </button>
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length ? nodes : [text];
}
