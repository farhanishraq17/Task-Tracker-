@echo off
rem Stops a server started with start-background.vbs (or any process listening on port 3000).
set PORT=3000
if not "%~1"=="" set PORT=%~1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":%PORT% .*LISTENING"') do (
  echo Stopping process %%p on port %PORT%
  taskkill /PID %%p /F >nul 2>nul
)
echo Done.
