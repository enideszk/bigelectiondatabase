/** Search box over data/units/index.json (accent-insensitive, matches at the start of words first).
 *  The arrow keys move through the results (wrapping around), Enter opens the highlighted one (the
 *  first when none is), Escape clears the box. Focus stays in the box throughout. */

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

  const input = h('input', {
    type: 'search',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: t.searchPlaceholder,
    'aria-label': t.searchPlaceholder,
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-controls': 'search-results',
    'aria-expanded': 'false',
  });
  const list = h('ul', { id: 'search-results', class: 'search-results', role: 'listbox', hidden: true });

  const countyOf = (u: UnitIndexEntry) => {
    const county = u.parents.map((p) => byId.get(p)).find((p) => p?.type === 'county');
    return county && county.id !== u.id ? displayName(county) : '';
  };

  /** The highlighted result (-1 = none). */
  let active = -1;
  const buttons = () => [...list.querySelectorAll<HTMLButtonElement>('button')];
  const highlight = (index: number) => {
    const all = buttons();
    active = all.length && index >= 0 ? index % all.length : -1;
    all.forEach((b, n) => {
      b.classList.toggle('active', n === active);
      b.parentElement?.setAttribute('aria-selected', String(n === active));
    });
    const current = all[active];
    if (current?.parentElement) {
      input.setAttribute('aria-activedescendant', current.parentElement.id);
      current.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };
  const show = (open: boolean) => {
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) highlight(-1);
  };

  const close = () => {
    input.value = '';
    show(false);
  };

  input.addEventListener('input', () => {
    const query = normalizeForSearch(input.value.trim());
    if (!query) {
      show(false);
      return;
    }
    const matches = entries
      .map((e) => ({ ...e, pos: e.key.indexOf(query), word: e.key.includes(` ${query}`) }))
      .filter((e) => e.pos >= 0)
      .sort((a, b) => Number(a.pos !== 0 && !a.word) - Number(b.pos !== 0 && !b.word) || a.key.localeCompare(b.key, 'hu'))
      .slice(0, MAX_RESULTS);
    list.replaceChildren(
      ...(matches.length
        ? matches.map((m, n) =>
            h(
              'li',
              { id: `search-result-${n}`, role: 'option', 'aria-selected': 'false' },
              h(
                'button',
                {
                  type: 'button',
                  tabindex: '-1',
                  onmousemove: () => {
                    if (active !== n) highlight(n);
                  },
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
    list.scrollTop = 0;
    show(true);
  });
  input.addEventListener('keydown', (e) => {
    const count = list.hidden ? 0 : buttons().length;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && count) {
      e.preventDefault(); // not the caret to the start / end of the text
      highlight(e.key === 'ArrowDown' ? active + 1 : (active < 0 ? count : active) - 1 + count);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      (buttons()[active] ?? buttons()[0])?.click();
    } else if (e.key === 'Escape') {
      close();
    }
  });

  container.replaceChildren(input, list);
}
