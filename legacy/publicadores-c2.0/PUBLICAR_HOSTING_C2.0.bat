@echo off
setlocal
cd /d "%~dp0"
firebase deploy --only hosting --project laparepa
if errorlevel 1 goto error
echo Hosting publicado. Presiona Ctrl+F5 al abrir el sistema.
pause
exit /b 0
:error
echo Error publicando Hosting.
pause
exit /b 1
