import React from 'react';

// Shared avatar for anything representing a team room, a 1:1 DM, or a group DM.
// Shape carries the category (people vs. team), color carries identity —
// team rooms are always the app accent so they never collide with a person's
// random-but-stable palette color.
//
//   team  -> rounded square, accent background, team initials
//   dm    -> circle, one color from PERSON_PALETTE (hashed from the user id), initials
//   group -> circle split into up to 4 quadrants, one per the first 4 joined
//            members, each on its own palette color with a single initial

// Mid-saturation, mid-lightness colors chosen to stay legible (white text on
// top) against every theme's --bg-main, from the palest (cream) to darkest
// (near-black) themes shipped in index.css.
const PERSON_PALETTE = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6'];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function paletteColorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PERSON_PALETTE[hash % PERSON_PALETTE.length];
}

export type AvatarSpec =
  | { kind: 'team'; name: string }
  | { kind: 'dm'; id: string; name: string }
  | { kind: 'group'; members: { id: string; name: string }[] };

export function ChatAvatar({ spec, size = 28, title }: { spec: AvatarSpec; size?: number; title?: string }) {
  const fontSize = Math.max(9, Math.round(size * 0.38));

  if (spec.kind === 'team') {
    return (
      <div title={title} className="flex items-center justify-center font-bold shrink-0"
        style={{ width: size, height: size, borderRadius: size * 0.28, background: 'var(--accent)', color: '#fff', fontSize }}>
        {initialsOf(spec.name)}
      </div>
    );
  }

  if (spec.kind === 'dm') {
    return (
      <div title={title} className="flex items-center justify-center font-bold shrink-0"
        style={{ width: size, height: size, borderRadius: '50%', background: paletteColorFor(spec.id), color: '#fff', fontSize }}>
        {initialsOf(spec.name)}
      </div>
    );
  }

  // group — up to 4 quadrants, first joined members
  const quads = spec.members.slice(0, 4);
  while (quads.length < 4) quads.push(quads[quads.length - 1] ?? { id: 'x', name: '?' });
  const quadFontSize = Math.max(7, Math.round(size * 0.24));
  return (
    <div title={title} className="grid shrink-0 overflow-hidden"
      style={{ width: size, height: size, borderRadius: '50%', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }}>
      {quads.map((m, i) => (
        <div key={i} className="flex items-center justify-center font-bold"
          style={{ background: paletteColorFor(m.id), color: '#fff', fontSize: quadFontSize }}>
          {initialsOf(m.name)[0]}
        </div>
      ))}
    </div>
  );
}
