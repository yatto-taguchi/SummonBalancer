@echo off
chcp 65001 > nul
title Summon Balancer - 接続

:: =====================================================
:: ★ 設定：サーバーPCの名前（初回のみここを変更）
:: =====================================================
:: 起動.bat を実行したPCの名前（PC名）を入力してください。
:: 起動.bat の画面に「現在のこのPCの名前: ○○○○」と表示されます。
set SERVER_HOST=SALON-PC
:: =====================================================

set SERVER_URL=http://%SERVER_HOST%:8080

echo.
echo  ============================================
echo   Summon Balancer - クライアント接続
echo  ============================================
echo.
echo  接続先: %SERVER_URL%
echo.
echo  サーバーへの接続を確認しています...

powershell -Command "try { $null = Invoke-WebRequest -Uri '%SERVER_URL%' -TimeoutSec 5 -UseBasicParsing; exit 0 } catch { exit 1 }" > nul 2>&1

if %errorlevel% neq 0 (
    echo.
    echo  [!] サーバーに接続できませんでした。
    echo.
    echo  確認してください:
    echo    1. サーバー役PCで「起動.bat」が実行されているか
    echo    2. 両方のPCが同じWi-Fi（またはLAN）に接続されているか
    echo    3. このファイルの SERVER_HOST 設定が正しいか
    echo.
    echo  現在の設定: SERVER_HOST=%SERVER_HOST%
    echo.
    echo  設定変更方法:
    echo    この「接続.bat」ファイルを右クリック → 「編集」を選択
    echo    set SERVER_HOST=SALON-PC の部分を実際のPC名に変更して保存
    echo.
    pause
    exit /b
)

echo  [OK] 接続成功！ブラウザを開いています...
echo.
echo  ※ サーバーPC（起動.bat側）を閉じるとアクセスできなくなります
echo.
start %SERVER_URL%
pause