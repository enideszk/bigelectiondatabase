/**
 * Results of the view picked in the toolbar above the map (map/controls.ts): party lists, or
 * single-member races grouped by district and round (above county level: districts won). Clicking
 * a row maps that party's vote share; clicking it again goes back to the winners.
 */

import { h } from '../components/dom';
import { resultRows, type ResultItem, type ResultRowsOptions } from '../components/resultRows';
import { toggle } from '../components/toggle';
import { t } from '../lib/i18n';
import type { Race } from '../lib/types';
import { parseMapBy, partyMap } from '../map/coloring';
import type { SidebarContext } from './context';
import { unitLink } from './header';

const partyLabel = (parties: string[]) => (parties.length ? parties.join('–') : t.independent);

function rowOptions(ctx: SidebarContext, key: string): ResultRowsOptions {
  const by = parseMapBy(ctx.state.map);
  const picked = by.kind === 'party' ? by.option : null;
  return {
    key,
    picked,
    onPick: (option) => ctx.update({ map: option === picked ? null : partyMap(option) }),
  };
}

function listView(ctx: SidebarContext): HTMLElement {
  const lists = ctx.results?.lists ?? [];
  const firstRound = Math.min(...lists.map((l) => l.round));
  const rows = lists.filter((l) => l.round === firstRound);
  // Shares of all valid list ballots, as the official results count them (this includes the
  // nationality lists' votes, which are not shown); the sum of the shown votes if turnout is missing.
  const valid = ctx.results?.turnout.find((tr) => tr.round === firstRound && tr.ballot === 'list')?.valid;
  const total = valid && valid > 0 ? valid : rows.reduce((sum, l) => sum + l.votes, 0);
  if (!rows.length || total === 0) return h('p', { class: 'd-empty' }, t.noListResults);
  return resultRows(
    rows.map((l): ResultItem => ({ label: l.name, color: l.color, share: l.votes / total, count: l.votes, option: l.option })),
    rowOptions(ctx, 'L'),
  );
}

function raceRows(ctx: SidebarContext, race: Race): HTMLElement {
  const total = race.candidates.reduce((sum, c) => sum + c.votes, 0);
  return resultRows(
    race.candidates.map(
      (c): ResultItem => ({
        label: c.name,
        sub: partyLabel(c.parties),
        color: c.color,
        share: total ? c.votes / total : 0,
        count: c.votes,
        option: c.option,
      }),
    ),
    rowOptions(ctx, `E:${race.district.id}:${race.round}`),
  );
}

function candidateView(ctx: SidebarContext): HTMLElement[] {
  const results = ctx.results;
  const wins = results?.district_wins ?? [];
  if (wins.length) {
    const total = wins.reduce((sum, w) => sum + w.districts, 0);
    return [
      h('div', { class: 'd-race-name' }, t.districtsWon),
      resultRows(
        wins.map(
          (w): ResultItem => ({
            label: partyLabel(w.parties),
            color: w.color,
            share: w.districts / total,
            count: `${w.districts} ${t.districtWord(w.districts)}`,
            option: w.option,
          }),
        ),
        rowOptions(ctx, 'E:wins'),
      ),
      h('p', { class: 'd-note quiet' }, t.districtsWonNote),
    ];
  }

  const races = results?.races ?? [];
  if (!races.length) return [h('p', { class: 'd-empty' }, t.noCandidateResults)];

  const rounds = (ctx.election?.rounds ?? []).map((r) => r.round);
  const round = ctx.state.round;
  const districts = [...new Map(races.map((r) => [r.district.id, r.district])).values()];
  const showNames = districts.length > 1 || ctx.unit.type !== 'smd';
  return [
    ...(rounds.length > 1
      ? [
          h(
            'div',
            { class: 'd-rounds' },
            toggle(
              t.aria.round,
              rounds.map((r) => ({ value: r, label: t.round(r) })),
              round,
              (value) => ctx.update({ round: value }),
              true,
            ),
          ),
        ]
      : []),
    ...districts.map((district) => {
      const race = races.find((r) => r.district.id === district.id && r.round === round);
      return h(
        'div',
        { class: 'd-race' },
        showNames ? h('div', { class: 'd-race-name' }, unitLink(ctx, district.id, district.name)) : null,
        race ? raceRows(ctx, race) : h('p', { class: 'd-empty' }, t.noRaceThisRound),
      );
    }),
  ];
}

export function renderResults(ctx: SidebarContext): HTMLElement[] {
  const view = ctx.state.view;
  return [
    h('h4', { class: 'd-h' }, h('span', null, t.results, h('small', null, view === 'L' ? t.viewLTitle : t.viewETitle))),
    ...(view === 'L' ? [listView(ctx)] : candidateView(ctx)),
    h('p', { class: 'd-note quiet' }, t.pickHint),
  ];
}
