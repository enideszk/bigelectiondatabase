/** Results arithmetic shared by the side panel and the polling station dialog. */

import type { ResultViewId, UnitElection } from './types';

/** The country's results without the votes cast by mail (party-list ballot only; `mail` holds
 *  them apart, and the totals include them once). */
export function withoutMail(results: UnitElection): UnitElection {
  const mail = results.mail;
  if (!mail) return results;
  const listVotes = new Map(mail.lists.map((l) => [`${l.round}/${l.list_id}`, l.votes]));
  const ballots = new Map(mail.turnout.map((t) => [`${t.round}/${t.ballot}`, t]));
  const minus = (a: number | null, b: number | null) => (a === null ? null : a - (b ?? 0));
  return {
    ...results,
    lists: results.lists
      .map((l) => ({ ...l, votes: l.votes - (listVotes.get(`${l.round}/${l.list_id}`) ?? 0) }))
      .sort((a, b) => a.round - b.round || b.votes - a.votes),
    turnout: results.turnout.map((t) => {
      const m = ballots.get(`${t.round}/${t.ballot}`);
      return m
        ? { ...t, registered: minus(t.registered, m.registered), voted: minus(t.voted, m.voted), valid: minus(t.valid, m.valid), invalid: minus(t.invalid, m.invalid) }
        : t;
    }),
    mail: undefined,
  };
}

export interface OptionVotes {
  option: string;
  name: string;
  color: string;
  votes: number;
}

/** Votes per option of a view in a unit, most first, and what the shares are of: L = the party
 *  lists of round 1, shares of all valid list ballots; E = the single-member candidates by
 *  nominating parties (each race's last round), shares of all their votes. */
export function optionVotes(results: UnitElection, view: ResultViewId): { rows: OptionVotes[]; total: number } {
  if (view === 'L') {
    const first = Math.min(...results.lists.map((l) => l.round));
    const lists = results.lists.filter((l) => l.round === first);
    const valid = results.turnout.find((t) => t.round === first && t.ballot === 'list')?.valid;
    const rows = lists.map((l) => ({ option: l.option, name: l.name, color: l.color, votes: l.votes }));
    return { rows: rows.sort((a, b) => b.votes - a.votes), total: valid && valid > 0 ? valid : rows.reduce((s, r) => s + r.votes, 0) };
  }
  const last = new Map<string, number>();
  for (const race of results.races) last.set(race.district.id, Math.max(last.get(race.district.id) ?? 0, race.round));
  const byOption = new Map<string, OptionVotes>();
  for (const race of results.races) {
    if (race.round !== last.get(race.district.id)) continue;
    for (const c of race.candidates) {
      const row = byOption.get(c.option) ?? { option: c.option, name: c.parties.join('–'), color: c.color, votes: 0 };
      row.votes += c.votes;
      byOption.set(c.option, row);
    }
  }
  const rows = [...byOption.values()].sort((a, b) => b.votes - a.votes);
  return { rows, total: rows.reduce((s, r) => s + r.votes, 0) };
}
