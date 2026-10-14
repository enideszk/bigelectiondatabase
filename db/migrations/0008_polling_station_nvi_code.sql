-- 0008: NVI's own code of a polling station, "MAZ-TAZ-SZK" (NVI county code, NVI settlement code,
-- station number). The website shows stations as MAZ-OEVK-TAZ-SZK. NVI's county and settlement
-- codes are not KSH codes (see CLAUDE.md), so they are kept as given.

ALTER TABLE polling_station ADD COLUMN nvi_code text;
