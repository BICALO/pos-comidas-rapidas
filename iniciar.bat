@echo off
title Rolitas de Maiz - Sistema de Ventas
cd /d "%~dp0"
echo Iniciando el servidor...
start "Rolitas de Maiz - Servidor (no cerrar)" cmd /k npm start
timeout /t 4 /nobreak >nul
start http://localhost:3000
exit
