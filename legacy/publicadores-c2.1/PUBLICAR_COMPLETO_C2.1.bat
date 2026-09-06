@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title La Parepa C2.1 - Publicacion completa

set "PROJECT_ID=laparepa"

echo =====================================================
echo   LA PAREPA C2.1 - PUBLICACION FIREBASE COMPLETA
echo =====================================================
echo Carpeta: %CD%
echo Proyecto obligatorio: %PROJECT_ID%
echo.

where firebase >nul 2>&1
if errorlevel 1 goto firebase_no_encontrado

echo Version instalada de Firebase CLI:
call firebase --version
if errorlevel 1 goto error_cli

echo.
echo Publicando reglas de Firestore, indices, Storage y Hosting...
echo No cierres esta ventana durante el proceso.
echo.

REM IMPORTANTE: se usa CALL porque firebase suele resolver a firebase.cmd en Windows.
REM No se ejecuta "firebase use" porque .firebaserc ya fija laparepa y --project lo vuelve obligatorio.
call firebase deploy --only "firestore:rules,firestore:indexes,storage,hosting" --project "%PROJECT_ID%"
set "DEPLOY_EXIT=%ERRORLEVEL%"

if not "%DEPLOY_EXIT%"=="0" goto error_deploy

echo.
echo =====================================================
echo PUBLICACION TERMINADA CORRECTAMENTE EN %PROJECT_ID%
echo =====================================================
echo Abre el sistema publicado y presiona Ctrl+F5.
pause
exit /b 0

:firebase_no_encontrado
echo.
echo ERROR: no se encontro Firebase CLI en el PATH.
echo Ejecuta en otra consola: npm install -g firebase-tools
echo Luego cierra y vuelve a abrir CMD.
pause
exit /b 2

:error_cli
echo.
echo ERROR: Firebase CLI no pudo iniciar correctamente.
echo Cierra todas las consolas, abre una nueva y ejecuta:
echo   firebase --version
echo   node --version
echo Si vuelve a aparecer UV_HANDLE_CLOSING, actualiza Firebase CLI.
pause
exit /b 3

:error_deploy
echo.
echo =====================================================
echo ERROR: Firebase devolvio el codigo %DEPLOY_EXIT%.
echo =====================================================
echo Ejecuta este comando para obtener un registro detallado:
echo   firebase deploy --only "firestore:rules,firestore:indexes,storage,hosting" --project "%PROJECT_ID%" --debug
pause
exit /b %DEPLOY_EXIT%
