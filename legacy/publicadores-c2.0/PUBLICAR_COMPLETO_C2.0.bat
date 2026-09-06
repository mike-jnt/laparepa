@echo off
setlocal
cd /d "%~dp0"
echo Validando proyecto Firebase...
firebase use laparepa
if errorlevel 1 goto error
echo Publicando reglas, indices, Storage y Hosting...
firebase deploy --only firestore:rules,firestore:indexes,storage,hosting --project laparepa
if errorlevel 1 goto error
echo.
echo Publicacion terminada. Abre el sistema y presiona Ctrl+F5.
pause
exit /b 0
:error
echo.
echo ERROR: no se pudo completar la publicacion.
pause
exit /b 1
