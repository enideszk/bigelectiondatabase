/** Segmented control (a row of buttons, one active): L / E, rounds, map levels. */

import { formatInt } from '../lib/format';
import { h } from './dom';

export interface ToggleOption<T extends string | number> {
  value: T;
  label: string;
  title?: string;
  /** Small number after the label, e.g. how many units a map level has. */
  count?: number;
  /** Shown but not selectable (e.g. an election type with no data loaded yet). */
  disabled?: boolean;
}

export function toggle<T extends string | number>(
  name: string,
  options: ToggleOption<T>[],
  current: T,
  onChange: (value: T) => void,
  small = false,
): HTMLElement {
  return h(
    'div',
    { class: small ? 'seg seg-sm' : 'seg', role: 'group', 'aria-label': name },
    ...options.map((option) =>
      h(
        'button',
        {
          type: 'button',
          class: option.value === current ? 'on' : null,
          'aria-pressed': option.value === current ? 'true' : 'false',
          title: option.title,
          disabled: option.disabled,
          onclick: () => onChange(option.value),
        },
        option.label,
        option.count !== undefined ? h('small', null, formatInt(option.count)) : null,
      ),
    ),
  );
}
