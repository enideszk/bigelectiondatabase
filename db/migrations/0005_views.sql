-- 0005: hierarchy and aggregation views.
--
-- The mv_* materialized views must be refreshed after loading data:
--   CALL refresh_aggregates();      (or `etl db refresh`; `etl export` does it automatically)

-- Every unit with every ancestor in the administrative tree, plus the period during which that
-- chain of parent links holds. Example: before 2013 a settlement reaches its county directly
-- (depth 1); from 2013 it goes through its járás (depth 2).
CREATE VIEW v_unit_ancestor AS
WITH RECURSIVE chain AS (
    SELECT child_unit_id AS unit_id,
           parent_unit_id AS ancestor_id,
           1 AS depth,
           daterange(valid_from, valid_to) AS period
    FROM unit_parent
    UNION ALL
    SELECT c.unit_id,
           p.parent_unit_id,
           c.depth + 1,
           c.period * daterange(p.valid_from, p.valid_to)
    FROM chain c
    JOIN unit_parent p ON p.child_unit_id = c.ancestor_id
                      AND c.period && daterange(p.valid_from, p.valid_to)
)
SELECT unit_id, ancestor_id, depth, lower(period) AS valid_from, upper(period) AS valid_to, period
FROM chain;

-- For each election: which reporting unit (the level a source stored results at) counts toward
-- which clickable unit. Rules, in order:
--   1. a clickable reporting unit counts toward itself
--   2. a polling station counts toward its settlement and its electoral district
--   3. a settlement / Budapest district / special unit counts toward its administrative
--      ancestors valid on election day (so do polling stations, via their settlement)
--   4. settlement-level rows count toward an electoral district only if the settlement lies in
--      exactly one district of that election's district set (split cities need polling-station
--      data for district totals)
--   5. district-level rows (when nothing finer exists) count toward the district's county
--      and the county's ancestors
CREATE MATERIALIZED VIEW mv_rollup AS
WITH reporting AS (
    SELECT DISTINCT election_id, unit_id FROM turnout
    UNION
    SELECT DISTINCT election_id, unit_id FROM list_result
    UNION
    SELECT DISTINCT election_id, unit_id FROM candidate_result
),
base AS (
    SELECT r.election_id,
           e.election_date,
           e.district_set_id,
           r.unit_id AS reporting_unit_id,
           u.unit_type,
           t.is_clickable,
           CASE WHEN u.unit_type = 'polling_station' THEN ps.local_unit_id
                WHEN u.unit_type IN ('settlement', 'bp_district') THEN u.unit_id
           END AS local_unit_id,
           ps.district_unit_id AS station_district_id
    FROM reporting r
    JOIN election e ON e.election_id = r.election_id
    JOIN unit u ON u.unit_id = r.unit_id
    JOIN unit_type t ON t.unit_type = u.unit_type
    LEFT JOIN polling_station ps ON ps.unit_id = r.unit_id
),
targets AS (
    -- 1.
    SELECT election_id, reporting_unit_id, reporting_unit_id AS target_unit_id
    FROM base
    WHERE is_clickable
    UNION
    -- 2.
    SELECT election_id, reporting_unit_id, local_unit_id
    FROM base
    WHERE unit_type = 'polling_station'
    UNION
    SELECT election_id, reporting_unit_id, station_district_id
    FROM base
    WHERE station_district_id IS NOT NULL
    UNION
    -- 3.
    SELECT b.election_id, b.reporting_unit_id, a.ancestor_id
    FROM base b
    JOIN v_unit_ancestor a ON a.unit_id = COALESCE(b.local_unit_id, b.reporting_unit_id)
                          AND a.period @> b.election_date
    UNION
    -- 4.
    SELECT b.election_id, b.reporting_unit_id, min(dm.district_unit_id)
    FROM base b
    JOIN district_membership dm ON dm.local_unit_id = b.reporting_unit_id
    JOIN electoral_district ed ON ed.unit_id = dm.district_unit_id
                              AND ed.district_set_id = b.district_set_id
    WHERE b.unit_type IN ('settlement', 'bp_district')
    GROUP BY b.election_id, b.reporting_unit_id
    HAVING count(*) = 1
    UNION
    -- 5.
    SELECT b.election_id, b.reporting_unit_id, ed.county_unit_id
    FROM base b
    JOIN electoral_district ed ON ed.unit_id = b.reporting_unit_id
    UNION
    SELECT b.election_id, b.reporting_unit_id, a.ancestor_id
    FROM base b
    JOIN electoral_district ed ON ed.unit_id = b.reporting_unit_id
    JOIN v_unit_ancestor a ON a.unit_id = ed.county_unit_id
                          AND a.period @> b.election_date
)
SELECT election_id, reporting_unit_id, target_unit_id
FROM targets
WHERE target_unit_id IS NOT NULL;

