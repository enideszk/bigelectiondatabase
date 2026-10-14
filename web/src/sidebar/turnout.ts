/** Participation (ring + voted / did not vote) and the ballot counts. */

import { h } from '../components/dom';
import { donut } from '../components/donut';
import { formatInt, formatShare } from '../lib/format';
import { t } from '../lib/i18n';
import type { Turnout } from '../lib/types';
import type { SidebarContext } from './context';

/** L view: round 1 list ballots. E view: candidate ballots of the selected round. */
export function pickTurnout(rows: Turnout[], view: 'L' | 'E', round: number): Turnout | undefined {
  const wanted = view === 'E' ? round : 1;
  const inRound = rows.filter((r) => r.round === wanted);
  return inRound.find((r) => r.ballot === (view === 'E' ? 'candidate' : 'list')) ?? inRound[0];
}

function selectedTurnout(ctx: SidebarContext): Turnout | undefined {
  return pickTurnout(ctx.results?.turnout ?? [], ctx.state.view, ctx.state.round);
}

export function renderTurnout(ctx: SidebarContext): HTMLElement[] {
  const head = h('h4', { class: 'd-h' }, t.participation);
  const row = selectedTurnout(ctx);
  if (!row || row.registered === null || row.voted === null || row.registered === 0) {
    return [head, h('p', { class: 'd-empty' }, t.noTurnout)];
  }
  const share = row.voted / row.registered;
  // Key entry: a tall color bar, the label, then the share in bold and the count.
  const entry = (cls: string, label: string, part: number, count: number) =>
    h(
      'div',
      { class: 'd-titem' },
      h('i', { class: cls }),
      h('div', null, h('div', { class: 'd-tlabel' }, label), h('div', { class: 'd-tval' }, h('b', null, formatShare(part, 2)), ` (${formatInt(count)})`)),
    );
  return [
    head,
    h(
      'div',
      { class: 'd-turnout' },
      donut(share, `${t.turnout}: ${formatShare(share, 2)}`),
      h(
        'div',
        { class: 'd-tlegend' },
        entry('v', t.voted, share, row.voted),
        entry('nv', t.didNotVote, 1 - share, row.registered - row.voted),
      ),
    ),
  ];
}

export function renderBallots(ctx: SidebarContext): HTMLElement[] {
  const row = selectedTurnout(ctx);
  if (!row || row.valid === null || row.invalid === null) return [];
  const cast = row.valid + row.invalid;
  const stat = (label: string, n: number) =>
    h('div', { class: 'd-stat' }, h('span', null, label), h('strong', null, formatInt(n), ' ', h('small', null, cast ? formatShare(n / cast) : '')));
  return [h('h4', { class: 'd-h' }, t.ballots), h('div', { class: 'd-stats' }, stat(t.valid, row.valid), stat(t.invalid, row.invalid))];
}
