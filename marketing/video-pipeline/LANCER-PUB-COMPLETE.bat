@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  PUB VIDEO NOVIAAI — generation complete (local, sans Pexels)
echo  =============================================================
echo.

if not exist ".venv\Scripts\python.exe" (
  echo Creation environnement Python...
  py -m venv .venv
  call .venv\Scripts\activate.bat
  pip install -r requirements.txt
) else (
  call .venv\Scripts\activate.bat
)

echo.
echo  Etape 1 : Pub narrative ^(B-roll + SMS mockup^)
echo  Etape 2 : Dashboard Playwright ^(si npm run dev actif^)
echo.

python generate_pub_master.py

if exist "pubs\pub_noviaai_LATEST.mp4" (
  echo.
  echo  VIDEO PRETE :
  echo  %CD%\pubs\pub_noviaai_LATEST.mp4
  start "" "pubs\pub_noviaai_LATEST.mp4"
)

pause
