/** Table of indicator values: name, value, year. */

import { t } from '../lib/i18n';
import { h } from './dom';

export interface IndicatorRow {
  name: string;
  /** Hover text, e.g. the definition and source. */
  title?: string;
  value: string;
  year: number;
}

export function indicatorTable(rows: IndicatorRow[]): HTMLElement {
  return h(
    'table',
    { class: 'tbl' },
    h('thead', null, h('tr', null, h('th', null, t.indicatorColumn), h('th', { class: 'num' }, t.valueColumn), h('th', { class: 'num' }, t.yearColumn))),
    h(
      'tbody',
      null,
      ...rows.map((row) =>
        h(
          'tr',
          null,
          h('td', { title: row.title }, row.name),
          h('td', { class: 'num strong' }, row.value),
          h('td', { class: 'num muted' }, row.year),
        ),
      ),
    ),
  );
}
