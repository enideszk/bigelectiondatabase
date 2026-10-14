/**
 * The side panel, laid out like the Israel dashboard's detail panel:
 *   head (name, next larger area, close) · kind · parents · districts · lineage notes
 *   results (L / E) · participation (with the ballot papers) · indicators
 * The election shown is named in the bar at the top of the page.
 */

import { h } from '../components/dom';
import { t } from '../lib/i18n';
import { displayName, validOn } from '../lib/units';
import type { SidebarContext } from './context';
import { renderIdentity, renderSideHead } from './header';
import { renderIndicators } from './indicators';
import { renderResults } from './results';
import { renderTurnout } from './turnout';
import { withoutMail } from '../lib/results';

export function renderSidebar(container: HTMLElement, given: Omit<SidebarContext, 'hasMail'>): void {
  // The national totals include the votes cast by mail; without them on request.
  const hasMail = !!given.results?.mail;
  const ctx: SidebarContext = { ...given, hasMail, results: hasMail && !given.state.postal ? withoutMail(given.results!) : given.results };
  const body: HTMLElement[] = [...renderIdentity(ctx)];
  if (!ctx.election) body.push(h('p', { class: 'd-note' }, t.noElections));
  else if (!validOn(ctx.unit, ctx.date)) body.push(h('p', { class: 'd-note' }, t.notExisting(displayName(ctx.unit))));
  else if (!ctx.results) body.push(h('p', { class: 'd-note' }, t.noDataForElection));
  else {
    body.push(...renderResults(ctx), ...renderTurnout(ctx));
    body.push(h('button', { type: 'button', class: 'btn d-stations', onclick: () => ctx.update({ list: 'stations' }) }, t.goToStations));
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
