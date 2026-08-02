@echo off
cd /d "%~dp0"
echo NoviaAI — Pipeline production (framework + storyboard + dossier)
echo.
if "%~3"=="" (
  echo Usage: LANCER_PRODUCTION.bat [niche] [probleme] [objectif]
  echo Exemple: LANCER_PRODUCTION.bat plombier "appels manques" "obtenir des demos"
  exit /b 1
)
..\video-pipeline\.venv\Scripts\python run_production.py -n "%~1" -p "%~2" -o "%~3"
