@echo off
chcp 65001 >nul
title Detener Serenazgo
echo Deteniendo servidor en puerto 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000"') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo Servidor detenido.
timeout /t 2 /nobreak >nul

