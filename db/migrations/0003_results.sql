-- 0003: parties, party lists, candidates and results (long format).
--
-- Results are stored at whatever level the source provides (polling station, settlement,
-- electoral district, special unit). Rule: store each election at ONE level and never load
-- totals that can be derived (county, national). Aggregates live in 0005_views.sql.

CREATE TABLE party (
    party_id    text PRIMARY KEY CHECK (party_id ~ '^[a-z0-9_]+$'),   -- stable across renames
    name        text NOT NULL,                  -- latest official name
    short_name  text NOT NULL,
    color       text CHECK (color ~ '^#[0-9a-f]{6}$'),
    notes       text,
    source_id   integer NOT NULL REFERENCES source ON DELETE CASCADE
);

CREATE TABLE party_name (
    party_id    text NOT NULL REFERENCES party DEFERRABLE INITIALLY DEFERRED,
    name        text NOT NULL,
    short_name  text NOT NULL,
    valid_from  date,
    valid_to    date,
    source_id   integer NOT NULL REFERENCES source ON DELETE CASCADE,
    EXCLUDE USING gist (party_id WITH =, daterange(valid_from, valid_to) WITH &&)
);

-- What voters actually voted for on the list ballot. Joint lists have several members.
-- 1990-2010 territorial (county) lists of the same party/coalition are stored as ONE list per
-- election; the county is implied by where the votes were cast. scope_unit_id is for lists that
-- really only exist in one area (e.g. county assembly lists in local elections).
CREATE TABLE party_list (
    list_id          serial PRIMARY KEY,
    election_id      text NOT NULL REFERENCES election DEFERRABLE INITIALLY DEFERRED,
    name             text NOT NULL,
    short_name       text NOT NULL,
    list_kind        text NOT NULL DEFAULT 'party' CHECK (list_kind IN ('party', 'nationality')),
    scope_unit_id    text REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    color            text CHECK (color ~ '^#[0-9a-f]{6}$'),   -- NULL = color of the first member party
    ballot_position  smallint,
    source_id        integer NOT NULL REFERENCES source ON DELETE CASCADE,
    UNIQUE (election_id, list_id),
    UNIQUE NULLS NOT DISTINCT (election_id, name, scope_unit_id)
);

CREATE TABLE party_list_member (
    list_id   integer NOT NULL REFERENCES party_list ON DELETE CASCADE,   -- part of the list's definition
    party_id  text NOT NULL REFERENCES party DEFERRABLE INITIALLY DEFERRED,
    position  smallint NOT NULL DEFAULT 1,
    PRIMARY KEY (list_id, party_id)
);

-- A candidate in one race. For parliament, race_type = 'smd' and district_unit_id is the smd unit.
-- (Mayors etc. later: race_type 'mayor', district_unit_id = the settlement.)
CREATE TABLE candidate (
    candidate_id      serial PRIMARY KEY,
    election_id       text NOT NULL REFERENCES election DEFERRABLE INITIALLY DEFERRED,
    race_type         text NOT NULL DEFAULT 'smd' CHECK (race_type IN ('smd', 'mayor', 'lord_mayor', 'council')),
    district_unit_id  text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    name              text NOT NULL,
    ballot_position   smallint,
    source_id         integer NOT NULL REFERENCES source ON DELETE CASCADE,
    UNIQUE (election_id, candidate_id),
    UNIQUE (election_id, race_type, district_unit_id, name)
);
CREATE INDEX candidate_district_idx ON candidate (district_unit_id);

-- Nominating parties; no rows = independent. Joint candidates have several.
CREATE TABLE candidate_party (
    candidate_id  integer NOT NULL REFERENCES candidate ON DELETE CASCADE,
    party_id      text NOT NULL REFERENCES party DEFERRABLE INITIALLY DEFERRED,
    position      smallint NOT NULL DEFAULT 1,
    PRIMARY KEY (candidate_id, party_id)
);

-- ballot: 'list' = party-list ballot, 'candidate' = single-member ballot. Their valid/invalid
-- counts differ, and round 2 (1990-2010) only had candidate ballots.
CREATE TABLE turnout (
    election_id  text NOT NULL,
    round_no     smallint NOT NULL DEFAULT 1,
    unit_id      text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    ballot       text NOT NULL CHECK (ballot IN ('list', 'candidate')),
    registered   integer CHECK (registered >= 0),
    voted        integer CHECK (voted >= 0),
    valid        integer CHECK (valid >= 0),
    invalid      integer CHECK (invalid >= 0),
    source_id    integer NOT NULL REFERENCES source ON DELETE CASCADE,
    PRIMARY KEY (election_id, round_no, unit_id, ballot),
    FOREIGN KEY (election_id, round_no) REFERENCES election_round DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX turnout_unit_idx ON turnout (unit_id);

CREATE TABLE list_result (
    election_id  text NOT NULL,
    round_no     smallint NOT NULL DEFAULT 1,
    unit_id      text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    list_id      integer NOT NULL,
    votes        integer NOT NULL CHECK (votes >= 0),
    source_id    integer NOT NULL REFERENCES source ON DELETE CASCADE,
    PRIMARY KEY (election_id, round_no, unit_id, list_id),
    FOREIGN KEY (election_id, round_no) REFERENCES election_round DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (election_id, list_id) REFERENCES party_list (election_id, list_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX list_result_unit_idx ON list_result (unit_id);

CREATE TABLE candidate_result (
    election_id   text NOT NULL,
    round_no      smallint NOT NULL DEFAULT 1,
    unit_id       text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    candidate_id  integer NOT NULL,
    votes         integer NOT NULL CHECK (votes >= 0),
    source_id     integer NOT NULL REFERENCES source ON DELETE CASCADE,
    PRIMARY KEY (election_id, round_no, unit_id, candidate_id),
    FOREIGN KEY (election_id, round_no) REFERENCES election_round DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (election_id, candidate_id) REFERENCES candidate (election_id, candidate_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX candidate_result_unit_idx ON candidate_result (unit_id);
