@echo off
setlocal
cd /d "%~dp0"
title Productivity Command Center

where node >nul 2>nul || (
  echo Node.js 22.13 or newer is required. Install it from https://nodejs.org and run this again.
  pause & exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install || (pause & exit /b 1)
)

if "%~1"=="--rebuild" del /q client\dist\index.html 2>nul
if not exist client\dist\index.html (
  echo Building the interface...
  call npm run build || (pause & exit /b 1)
)

echo.
echo Opening http://localhost:3000 ... keep this window open: it runs the reminder engine.
echo (Press Ctrl+C to stop.)
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:3000"
call npm start
pause