CREATE UNIQUE INDEX mv_rollup_key ON mv_rollup (election_id, reporting_unit_id, target_unit_id);

-- Turnout at every clickable level.
CREATE MATERIALIZED VIEW mv_turnout_agg AS
SELECT t.election_id,
       t.round_no,
       t.ballot,
       r.target_unit_id AS unit_id,
       sum(t.registered) AS registered,
       sum(t.voted) AS voted,
       sum(t.valid) AS valid,
       sum(t.invalid) AS invalid,
       count(*) AS n_reporting_units
FROM turnout t
JOIN mv_rollup r ON r.election_id = t.election_id AND r.reporting_unit_id = t.unit_id
GROUP BY t.election_id, t.round_no, t.ballot, r.target_unit_id;

CREATE UNIQUE INDEX mv_turnout_agg_key ON mv_turnout_agg (election_id, unit_id, round_no, ballot);

-- Party-list votes at every clickable level.
CREATE MATERIALIZED VIEW mv_list_result_agg AS
SELECT l.election_id,
       l.round_no,
       r.target_unit_id AS unit_id,
       l.list_id,
       sum(l.votes) AS votes
FROM list_result l
JOIN mv_rollup r ON r.election_id = l.election_id AND r.reporting_unit_id = l.unit_id
GROUP BY l.election_id, l.round_no, r.target_unit_id, l.list_id;

CREATE UNIQUE INDEX mv_list_result_agg_key ON mv_list_result_agg (election_id, unit_id, round_no, list_id);

-- Candidate votes at every clickable level. Electoral-district totals do not go through the
-- rollup: all of a candidate's votes belong to their own district, at any reporting level.
CREATE MATERIALIZED VIEW mv_candidate_result_agg AS
SELECT c.election_id,
       c.round_no,
       r.target_unit_id AS unit_id,
       c.candidate_id,
       sum(c.votes) AS votes
FROM candidate_result c
JOIN mv_rollup r ON r.election_id = c.election_id AND r.reporting_unit_id = c.unit_id
WHERE r.target_unit_id NOT LIKE 'smd-%'
GROUP BY c.election_id, c.round_no, r.target_unit_id, c.candidate_id
UNION ALL
SELECT c.election_id,
       c.round_no,
       k.district_unit_id AS unit_id,
       c.candidate_id,
       sum(c.votes) AS votes
FROM candidate_result c
JOIN candidate k ON k.candidate_id = c.candidate_id
WHERE k.district_unit_id LIKE 'smd-%'
GROUP BY c.election_id, c.round_no, k.district_unit_id, c.candidate_id;

CREATE UNIQUE INDEX mv_candidate_result_agg_key ON mv_candidate_result_agg (election_id, unit_id, round_no, candidate_id);

-- Winning party list (round 1) per election and unit; used to color the map.
-- Ties go to the lower list_id.
CREATE MATERIALIZED VIEW mv_list_winner AS
SELECT DISTINCT ON (election_id, unit_id)
       election_id, unit_id, list_id, votes
FROM mv_list_result_agg
WHERE round_no = 1
ORDER BY election_id, unit_id, votes DESC, list_id;

CREATE UNIQUE INDEX mv_list_winner_key ON mv_list_winner (election_id, unit_id);

CREATE PROCEDURE refresh_aggregates()
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW mv_rollup;
    REFRESH MATERIALIZED VIEW mv_turnout_agg;
    REFRESH MATERIALIZED VIEW mv_list_result_agg;
    REFRESH MATERIALIZED VIEW mv_candidate_result_agg;
    REFRESH MATERIALIZED VIEW mv_list_winner;
END;
$$;
