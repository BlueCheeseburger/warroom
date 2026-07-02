import React, { useId } from 'react';

// A photorealistic minted coin: radial metal gradient (light source upper-left),
// a beveled rim with a reeded-edge ring, an engraved letter with offset
// light/dark copies for a relief effect, and a soft specular highlight.
// Rendered as SVG — safe to animate with CSS 3D transforms (rotateY flip)
// since it never mutates during the transform, only its parent's rotation does.

interface Palette {
  field: [string, string, string, string, string, string]; // radial gradient stops, light -> dark
  rim: [string, string, string];                            // linear gradient stops, light -> dark
  highlight: string;
  shadow: string;
  groove: string;
}

const PALETTES: Record<'heads' | 'tails', Palette> = {
  heads: {
    field: ['#fff8e1', '#ffe9a8', '#f6cd58', '#e0a935', '#b8791e', '#7a4f10'],
    rim: ['#fff3c4', '#c98a1f', '#6b4508'],
    highlight: '#fffaf0',
    shadow: '#5c3a08',
    groove: '#8a5c14',
  },
  tails: {
    field: ['#ffffff', '#f2f2f2', '#d8d8d8', '#b0b0b0', '#808080', '#4a4a4a'],
    rim: ['#ffffff', '#9a9a9a', '#3a3a3a'],
    highlight: '#ffffff',
    shadow: '#333333',
    groove: '#767676',
  },
};

const LETTER: Record<'heads' | 'tails', string> = { heads: 'H', tails: 'T' };

// Short tick marks around the rim, simulating a reeded (milled) coin edge
// seen face-on.
function reeding(cx: number, cy: number, r1: number, r2: number, count: number) {
  const ticks: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x1 = cx + r1 * Math.cos(a), y1 = cy + r1 * Math.sin(a);
    const x2 = cx + r2 * Math.cos(a), y2 = cy + r2 * Math.sin(a);
    ticks.push(`M${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)}`);
  }
  return ticks.join(' ');
}

export function CoinFace({ variant, size = 60 }: { variant: 'heads' | 'tails'; size?: number }) {
  const uid = useId().replace(/:/g, '');
  const p = PALETTES[variant];
  const letter = LETTER[variant];
  const fieldId = `coin-field-${uid}`;
  const rimId = `coin-rim-${uid}`;
  const shineId = `coin-shine-${uid}`;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <radialGradient id={fieldId} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor={p.field[0]} />
          <stop offset="15%" stopColor={p.field[1]} />
          <stop offset="35%" stopColor={p.field[2]} />
          <stop offset="55%" stopColor={p.field[3]} />
          <stop offset="75%" stopColor={p.field[4]} />
          <stop offset="100%" stopColor={p.field[5]} />
        </radialGradient>
        <linearGradient id={rimId} x1="15%" y1="10%" x2="85%" y2="90%">
          <stop offset="0%" stopColor={p.rim[0]} />
          <stop offset="50%" stopColor={p.rim[1]} />
          <stop offset="100%" stopColor={p.rim[2]} />
        </linearGradient>
        <radialGradient id={shineId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Drop shadow to seat the coin visually */}
      <ellipse cx="50" cy="53" rx="44" ry="42" fill="rgba(0,0,0,0.35)" />

      {/* Field (main coin body) */}
      <circle cx="50" cy="50" r="45" fill={`url(#${fieldId})`} />

      {/* Reeded edge, just inside the rim */}
      <g stroke={p.groove} strokeWidth="0.6" opacity="0.4">
        <path d={reeding(50, 50, 43, 45, 72)} />
      </g>

      {/* Beveled rim ring */}
      <circle cx="50" cy="50" r="44.5" fill="none" stroke={`url(#${rimId})`} strokeWidth="2.6" />

      {/* Inner decorative groove */}
      <circle cx="50" cy="50" r="38" fill="none" stroke={p.groove} strokeWidth="1" opacity="0.45" />

      {/* Engraved letter — dark offset copy (recessed shadow) */}
      <text
        x="50.9" y="51.2" textAnchor="middle" dominantBaseline="central"
        fontFamily="Georgia, 'Times New Roman', serif" fontWeight={700} fontSize="46"
        fill={p.shadow} opacity="0.55"
      >
        {letter}
      </text>
      {/* Engraved letter — light offset copy (relief highlight) */}
      <text
        x="49.3" y="48.9" textAnchor="middle" dominantBaseline="central"
        fontFamily="Georgia, 'Times New Roman', serif" fontWeight={700} fontSize="46"
        fill={p.highlight} opacity="0.8"
      >
        {letter}
      </text>
      {/* Engraved letter — main face, matches the field metal */}
      <text
        x="50" y="50" textAnchor="middle" dominantBaseline="central"
        fontFamily="Georgia, 'Times New Roman', serif" fontWeight={700} fontSize="46"
        fill={`url(#${fieldId})`} stroke={p.shadow} strokeWidth="0.4"
      >
        {letter}
      </text>

      {/* Specular highlight (glassy shine, upper-left light source) */}
      <ellipse cx="36" cy="30" rx="20" ry="14" fill={`url(#${shineId})`} style={{ mixBlendMode: 'screen' }} />

      {/* Thin bright arc catching the light along the upper rim */}
      <path
        d="M 20 34 A 34 34 0 0 1 62 15"
        fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" opacity="0.5"
      />
    </svg>
  );
}

/** Tiny coin icon for buttons/triggers (heads face, no props needed). */
export function CoinIcon({ size = 15 }: { size?: number }) {
  return <CoinFace variant="heads" size={size} />;
}
