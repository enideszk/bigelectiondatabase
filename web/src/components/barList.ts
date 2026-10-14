/**
 * Result rows: name (with party chips), share, count, and a translucent bar in the party color
 * behind the row whose length is the share. Same pattern as the Israel dashboard's detail panel.
 */

import { formatInt, formatShare } from '../lib/format';
import { h } from './dom';

export interface Chip {
  label: string;
  color: string | null; // null = independent / no party
}

export interface BarItem {
  label: string;
  /** Chips before the label, e.g. the list's short name or a candidate's parties. */
  chips?: Chip[];
  /** Small second line under the label. */
  detail?: string;
  color: string;
  /** 0..1 */
  share: number;
  /** Right-hand column; a number is formatted, a string is shown as is. */
  count: number | string;
  lead?: boolean;
}

export function chip(c: Chip): HTMLElement {
  return c.color
    ? h('span', { class: 'chip', style: `--c:${c.color}` }, c.label)
    : h('span', { class: 'chip ind' }, c.label);
}

export function barList(items: BarItem[]): HTMLElement {
  return h(
    'div',
    { class: 'd-rows' },
    ...items.map((item) =>
      h(
        'div',
        { class: item.lead ? 'd-row lead' : 'd-row' },
        h('div', { class: 'd-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${(Math.max(0, Math.min(1, item.share)) * 100).toFixed(2)}%;background:${item.color}` })),
        h(
          'span',
          { class: 'rname', title: item.detail ? `${item.label} (${item.detail})` : item.label },
          ...(item.chips ?? []).map(chip),
          h('span', { class: 'rtext' }, item.label, item.detail ? h('span', { class: 'rsub' }, item.detail) : null),
        ),
        h('span', { class: 'rpct' }, formatShare(item.share)),
        h('span', { class: 'rvotes' }, typeof item.count === 'number' ? formatInt(item.count) : item.count),
      ),
    ),
  );
}
