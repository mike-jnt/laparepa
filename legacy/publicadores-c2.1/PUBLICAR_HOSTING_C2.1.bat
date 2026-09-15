@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title La Parepa C2.1 - Publicacion Hosting
set "PROJECT_ID=laparepa"

echo Publicando solamente Firebase Hosting en %PROJECT_ID%...
where firebase >nul 2>&1
if errorlevel 1 goto firebase_no_encontrado

REM CALL es obligatorio cuando firebase se ejecuta como firebase.cmd desde otro BAT.
call firebase deploy --only hosting --project "%PROJECT_ID%"
set "DEPLOY_EXIT=%ERRORLEVEL%"
if not "%DEPLOY_EXIT%"=="0" goto error

echo.
echo Hosting publicado correctamente. Presiona Ctrl+F5 al abrir el sistema.
pause
exit /b 0

:firebase_no_encontrado
echo Firebase CLI no esta instalado o no aparece en PATH.
pause
exit /b 2

:error
echo Error publicando Hosting. Codigo: %DEPLOY_EXIT%
pause
exit /b %DEPLOY_EXIT%
