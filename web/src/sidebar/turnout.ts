/**
 * Participation: a small ring with voted / did not vote beside it, and under them the ballot papers
 * (in the box, invalid, valid), as on the official results pages.
 */

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

export function renderTurnout(ctx: SidebarContext): HTMLElement[] {
  const head = h('h4', { class: 'd-h' }, t.participation);
  const row = pickTurnout(ctx.results?.turnout ?? [], ctx.state.view, ctx.state.round);
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
  const block = h(
    'div',
    { class: 'd-participation' },
    h(
      'div',
      { class: 'd-turnout' },
      donut(share, `${t.turnout}: ${formatShare(share, 2)}`),
      h('div', { class: 'd-tlegend' }, entry('v', t.voted, share, row.voted), entry('nv', t.didNotVote, 1 - share, row.registered - row.voted)),
    ),
  );
  if (row.valid !== null && row.invalid !== null && row.valid + row.invalid > 0) {
    const cast = row.valid + row.invalid;
    const line = (label: string, value: (Node | string)[]) => h('div', { class: 'd-bline' }, h('span', null, label), h('strong', null, ...value));
    block.append(
      h(
        'div',
        { class: 'd-ballots' },
        line(t.ballotsCast, [formatInt(cast)]),
        line(t.invalidBallots, [formatShare(row.invalid / cast, 2), h('small', null, ` (${formatInt(row.invalid)})`)]),
        line(t.validBallots, [formatShare(row.valid / cast, 2), h('small', null, ` (${formatInt(row.valid)})`)]),
      ),
    );
  }
  return [head, block];
}
