@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%switch-windows-codepage.ps1"

if "%~1"=="" (
  echo Usage:
  echo   switch-windows-codepage.cmd status
  echo   switch-windows-codepage.cmd gbk
  echo   switch-windows-codepage.cmd utf8
  echo   switch-windows-codepage.cmd session-gbk
  echo   switch-windows-codepage.cmd session-utf8
  echo.
  echo For legacy Chinese apps with mojibake, use:
  echo   switch-windows-codepage.cmd gbk
  echo.
  pause
  exit /b 0
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Failed with exit code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
