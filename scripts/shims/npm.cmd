@echo off
if "%~1"=="--version" (
  echo 11.10.1
  exit /b 0
)

echo This npm shim only supports --version. Use Bun for project commands. 1>&2
exit /b 1
