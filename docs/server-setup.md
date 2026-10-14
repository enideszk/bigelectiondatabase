# Database server (Server-PC)

PostgreSQL 18.6 with PostGIS 3.6.2 runs on Server-PC (192.168.0.253, Windows 10 Pro) as the
Windows service `postgresql-x64-18`, starting automatically.

| What | Where |
|---|---|
| Programs | `C:\Program Files\PostgreSQL\18` (on the machine PATH: `psql`, `pg_dump`, …) |
| Data | `L:\PostgreSQL\18\data` (C: is small) |
| Installers used | `L:\PostgreSQL\installers\` |
| Port | 5432, reachable from 192.168.0.0/24 only (pg_hba + Windows firewall rule "PostgreSQL 5432 (LAN)") |
| Databases | `hu_data` (main), `hu_data_test` (wiped by the tests), owner role `hudata` |
| App password | `.env` in the repo (gitignored) |
| Superuser `postgres` password | Server-PC, user oliver: `%APPDATA%\postgresql\pgpass.conf` |
| Logs | `L:\PostgreSQL\18\data\log\` |

## How it was installed (to redo it on another machine)

The EDB graphical installer fails when run over SSH, so the official EDB **binaries zip** was
used, as described in the PostgreSQL documentation for Windows. All commands in an elevated
PowerShell.

1. Download `postgresql-18.6-2-windows-x64-binaries.zip` (get.enterprisedb.com) and
   `postgis-bundle-pg18-3.6.2x64.zip` (download.osgeo.org/postgis/windows/pg18/).
2. Copy `pgsql\bin`, `lib`, `share`, `include` into `C:\Program Files\PostgreSQL\18`; copy the
   PostGIS bundle's `bin`, `lib`, `share`, `gdal-data` over it.
3. Create the cluster (superuser password in a temporary file):
   ```
   initdb -D L:\PostgreSQL\18\data -U postgres --pwfile=pw.txt -A scram-sha-256 -E UTF8 --locale-provider=builtin --builtin-locale=C.UTF-8 --locale=C
   icacls L:\PostgreSQL\18\data /grant "NT AUTHORITY\NetworkService:(OI)(CI)F" /T
   ```
4. Append to `postgresql.conf`: `listen_addresses = '*'` and `logging_collector = on`.
   Append to `pg_hba.conf`: `host all all 192.168.0.0/24 scram-sha-256`.
5. Register and start the service:
   ```
   pg_ctl register -N postgresql-x64-18 -U "NT AUTHORITY\NetworkService" -D L:\PostgreSQL\18\data -S auto
   ```
   Give the service PostGIS's data paths (services do not see new system variables until a
   reboot), as a multi-string value `Environment` under
   `HKLM\SYSTEM\CurrentControlSet\Services\postgresql-x64-18`:
   `PROJ_DATA=…\share\contrib\postgis-3.6\proj`, `PROJ_LIB=` (same), `GDAL_DATA=…\gdal-data`.
   Then `Start-Service postgresql-x64-18`.
6. Firewall: `New-NetFirewallRule -DisplayName 'PostgreSQL 5432 (LAN)' -Direction Inbound -Protocol TCP -LocalPort 5432 -RemoteAddress 192.168.0.0/24 -Action Allow -Profile Private,Domain`
7. Create role, databases and extensions:
   ```
   psql -h localhost -U postgres -d postgres -v app_password=SECRET -f db/bootstrap.sql
   ```
8. Put the password into `.env`, then `.\etl db up`.

Check that PROJ works: `SELECT ST_AsText(ST_Transform(ST_SetSRID(ST_MakePoint(650000, 240000), 23700), 4326));`
should return a point in Budapest (≈ 19.05, 47.50).

## Maintenance

- Backup: `pg_dump -h localhost -U postgres -Fc hu_data > hu_data.dump` (the database can also be
  rebuilt from the raw files with the loaders, which is the point of the design).
- Minor upgrades (18.x): stop the service, replace the program files with the new binaries zip
  (and the matching PostGIS bundle), start the service.
- Hosting the website: `npm run build` produces static files in `web/dist/`; serve them with
  Caddy (`C:\caddy\Caddyfile`) using `file_server`. Not set up yet.
