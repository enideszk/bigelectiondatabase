"""Command line interface: `etl --help`.

Run from the etl/ folder with `uv run etl ...`, or activate etl/.venv and run `etl ...`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import typer

from . import config, db

app = typer.Typer(help="Hungarian election & socio-demographic data platform.", no_args_is_help=True)
db_app = typer.Typer(help="Database schema: migrations, status, reset, refresh.", no_args_is_help=True)
seed_app = typer.Typer(help="Load development data.", no_args_is_help=True)
app.add_typer(db_app, name="db")
app.add_typer(seed_app, name="seed")


def _show(path: Path) -> str:
    """Path relative to the repo root when possible (shorter and readable on network drives)."""
    try:
        return str(path.absolute().relative_to(config.REPO_ROOT))
    except ValueError:
        return str(path)


@app.callback()
def _setup() -> None:
    # Hungarian names must print on any Windows console / pipe.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


# --- etl db ... ------------------------------------------------------------------------------


@db_app.command("up")
def db_up() -> None:
    """Apply pending migrations from db/migrations/."""
    with db.connect() as conn:
        applied = db.migrate(conn)
    if applied:
        for m in applied:
            typer.echo(f"applied {m.path.name}")
    else:
        typer.echo("Database is up to date.")


@db_app.command("status")
def db_status() -> None:
    """Show applied and pending migrations."""
    with db.connect() as conn:
        applied = db.applied_migrations(conn)
        pending = db.pending_migrations(conn)
    for version, (file_name, _) in sorted(applied.items()):
        typer.echo(f"  applied  {file_name}")
    for m in pending:
        typer.echo(f"  PENDING  {m.path.name}")
    typer.echo(f"{len(applied)} applied, {len(pending)} pending.")


@db_app.command("reset")
def db_reset(yes: bool = typer.Option(False, "--yes", help="Do not ask for confirmation.")) -> None:
    """Delete ALL tables and data, then apply all migrations again. Development only."""
    url = config.database_url()
    if not yes:
        typer.confirm(f"This deletes every table and row in {url.rsplit('/', 1)[-1]}. Continue?", abort=True)
    with db.connect(url) as conn:
        db.reset(conn)
        applied = db.migrate(conn)
    typer.echo(f"Database reset; {len(applied)} migrations applied.")


@db_app.command("refresh")
def db_refresh() -> None:
    """Recompute the aggregated materialized views (mv_*)."""
    with db.connect() as conn:
        db.refresh_aggregates(conn)
    typer.echo("Aggregates refreshed.")


# --- etl seed / load -------------------------------------------------------------------------


@seed_app.command("fixtures")
def seed_fixtures(
    force: bool = typer.Option(False, "--force", help="Load even if the database holds other (real) sources."),
) -> None:
    """Load the FAKE fixture dataset from data/fixtures/ (replaces a previous fixture load)."""
    from .loaders import fixtures

    with db.connect() as conn:
        counts = fixtures.run(conn, force=force)
    for table, n in counts.items():
        typer.echo(f"  {table:<22} {n:>6}")
    typer.echo("Fixture data loaded (FAKE data, for development only).")


@app.command("load")
def load(
    name: str = typer.Argument(..., help="Loader name, see `etl loaders`."),
    step: str = typer.Option("all", help="clean (raw -> interim), load (interim -> database) or all."),
) -> None:
    """Run one loader: raw -> interim -> database."""
    from .loaders import LOADERS

    if name not in LOADERS:
        raise typer.BadParameter(f"Unknown loader {name!r}. Known: {', '.join(sorted(LOADERS)) or '(none yet)'}")
    module = LOADERS[name]
    if step in ("clean", "all"):
        written = module.clean(config.raw_dir(), config.interim_dir())
        for path in written:
            typer.echo(f"wrote {_show(path)}")
    if step in ("load", "all"):
        with db.connect() as conn:
            counts = module.load(conn, config.interim_dir())
            db.refresh_aggregates(conn)
        for table, n in counts.items():
            typer.echo(f"  {table:<22} {n:>6}")


@app.command("loaders")
def list_loaders() -> None:
    """List registered loaders."""
    from .loaders import LOADERS

    for name, module in sorted(LOADERS.items()):
        typer.echo(f"  {name:<24} {module.SOURCE.name}")
    if not LOADERS:
        typer.echo("No loaders registered yet. See docs/adding-a-source.md.")


# --- etl export / tiles / build / check --------------------------------------------------------


@app.command("export")
def export(out: Path = typer.Option(config.EXPORT_DIR, help="Output folder.")) -> None:
    """Write the website's static JSON files (refreshes aggregates first)."""
    from .export import export_all

    with db.connect() as conn:
        db.refresh_aggregates(conn)
        stats = export_all(conn, out)
    typer.echo(f"Exported {stats['units']} unit files and {stats['elections']} election files to {_show(out)}")


@app.command("tiles")
def tiles(
    out: Path = typer.Option(config.TILES_PATH, help="Output .pmtiles file."),
    max_zoom: int = typer.Option(10, help="Highest zoom level to cut (the map overzooms beyond it)."),
) -> None:
    """Cut vector tiles from unit_geometry with PostGIS and pack them into a PMTiles file."""
    from .tiles import build_pmtiles

    with db.connect() as conn:
        stats = build_pmtiles(conn, out, max_zoom=max_zoom)
    typer.echo(f"Wrote {stats['tiles']} tiles ({stats['bytes'] / 1024:.0f} KiB) to {_show(out)}")


@app.command("build")
def build(max_zoom: int = typer.Option(10, help="Highest tile zoom level.")) -> None:
    """export + tiles in one go."""
    export(config.EXPORT_DIR)
    tiles(config.TILES_PATH, max_zoom)


@app.command("test", context_settings={"allow_extra_args": True, "ignore_unknown_options": True})
def test(ctx: typer.Context) -> None:
    """Run the Python test suite (pytest) against TEST_DATABASE_URL. Extra arguments go to pytest."""
    import pytest

    raise typer.Exit(pytest.main([str(config.REPO_ROOT / "etl" / "tests"), *ctx.args]))


@app.command("check")
def check() -> None:
    """Run data-quality checks (double counting, missing parents, ...). Exit code 1 on errors."""
    from .checks import run_checks

    with db.connect() as conn:
        db.refresh_aggregates(conn)
        problems = run_checks(conn)
    errors = 0
    for problem in problems:
        typer.echo(f"[{problem.level}] {problem.check}: {problem.message}")
        errors += problem.level == "ERROR"
    typer.echo(f"{len(problems)} problems, {errors} errors." if problems else "All checks passed.")
    raise typer.Exit(1 if errors else 0)


if __name__ == "__main__":
    app()
