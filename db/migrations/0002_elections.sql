-- 0002: elections, rounds, electoral district sets, districts, membership, polling stations.

CREATE TABLE election_type (
    election_type  text PRIMARY KEY,
    name_en        text NOT NULL,
    name_hu        text NOT NULL
);

INSERT INTO election_type (election_type, name_en, name_hu) VALUES
    ('parliament', 'Parliamentary election',       'Országgyűlési választás'),
    ('ep',         'European Parliament election', 'Európai parlamenti választás'),
    ('local',      'Local election',               'Önkormányzati választás'),
    ('referendum', 'Referendum',                   'Országos népszavazás');

-- A set of single-member districts defined by one law: '1990' (176 districts, used 1990-2010),
-- '2011' (106 OEVKs, used 2014-2022), '2024' (106 OEVKs as redrawn in 2024, used from 2026).
CREATE TABLE district_set (
    district_set_id  text PRIMARY KEY,
    name             text NOT NULL,
    valid_from       date,
    valid_to         date,
    source_id        integer NOT NULL REFERENCES source ON DELETE CASCADE
);

-- election_id convention: '<election_type>-<year>', e.g. parliament-2022, ep-2019, local-2019.
CREATE TABLE election (
    election_id      text PRIMARY KEY CHECK (election_id ~ '^[a-z]+-[0-9]{4}[a-z0-9-]*$'),
    election_type    text NOT NULL REFERENCES election_type DEFERRABLE INITIALLY DEFERRED,
    election_date    date NOT NULL,              -- date of round 1
    name_en          text NOT NULL,
    name_hu          text NOT NULL,
    district_set_id  text REFERENCES district_set DEFERRABLE INITIALLY DEFERRED,   -- parliamentary elections only
    source_id        integer NOT NULL REFERENCES source ON DELETE CASCADE
);

-- Every election has round 1; 1990-2010 parliamentary elections also have round 2.
CREATE TABLE election_round (
    election_id  text NOT NULL REFERENCES election DEFERRABLE INITIALLY DEFERRED,
    round_no     smallint NOT NULL CHECK (round_no IN (1, 2)),
    round_date   date NOT NULL,
    source_id    integer NOT NULL REFERENCES source ON DELETE CASCADE,
    PRIMARY KEY (election_id, round_no)
);

-- Extra attributes of units of type 'smd' (single-member district).
-- unit.name holds the display name, e.g. 'Fejér 01'.
CREATE TABLE electoral_district (
    unit_id          text PRIMARY KEY REFERENCES unit DEFERRABLE INITIALLY DEFERRED CHECK (unit_id LIKE 'smd-%'),
    district_set_id  text NOT NULL REFERENCES district_set DEFERRABLE INITIALLY DEFERRED,
    county_unit_id   text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED CHECK (county_unit_id LIKE 'county-%'),
    number           smallint NOT NULL,
    seat_unit_id     text REFERENCES unit DEFERRABLE INITIALLY DEFERRED,       -- seat (székhely) settlement
    source_id        integer NOT NULL REFERENCES source ON DELETE CASCADE,
    UNIQUE (district_set_id, county_unit_id, number)
);

-- Which settlements / Budapest districts belong to which electoral district.
-- Many-to-many: a big city split between districts has one row per district.
CREATE TABLE district_membership (
    local_unit_id     text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED
                      CHECK (local_unit_id LIKE 'settlement-%' OR local_unit_id LIKE 'bp\_district-%'),
    district_unit_id  text NOT NULL REFERENCES electoral_district DEFERRABLE INITIALLY DEFERRED,
    source_id         integer NOT NULL REFERENCES source ON DELETE CASCADE,
    PRIMARY KEY (local_unit_id, district_unit_id)
);
CREATE INDEX district_membership_district_idx ON district_membership (district_unit_id);

-- Extra attributes of units of type 'polling_station'. A polling station exists for one election.
-- Its unit code convention: '<election_id>-<settlement code>-<number>'.
CREATE TABLE polling_station (
    unit_id           text PRIMARY KEY REFERENCES unit DEFERRABLE INITIALLY DEFERRED CHECK (unit_id LIKE 'polling\_station-%'),
    election_id       text NOT NULL REFERENCES election DEFERRABLE INITIALLY DEFERRED,
    local_unit_id     text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED
                      CHECK (local_unit_id LIKE 'settlement-%' OR local_unit_id LIKE 'bp\_district-%'),
    district_unit_id  text REFERENCES electoral_district DEFERRABLE INITIALLY DEFERRED,
    number            text NOT NULL,
    address           text,
    is_transfer       boolean NOT NULL DEFAULT false,   -- átjelentkezéses szavazókör
    source_id         integer NOT NULL REFERENCES source ON DELETE CASCADE,
    UNIQUE (election_id, local_unit_id, number)
);
CREATE INDEX polling_station_local_idx ON polling_station (local_unit_id);
