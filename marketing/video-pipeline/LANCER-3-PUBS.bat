@echo off
chcp 65001 >nul
cd /d "%~dp0"
call .venv\Scripts\activate.bat 2>nul
if not exist ".venv\Scripts\python.exe" (
  py -m venv .venv
  call .venv\Scripts\activate.bat
  pip install -r requirements.txt
)
echo.
echo  3 pubs sans musique : plombier, garage, salon
echo.
python generate_pubs_3_niches.py
echo.
if exist "pubs\pub_plombier_LATEST.mp4" start "" "pubs\pub_plombier_LATEST.mp4"
pause
