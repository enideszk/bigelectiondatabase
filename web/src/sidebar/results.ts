/** Results with the L / E toggle: party lists, or single-member races grouped by district and round. */

import { barList, type BarItem, type Chip } from '../components/barList';
import { h } from '../components/dom';
import { toggle } from '../components/toggle';
import { t } from '../lib/i18n';
import type { Race } from '../lib/types';
import type { SidebarContext } from './context';
import { unitLink } from './header';

function partyChip(parties: string[], color: string): Chip {
  return parties.length ? { label: parties.join('–'), color } : { label: t.independentChip, color: null };
}

function listView(ctx: SidebarContext): HTMLElement {
  const lists = ctx.results?.lists ?? [];
  const firstRound = Math.min(...lists.map((l) => l.round));
  const rows = lists.filter((l) => l.round === firstRound);
  const total = rows.reduce((sum, l) => sum + l.votes, 0);
  if (!rows.length || total === 0) return h('p', { class: 'd-empty' }, t.noListResults);
  return barList(
    rows.map((l, i): BarItem => ({
      label: l.name,
      chips: [{ label: l.short_name, color: l.color }],
      color: l.color,
      share: l.votes / total,
      count: l.votes,
      lead: i === 0,
    })),
  );
}

function raceRows(race: Race): HTMLElement {
  const total = race.candidates.reduce((sum, c) => sum + c.votes, 0);
  return barList(
    race.candidates.map((c, i): BarItem => ({
      label: c.name,
      chips: [partyChip(c.parties, c.color)],
      color: c.color,
      share: total ? c.votes / total : 0,
      count: c.votes,
      lead: i === 0,
    })),
  );
}

function candidateView(ctx: SidebarContext): HTMLElement[] {
  const results = ctx.results;
  const wins = results?.district_wins ?? [];
  if (wins.length) {
    const total = wins.reduce((sum, w) => sum + w.districts, 0);
    return [
      h('div', { class: 'd-race-name' }, t.districtsWon),
      barList(
        wins.map((w, i): BarItem => ({
          label: w.parties.length ? w.parties.join('–') : t.independent,
          color: w.color,
          share: w.districts / total,
          count: `${w.districts} ${t.districtWord(w.districts)}`,
          lead: i === 0,
        })),
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
        race ? raceRows(race) : h('p', { class: 'd-empty' }, t.noRaceThisRound),
      );
    }),
  ];
}

export function renderResults(ctx: SidebarContext): HTMLElement[] {
  const view = ctx.state.view;
  return [
    h(
      'h4',
      { class: 'd-h' },
      h('span', null, t.results, h('small', null, view === 'L' ? t.viewLTitle : t.viewETitle)),
      toggle(
        t.aria.resultType,
        [
          { value: 'L', label: t.viewL, title: t.viewLTitle },
          { value: 'E', label: t.viewE, title: t.viewETitle },
        ],
        view,
        (v) => ctx.update({ view: v }),
        true,
      ),
    ),
    ...(view === 'L' ? [listView(ctx)] : candidateView(ctx)),
  ];
}
