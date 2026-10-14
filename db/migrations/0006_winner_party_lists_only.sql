-- 0006: the winning list (map colours) is chosen among party lists only.
-- Nationality voters vote on a separate ballot; in a settlement with many of them a nationality
-- self-government's list could otherwise "win" the party-list race.

DROP MATERIALIZED VIEW mv_list_winner;

CREATE MATERIALIZED VIEW mv_list_winner AS
SELECT DISTINCT ON (r.election_id, r.unit_id)
       r.election_id, r.unit_id, r.list_id, r.votes
FROM mv_list_result_agg r
JOIN party_list l ON l.list_id = r.list_id
WHERE r.round_no = 1 AND l.list_kind = 'party'
ORDER BY r.election_id, r.unit_id, r.votes DESC, r.list_id;

CREATE UNIQUE INDEX mv_list_winner_key ON mv_list_winner (election_id, unit_id);
