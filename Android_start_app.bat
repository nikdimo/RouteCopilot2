@echo off
title Android - Start app
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0run-android-with-emulator.ps1"
pause
