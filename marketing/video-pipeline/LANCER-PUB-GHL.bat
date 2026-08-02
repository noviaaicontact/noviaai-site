@echo off
cd /d "%~dp0"
echo Pipeline GHL 100%% automatique — plombier
.venv\Scripts\python run_ghl_auto.py
if exist "pubs\pub_plombier_GHL_LATEST.mp4" start "" "pubs\pub_plombier_GHL_LATEST.mp4"
pause
