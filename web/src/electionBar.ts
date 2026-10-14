/** The thin bar across the top of the page: which election, and which results, are shown. */

import { h } from './components/dom';
import { formatDate } from './lib/format';
import { t } from './lib/i18n';
import type { ElectionMeta } from './lib/types';
import type { View } from './state';

export function renderElectionBar(container: HTMLElement, election: ElectionMeta | undefined, view: View): void {
  if (!election) {
    container.replaceChildren(h('strong', null, t.noElections));
    return;
  }
  container.replaceChildren(
    h('strong', null, t.electionHeading(election.year, election.type_name)),
    h('span', { class: 'eb-sep' }, '·'),
    h('span', null, formatDate(election.date)),
    h('span', { class: 'eb-sep' }, '·'),
    h('span', null, view === 'L' ? t.viewLTitle : t.viewETitle),
  );
}
