@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creation de l'environnement virtuel...
  py -m venv .venv
  call .venv\Scripts\activate.bat
  pip install -r requirements.txt
) else (
  call .venv\Scripts\activate.bat
)

if "%PEXELS_API_KEY%"=="" (
  echo.
  echo ATTENTION: PEXELS_API_KEY n'est pas definie.
  echo Obtenez une cle gratuite sur https://www.pexels.com/api/
  echo Puis: set PEXELS_API_KEY=votre_cle
  echo.
  pause
)
if "%UNSPLASH_ACCESS_KEY%"=="" (
  echo OPTIONNEL: UNSPLASH_ACCESS_KEY pour photos B-roll ^(unsplash.com/developers^)
  echo.
)

python run.py %*
pause
