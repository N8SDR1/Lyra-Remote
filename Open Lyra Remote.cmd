@echo off
cd /d "%~dp0"
start "Lyra Remote" /MIN py -3 -m http.server 4173 --bind 127.0.0.1
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:4173/"
