import type { Tone } from './app/status';

export const colors = {
  bg: '#F4F6F5',
  card: '#FFFFFF',
  ink: '#16212C',
  inkSoft: '#4A5865',
  line: '#D8DFDC',
  accent: '#1F6FD1',
  accentInk: '#FFFFFF',
  danger: '#B3372F',
};

export const toneColors: Record<Tone, { bg: string; fg: string; edge: string }> = {
  ok: { bg: '#E4F3EB', fg: '#1D5A3A', edge: '#2F9160' },
  busy: { bg: '#E7F0FB', fg: '#17467F', edge: '#2E7BD6' },
  warn: { bg: '#FBEFDF', fg: '#7A4A12', edge: '#E08A34' },
  error: { bg: '#FAE8E7', fg: '#7E211B', edge: '#C4453D' },
};

/** Minimum touch target, in dp. */
export const TAP = 48;
