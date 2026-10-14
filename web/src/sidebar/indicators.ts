/** Socio-demographic indicators: for each indicator, the value from the year closest to the election. */

import { h } from '../components/dom';
import { indicatorTable } from '../components/indicatorTable';
import { formatValue } from '../lib/format';
import { t } from '../lib/i18n';
import type { IndicatorValue } from '../lib/types';
import type { SidebarContext } from './context';

/** Closest year to `year`; on a tie the earlier one. */
export function closestValue(values: IndicatorValue[], year: number): IndicatorValue | undefined {
  return [...values].sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year) || a.year - b.year)[0];
}

export function renderIndicators(ctx: SidebarContext): HTMLElement[] {
  const head = h('h4', { class: 'd-h' }, t.indicators);
  const rows = ctx.meta.indicators.flatMap((indicator) => {
    const value = closestValue(
      ctx.unit.indicators.filter((v) => v.indicator === indicator.id),
      Number(ctx.date.slice(0, 4)),
    );
    if (!value) return [];
    return [
      {
        name: indicator.name,
        title: [indicator.description, `Source: ${indicator.source}`].filter(Boolean).join('\n'),
        value: formatValue(value.value, indicator.unit_of_measure, indicator.decimals),
        year: value.year,
      },
    ];
  });
  if (!rows.length) return [head, h('p', { class: 'd-empty' }, t.noIndicators)];
  return [head, indicatorTable(rows), h('p', { class: 'd-note quiet' }, t.indicatorYearNote)];
}
