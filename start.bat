@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PY="
where python >nul 2>nul
if %errorlevel%==0 set "PY=python"
if not defined PY (
  where py >nul 2>nul
  if %errorlevel%==0 set "PY=py"
)
if not defined PY (
  echo.
  echo   没找到 Python。请先安装 Python 3.8 以上版本，
  echo   或者直接用浏览器打开 index.html（直连模式，通常也能用）。
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动本地服务 http://127.0.0.1:8765 ...
echo.
start "" http://127.0.0.1:8765/
%PY% server.py
pause
