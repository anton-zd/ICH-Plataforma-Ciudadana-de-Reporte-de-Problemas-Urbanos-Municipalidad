@echo off
title Sistema Serenazgo Chorrillos
color 0B
echo.
echo  ============================================================
echo   MUNICIPALIDAD DE CHORRILLOS - SISTEMA DE SERENAZGO
echo  ============================================================
echo.

cd /d "%~dp0"

REM Verify that Python is installed.
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or is not in PATH.
    echo Download Python from https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

REM Avoid launching a second server or terminating an unrelated process.
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if not errorlevel 1 (
    echo [ERROR] Port 3000 is already in use.
    echo Close the existing Serenazgo server before starting another instance.
    echo.
    pause
    exit /b 1
)

echo  [OK] Environment verified.
echo  [OK] Starting the server at http://localhost:3000/
echo.
echo  Citizen:  http://localhost:3000/ciudadano.html
echo  Operator: http://localhost:3000/dashboard
echo  Sereno:   http://localhost:3000/sereno
echo.
echo  ============================================================
echo  Press Ctrl+C to stop the server.
echo  ============================================================
echo.

python -X utf8 server_python.py

pause
