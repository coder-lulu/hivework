@echo off
setlocal DisableDelayedExpansion
"%~dp0..\resources\sidecar\runtime\python.exe" -I "%~dp0..\resources\sidecar\launch.py" %*
exit /b %errorlevel%
