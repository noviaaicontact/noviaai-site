@echo off
chcp 65001 >nul
setlocal
title NoviaAI - Video explicative

cd /d "%~dp0..\.."
set "PYTHONIOENCODING=utf-8"
set "PY=%CD%\marketing\video-pipeline\.venv\Scripts\python.exe"

echo.
echo == NoviaAI : generation de la video explicative ==
echo.

echo [1/4] Serveur local sur le port 8888...
start "novia-serveur-explainer" /min "%PY%" -m http.server 8888 --bind 127.0.0.1
timeout /t 3 /nobreak >nul

echo [2/4] Capture des ecrans du SaaS (Playwright)...
call node "marketing\explainer\capture.mjs"
if errorlevel 1 goto :fin

echo.
echo [3/4] Voix-off francaise (OpenAI TTS)...
"%PY%" "marketing\explainer\voiceover.py"
if errorlevel 1 goto :fin

echo.
echo [4/4] Montage et encodage (plusieurs minutes)...
"%PY%" "marketing\explainer\assemble.py"

:fin
echo.
echo Arret du serveur local...
taskkill /fi "WINDOWTITLE eq novia-serveur-explainer*" /f >nul 2>&1

echo.
echo Video : marketing\explainer\output\noviaai-comment-ca-marche.mp4
echo.
pause
