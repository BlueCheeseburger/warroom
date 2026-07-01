import React from 'react';

// Hand-blocked 16x16 pixel-art coin — a real bitmap circle (not a bordered
// <circle>), rendered as a grid of <rect>s with crisp edges so it reads as
// retro/pixel art at any size. Each cell's color is derived automatically
// from its position: an outline "rim" ring where the shape meets empty
// space, a soft highlight/shadow diagonal for depth, and a symbol overlay
// (star for heads, crescent moon for tails) in an accent color.

const GRID = 16;

// Inclusive [startCol, endCol] filled range per row — approximates a circle.
const COIN_ROWS: [number, number][] = [
  [5, 10], [3, 12], [2, 13], [1, 14],
  [1, 14], [0, 15], [0, 15], [0, 15],
  [0, 15], [0, 15], [0, 15], [1, 14],
  [1, 14], [2, 13], [3, 12], [5, 10],
];

// Small 5x5 symbols, placed centered around (7.5, 7.5).
const STAR_CELLS: [number, number][] = [
  [8, 6],
  [7, 7], [8, 7], [9, 7],
  [6, 8], [7, 8], [8, 8], [9, 8], [10, 8],
  [7, 9], [8, 9], [9, 9],
  [8, 10],
];
const MOON_CELLS: [number, number][] = [
  [7, 6], [8, 6], [9, 6],
  [6, 7], [7, 7],
  [6, 8], [7, 8],
  [6, 9], [7, 9],
  [7, 10], [8, 10], [9, 10],
];

interface Palette {
  rim: string;
  shadow: string;
  base: string;
  highlight: string;
  symbol: string;
}

const PALETTES: Record<'heads' | 'tails', Palette> = {
  heads: { rim: '#92400e', shadow: '#d97706', base: '#f59e0b', highlight: '#fde68a', symbol: '#78350f' },
  tails: { rim: '#4b5563', shadow: '#9ca3af', base: '#cbd5e1', highlight: '#f1f5f9', symbol: '#374151' },
};

function isFilled(x: number, y: number): boolean {
  const row = COIN_ROWS[y];
  if (!row) return false;
  return x >= row[0] && x <= row[1];
}

function buildFace(variant: 'heads' | 'tails') {
  const palette = PALETTES[variant];
  const symbolSet = new Set((variant === 'heads' ? STAR_CELLS : MOON_CELLS).map(([x, y]) => `${x},${y}`));
  const cells: { x: number; y: number; color: string }[] = [];

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!isFilled(x, y)) continue;
      if (symbolSet.has(`${x},${y}`)) {
        cells.push({ x, y, color: palette.symbol });
        continue;
      }
      // Rim: any 4-neighbor is outside the shape — traces the coin's edge.
      const isRim = !isFilled(x - 1, y) || !isFilled(x + 1, y) || !isFilled(x, y - 1) || !isFilled(x, y + 1);
      if (isRim) {
        cells.push({ x, y, color: palette.rim });
        continue;
      }
      // Diagonal shading for a bit of pseudo-3D pop.
      const d = (x - 7.5) + (y - 7.5);
      const color = d < -2 ? palette.highlight : d > 4 ? palette.shadow : palette.base;
      cells.push({ x, y, color });
    }
  }
  return cells;
}

const FACES = { heads: buildFace('heads'), tails: buildFace('tails') };

/** A single pixel-art coin face (heads or tails), scalable to any size. */
export function PixelCoinFace({ variant, size = 60 }: { variant: 'heads' | 'tails'; size?: number }) {
  const cells = FACES[variant];
  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}
      shapeRendering="crispEdges"
      style={{ display: 'block' }}
    >
      {cells.map(({ x, y, color }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />
      ))}
    </svg>
  );
}

/** Tiny pixel-art coin icon for buttons/triggers (heads face, no props needed). */
export function PixelCoinIcon({ size = 15 }: { size?: number }) {
  return <PixelCoinFace variant="heads" size={size} />;
}
