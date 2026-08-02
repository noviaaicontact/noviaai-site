@echo off
chcp 65001 >nul
title NoviaAI — Passer Stripe en LIVE
cd /d "%~dp0"

echo.
echo  ═══════════════════════════════════════════════
echo   Stripe LIVE — noviaai.ca
echo  ═══════════════════════════════════════════════
echo.
echo  AVANT de continuer :
echo.
echo   1. Ouvrez https://dashboard.stripe.com/apikeys
echo   2. DESACTIVEZ le mode test (toggle en haut a droite)
echo   3. Copiez la cle secrete : sk_live_...
echo   4. Collez-la dans :
echo      ..\rattrapeur-sms\.env
echo      ligne STRIPE_SECRET_KEY=sk_live_...
echo.
echo   5. Activez votre compte Stripe (identite + compte bancaire)
echo.
pause

npm run stripe:go-live
echo.
pause
