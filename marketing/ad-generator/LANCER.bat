@echo off
cd /d "%~dp0"
echo NoviaAI — Pub en 1 clic (concept + image)
..\video-pipeline\.venv\Scripts\python app.py %*
