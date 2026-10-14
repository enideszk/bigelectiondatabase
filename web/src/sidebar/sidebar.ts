/**
 * The side panel, laid out like the Israel dashboard's detail panel:
 *   head (name, close) · kind + status · parents · districts · lineage notes
 *   election (heading) · participation · results (L / E) · ballots · indicators
 */

import { h } from '../components/dom';
import { t } from '../lib/i18n';
import { displayName, validOn } from '../lib/units';
import type { SidebarContext } from './context';
import { renderIdentity, renderSideHead } from './header';
import { renderIndicators } from './indicators';
import { renderResults } from './results';
import { renderBallots, renderTurnout } from './turnout';

/** Which election the panel shows (it is chosen in the map control, top left). */
function electionSection(ctx: SidebarContext): HTMLElement[] {
  const election = ctx.election;
  if (!election) return [h('h4', { class: 'd-h' }, t.electionLabel), h('p', { class: 'd-note' }, t.noElections)];
  return [
    h('h4', { class: 'd-h' }, t.electionLabel),
    h('div', { class: 'd-election' }, h('div', { class: 'd-election-title' }, t.electionHeading(election.year, election.type_name))),
  ];
}

export function renderSidebar(container: HTMLElement, ctx: SidebarContext): void {
  const body: HTMLElement[] = [...renderIdentity(ctx), ...electionSection(ctx)];
  if (ctx.election) {
    if (!validOn(ctx.unit, ctx.date)) body.push(h('p', { class: 'd-note' }, t.notExisting(displayName(ctx.unit))));
    else if (!ctx.results) body.push(h('p', { class: 'd-note' }, t.noDataForElection));
    else body.push(...renderTurnout(ctx), ...renderResults(ctx), ...renderBallots(ctx));
  }
  body.push(...renderIndicators(ctx));
  const scroll = container.querySelector('.side-body')?.scrollTop ?? 0;
  const bodyEl = h('div', { class: 'side-body' }, ...body);
  container.replaceChildren(renderSideHead(ctx), bodyEl);
  bodyEl.scrollTop = scroll; // keep the position when only a toggle changed
}

export function renderSidebarMessage(container: HTMLElement, message: string): void {
  container.replaceChildren(h('p', { class: 'side-empty' }, message));
}
