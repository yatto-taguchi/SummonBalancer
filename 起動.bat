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
python --version > nul 2>&1
if %errorlevel% == 0 ( set PYTHON_CMD=python & goto :python_found )
py --version > nul 2>&1
if %errorlevel% == 0 ( set PYTHON_CMD=py & goto :python_found )
python3 --version > nul 2>&1
if %errorlevel% == 0 ( set PYTHON_CMD=python3 & goto :python_found )

echo  [!] Python がインストールされていません。
echo.
echo  インストール方法:
echo    A) Microsoft Store から（推奨・簡単）
echo    B) python.org から手動ダウンロード
echo.
set /p INSTALL_CHOICE=  [A] Microsoft Store  [B] python.org  : 

if /i "!INSTALL_CHOICE!"=="A" (
    start ms-windows-store://pdp/?productid=9NCVDN91XZQP
    echo  インストール完了後 Enter を押してください。
    echo  ★ インストール後にPCを再起動が必要な場合があります ★
    pause
    goto :retry
)
if /i "!INSTALL_CHOICE!"=="B" (
    start https://www.python.org/downloads/
    echo  ★ 必ず "Add Python to PATH" にチェックを入れてください ★
    echo  インストール完了後 Enter を押してください。
    pause
    goto :retry
)
goto :end

:retry
python --version > nul 2>&1
if %errorlevel% == 0 ( set PYTHON_CMD=python & goto :python_found )
py --version > nul 2>&1
if %errorlevel% == 0 ( set PYTHON_CMD=py & goto :python_found )
echo  [!] まだ Python が見つかりません。PCを再起動してから再度実行してください。
pause
goto :end

:python_found
echo  [OK] Python が見つかりました: %PYTHON_CMD%
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
echo   起動完了！ブラウザが自動で開きます。
echo  =====================================================
echo.
echo  このPC（サーバー役）から開く場合:
echo    http://localhost:8080
echo.
echo  他のPC（2台目）から接続する場合:
echo    http://!MY_IP!:8080
echo    または http://!MY_HOSTNAME!:8080
echo.
echo  ★ 接続.bat の SERVER_HOST に上記のPC名を設定してください ★
echo    → 現在のこのPCの名前: !MY_HOSTNAME!
echo.
echo  この黒い画面は開いたままにしてください（閉じるとサーバーが停止します）
echo  =====================================================
echo.

start "" cmd /c "timeout /t 2 > nul && start http://localhost:8080"

cd /d "%~dp0"
%PYTHON_CMD% server.py

:end
pause