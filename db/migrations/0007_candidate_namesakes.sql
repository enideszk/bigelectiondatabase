-- 0007: two candidates in the same race may share a name (2014 and 2018 had namesakes nominated by
-- different organisations, a known decoy tactic). Within a race, the ballot position is unique.

ALTER TABLE candidate DROP CONSTRAINT candidate_election_id_race_type_district_unit_id_name_key;
ALTER TABLE candidate ADD CONSTRAINT candidate_race_ballot_position_key
    UNIQUE (election_id, race_type, district_unit_id, ballot_position);
