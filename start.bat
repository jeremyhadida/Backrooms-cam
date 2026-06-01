@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js n'est pas installe.
  echo Telecharger sur : https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installation des dependances...
  npm install
)
if not exist recordings mkdir recordings
start "" http://localhost:3000
node server.js
pause
