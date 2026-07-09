@echo off
chcp 65001 >nul
title NoviaAI — MX Resend via API Namecheap
cd /d "%~dp0"

echo.
echo ═══════════════════════════════════════════════════════
echo   Ajout MX send.noviaai.ca (API Namecheap)
echo ═══════════════════════════════════════════════════════
echo.
echo Si pas encore fait:
echo   1. Namecheap - Profile - Tools - API Access - ON
echo   2. Whitelistez votre IP publique
echo   3. Ajoutez dans ..\rattrapeur-sms\.env :
echo        NAMECHEAP_API_USER=...
echo        NAMECHEAP_API_KEY=...
echo        NAMECHEAP_CLIENT_IP=...
echo.

node scripts\namecheap-add-resend-mx.mjs
if %ERRORLEVEL%==0 (
  echo.
  echo Puis sur Resend: Verify domain noviaai.ca
  echo Puis: npm run resend:prod
)
echo.
pause
