@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  NoviaAI — Telechargement videos Pexels (gratuit)
echo  ================================================
echo.
if not exist ".env" (
  echo  Creez un fichier .env avec:
  echo    PEXELS_API_KEY=votre_cle
  echo.
  echo  Cle gratuite: https://www.pexels.com/api/
  echo.
  pause
  exit /b 1
)
node scripts\fetch-pexels-videos.cjs
echo.
pause
