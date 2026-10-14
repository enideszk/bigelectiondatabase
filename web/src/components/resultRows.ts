/**
 * Result rows, after the Israel dashboard's national table (hero-results): the share as a
 * translucent bar in the party color behind the row, the name (cut with "…" when too long), and on
 * the right the share with the votes under it. Bars are scaled to the leader (as there) so small
 * differences stay visible. The leading rows are shown and the rest fold into "Other", which
 * expands. A row can be picked: the map then shows that option's vote share.
 */

import { formatInt, formatShare } from '../lib/format';
import { t } from '../lib/i18n';
import { h } from './dom';

export interface ResultItem {
  label: string;
  /** Small second line, e.g. a candidate's party. */
  sub?: string;
  color: string;
  /** 0..1 */
  share: number;
  /** Under the share; a number is formatted, a string is shown as is. */
  count: number | string;
  /** Map option id (picking a row maps its vote share). */
  option?: string;
}

export interface ResultRowsOptions {
  /** Remembers the expanded state of this block while the panel re-renders. */
  key: string;
  picked?: string | null;
  onPick?: (option: string) => void;
}

const TOP = 6;
const expanded = new Set<string>();

export function resultRows(items: ResultItem[], o: ResultRowsOptions): HTMLElement {
  const box = h('div', { class: 'res-rows' });
  const scale = Math.max(0.25, Math.max(0, ...items.map((i) => i.share)) * 1.08);
  const fold = items.length > TOP + 1; // "Other (1)" would hide nothing worth hiding

  const draw = () => {
    const open = !fold || expanded.has(o.key);
    const rows = (open ? items : items.slice(0, TOP)).map((item) => row(item, scale, o));
    if (fold && !open) {
      const rest = items.slice(TOP);
      const votes = rest.every((i) => typeof i.count === 'number') ? rest.reduce((sum, i) => sum + (i.count as number), 0) : '';
      rows.push(
        row({ label: t.other(rest.length), color: 'var(--ink-4)', share: rest.reduce((sum, i) => sum + i.share, 0), count: votes }, scale, {
          ...o,
          onPick: undefined,
        }, () => {
          expanded.add(o.key);
          draw();
        }),
      );
    }
    if (fold && open) {
      rows.push(
        h(
          'button',
          {
            type: 'button',
            class: 'res-fewer',
            onclick: () => {
              expanded.delete(o.key);
              draw();
            },
          },
          t.showFewer,
        ),
      );
    }
    box.replaceChildren(...rows);
  };
  draw();
  return box;
}

function row(item: ResultItem, scale: number, o: ResultRowsOptions, onOther?: () => void): HTMLElement {
  const pick = onOther ?? (item.option && o.onPick ? () => o.onPick!(item.option!) : undefined);
  const picked = item.option !== undefined && item.option === o.picked;
  const width = Math.min(100, (Math.max(0, item.share) / scale) * 100).toFixed(2);
  return h(
    'div',
    {
      class: `res-row${pick ? ' clickable' : ''}${picked ? ' picked' : ''}${onOther ? ' other' : ''}`,
      role: pick ? 'button' : null,
      tabindex: pick ? 0 : null,
      'aria-pressed': pick && !onOther ? String(picked) : null,
      title: item.sub ? `${item.label} — ${item.sub}` : item.label,
      onclick: pick ?? null,
      onkeydown: pick
        ? (e: Event) => {
            if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
              e.preventDefault();
              pick();
            }
          }
        : null,
    },
    h('i', { class: 'res-bar', style: `width:${width}%;background:${item.color}` }),
    h('span', { class: 'res-main' }, h('span', { class: 'res-name' }, item.label), item.sub ? h('span', { class: 'res-sub' }, item.sub) : null),
    h(
      'span',
      { class: 'res-fig' },
      h('span', { class: 'res-pct' }, formatShare(item.share, 2)),
      h('span', { class: 'res-votes' }, typeof item.count === 'number' ? formatInt(item.count) : item.count),
    ),
  );
}
