@echo off
rem Run the ETL command line from the repo root:   .\etl db up    .\etl build    .\etl test
rem
rem Why a wrapper instead of plain `uv run etl`:
rem  * The Python environment is kept on this machine's local disk (not in the repo folder), so
rem    the repo can live on a network drive and be used from several PCs at once.
rem  * `python -m etl` avoids uv's etl.exe launcher, which cannot load DLLs from network paths.
setlocal
if not defined UV_PROJECT_ENVIRONMENT set "UV_PROJECT_ENVIRONMENT=%LOCALAPPDATA%\hu-data-platform\etl-venv"
uv run --quiet --project "%~dp0etl" python -m etl %*
