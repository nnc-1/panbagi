@echo off
rem panbagi installer / updater for Windows. Double-click to run.
chcp 65001 >nul
cd /d "%~dp0"
title 판박이 설치/업데이트

rem Node.js: a copy in .node\ (made below) or an installed one (20 or newer).
if exist ".node\node.exe" set "PATH=%~dp0.node;%PATH%"
node -e "process.exit(+process.versions.node.split('.')[0]<20)" >nul 2>nul
if errorlevel 1 (
  echo Node.js가 없어서 이 폴더 안에 받을게요. 설치는 하지 않아요. 1~2분 걸려요...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\get-node.ps1"
  if errorlevel 1 (
    echo.
    echo Node.js를 받지 못했어요. 열리는 페이지에서 LTS 버전을 설치한 뒤 다시 실행하세요.
    start "" https://nodejs.org/ko/download
    pause
    exit /b 1
  )
  set "PATH=%~dp0.node;%PATH%"
)

echo 필요한 부품을 받고 있어요. 처음에는 1~3분 걸려요...
call npm install --no-fund --no-audit --loglevel=error
if errorlevel 1 (
  echo.
  echo 부품을 받지 못했어요. 인터넷 연결을 확인하고 다시 실행하세요.
  pause
  exit /b 1
)

node scripts\setup.mjs
echo.
pause
