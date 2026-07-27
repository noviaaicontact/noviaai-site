@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  DEMO VIDEO — Appel manque + SMS (simulation, sans login)
echo  =========================================================
echo.
echo  Terminal 1 (si pas deja fait) :
echo    npm run dev
echo.

set /p OK="Serveur actif sur localhost:8888 ? (O/N) "
if /i not "%OK%"=="O" (
  echo  Lancez npm run dev puis relancez ce script.
  pause
  exit /b 1
)

call npm install
call npx playwright install chromium
call npm run demo:video

pause
