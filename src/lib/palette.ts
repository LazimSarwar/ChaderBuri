// Expedition Atlas chart palette. Panels are paper, so chart fills reference
// the paper-side token values (see --color-*-paper intent in index.css).
// One definition shared by every SVG chart keeps verdict colors consistent.
export const palette = {
  sun: 'var(--color-sun)',
  earth: 'var(--color-earth)',
  viable: 'var(--color-viable)',
  danger: 'var(--color-danger)',
  stamp: 'var(--color-stamp)',
  ink: 'var(--color-ink)',
  inkdim: 'var(--color-inkdim)',
  track: 'var(--color-paper3)',
  grid: 'var(--color-edge)',
  paper: 'var(--color-paper)',
  paper2: 'var(--color-paper2)',
} as const
