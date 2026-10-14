/**
 * Turnout ring, plain SVG: the share that voted over a track for the rest. The arc starts at the
 * top (12 o'clock) and runs clockwise.
 */

import { s } from './dom';

const R = 14;
const C = 2 * Math.PI * R;

export function donut(share: number, label: string, className = 'd-donut'): SVGSVGElement {
  const f = Math.max(0, Math.min(1, share));
  return s(
    'svg',
    { class: className, viewBox: '0 0 40 40', role: 'img', 'aria-label': label },
    s('circle', { class: 'donut-track', cx: 20, cy: 20, r: R }),
    // SVG strokes start at 3 o'clock: turned back a quarter so the arc starts at the top
    s('circle', { class: 'donut-v', cx: 20, cy: 20, r: R, transform: 'rotate(-90 20 20)', 'stroke-dasharray': `${(f * C).toFixed(3)} ${C.toFixed(3)}` }),
  );
}
