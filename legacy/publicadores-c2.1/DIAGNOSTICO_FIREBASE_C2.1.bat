@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Diagnostico Firebase La Parepa C2.1

echo ===== SISTEMA =====
ver

echo.
echo ===== NODE =====
where node 2>nul
if errorlevel 1 (
  echo Node no aparece en PATH.
) else (
  node --version
  npm --version
)

echo.
echo ===== FIREBASE CLI =====
where firebase 2>nul
if errorlevel 1 (
  echo Firebase CLI no aparece en PATH.
) else (
  call firebase --version
)

echo.
echo ===== PROYECTO DEL PAQUETE =====
type .firebaserc

echo.
echo Copia todo este resultado si el publicador vuelve a fallar.
pause
