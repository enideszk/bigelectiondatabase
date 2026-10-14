/** Search box over data/units/index.json (accent-insensitive, matches at the start of words first). */

import { h } from '../components/dom';
import { normalizeForSearch } from '../lib/format';
import { t } from '../lib/i18n';
import type { Meta, UnitIndexEntry } from '../lib/types';
import { displayName } from '../lib/units';

const MAX_RESULTS = 10;

export function createSearch(container: HTMLElement, meta: Meta, units: UnitIndexEntry[], onSelect: (id: string) => void): void {
  const typeName = new Map(meta.unit_types.map((u) => [u.type, u.name]));
  const byId = new Map(units.map((u) => [u.id, u]));
  const entries = units.map((u) => ({ unit: u, key: normalizeForSearch(`${u.name} ${u.name_en ?? ''}`) }));

  const input = h('input', { type: 'search', autocomplete: 'off', spellcheck: 'false', placeholder: t.searchPlaceholder, 'aria-label': t.searchPlaceholder });
  const list = h('ul', { class: 'search-results', role: 'listbox', hidden: true });

  const countyOf = (u: UnitIndexEntry) => {
    const county = u.parents.map((p) => byId.get(p)).find((p) => p?.type === 'county');
    return county && county.id !== u.id ? displayName(county) : '';
  };

  const close = () => {
    input.value = '';
    list.hidden = true;
  };

  input.addEventListener('input', () => {
    const query = normalizeForSearch(input.value.trim());
    if (!query) {
      list.hidden = true;
      return;
    }
    const matches = entries
      .map((e) => ({ ...e, pos: e.key.indexOf(query), word: e.key.includes(` ${query}`) }))
      .filter((e) => e.pos >= 0)
      .sort((a, b) => Number(a.pos !== 0 && !a.word) - Number(b.pos !== 0 && !b.word) || a.key.localeCompare(b.key, 'hu'))
      .slice(0, MAX_RESULTS);
    list.replaceChildren(
      ...(matches.length
        ? matches.map((m) =>
            h(
              'li',
              { role: 'option' },
              h(
                'button',
                {
                  type: 'button',
                  onclick: () => {
                    close();
                    onSelect(m.unit.id);
                  },
                },
                h('span', null, displayName(m.unit)),
                h('span', { class: 'rmeta' }, countyOf(m.unit)),
                h('span', { class: 'rkind' }, typeName.get(m.unit.type) ?? m.unit.type),
              ),
            ),
          )
        : [h('li', { class: 'empty' }, t.searchNoMatches)]),
    );
    list.hidden = false;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') list.querySelector('button')?.click();
    if (e.key === 'Escape') close();
  });

  container.replaceChildren(input, list);
}
