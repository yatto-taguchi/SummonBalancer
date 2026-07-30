@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
title Summon Balancer - サーバー

echo.
echo  ============================================
echo   Summon Balancer - 起動チェック
echo  ============================================
echo.

set PYTHON_CMD=

if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set PYTHON_CMD="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    goto :python_found
)
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set PYTHON_CMD="%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    goto :python_found
)
if exist "%ProgramFiles%\Python312\python.exe" (
    set PYTHON_CMD="%ProgramFiles%\Python312\python.exe"
    goto :python_found
)

py --version > nul 2>&1
if %errorlevel% == 0 ( set PYTHON_CMD=py & goto :python_found )
python --version > nul 2>&1
if %errorlevel% == 0 ( set PYTHON_CMD=python & goto :python_found )
python3 --version > nul 2>&1
if %errorlevel% == 0 ( set PYTHON_CMD=python3 & goto :python_found )

echo  [!] Python がインストールされていません。
echo.
pause
goto :end

:python_found
echo  [OK] Python を検出しました: %PYTHON_CMD%
echo.

netstat -an | findstr ":8080 " | findstr "LISTENING" > nul 2>&1
if %errorlevel% == 0 (
    echo  [!] ポート 8080 はすでに起動済みです。ブラウザを開きます。
    start http://localhost:8080
    goto :end
)

for /f %%i in ('hostname') do set MY_HOSTNAME=%%i
set MY_IP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr "192.168"') do (
    set TEMP_IP=%%a
    set TEMP_IP=!TEMP_IP: =!
    if not "!TEMP_IP!"=="" set MY_IP=!TEMP_IP!
)
if "!MY_IP!"=="" (
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
        set TEMP_IP=%%a
        set TEMP_IP=!TEMP_IP: =!
        if not "!TEMP_IP!"=="" if "!MY_IP!"=="" set MY_IP=!TEMP_IP!
    )
)

echo  =====================================================
echo   起動中... ブラウザが自動的に開きます。
echo  =====================================================
echo.
echo  ・このPC（サーバー）で開く場合:
echo    http://localhost:8080
echo.
echo  ・別のPCから接続する場合:
echo    http://!MY_IP!:8080
echo    または http://!MY_HOSTNAME!:8080
echo.
echo  ※この黒い画面は開いたままにしてください（閉じるとサーバーが停止します）
echo  =====================================================
echo.

start "" cmd /c "timeout /t 2 > nul && start http://localhost:8080"

cd /d "%~dp0"
%PYTHON_CMD% server.py

:end
pause