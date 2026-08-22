param(
    [switch]$AutoYes
)

# Summon Balancer Deploy Script
# data/ フォルダ（予約・スタッフデータ）を保護して、コードだけを同期する

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$DeployTarget = "F:\Dropbox\1.litt\2.Litt共有ファイル\Summon Balancer"
$DevSource = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "   Summon Balancer - Deploy" -ForegroundColor Cyan
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host ""

# デプロイ先の存在確認
if (-not (Test-Path $DeployTarget)) {
    Write-Host "  [!] Deploy target not found:" -ForegroundColor Red
    Write-Host "      $DeployTarget" -ForegroundColor Red
    Write-Host ""
    Write-Host "  deploy.ps1 を編集して DeployTarget を正しく設定してください。"
    Read-Host "  Press Enter to exit"
    exit 1
}

Write-Host "  FROM: $DevSource"
Write-Host "  TO:   $DeployTarget"
Write-Host ""

# data/store.json の保護確認
if (Test-Path "$DeployTarget\data\store.json") {
    Write-Host "  [OK] data/store.json detected - PROTECTED" -ForegroundColor Green
} else {
    Write-Host "  [INFO] No data/store.json at target" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "  --- SYNC ---" -ForegroundColor White
Write-Host "   + index.html, server.py"
Write-Host "   + css/ (style)"
Write-Host "   + js/  (app logic)"
Write-Host "   + bat files"
Write-Host ""
Write-Host "  --- PROTECTED ---" -ForegroundColor White
Write-Host "   x data/  (reservations, staff, settings)"
Write-Host "   x .git/, .agents/, docs/"
Write-Host "   x test files, scratch files"
Write-Host ""

if (-not $AutoYes) {
    $confirm = Read-Host "  Deploy? (y/n)"
    if ($confirm -ne "y") {
        Write-Host "  Cancelled." -ForegroundColor Yellow
        Read-Host "  Press Enter to exit"
        exit 0
    }
}

Write-Host ""
Write-Host "  Deploying..." -ForegroundColor Cyan
Write-Host ""

# robocopy: /E=サブディレクトリ含む, /PURGE=ソースにないファイルを削除, /XD=除外ディレクトリ, /XF=除外ファイル
$robocopyArgs = @(
    "`"$DevSource`""
    "`"$DeployTarget`""
    "/E"
    "/PURGE"
    "/XD", "data", ".git", ".agents", "node_modules", "docs", "ui_reference", "__pycache__"
    "/XF", "browser_logs.txt", "server_log.txt", "*.md", "test_*.js", "scratch*.js", "pdf_content.txt", "*.pdf"
    "/R:3"
    "/W:1"
)

$process = Start-Process -FilePath "robocopy" -ArgumentList $robocopyArgs -NoNewWindow -Wait -PassThru
$exitCode = $process.ExitCode

if ($exitCode -le 7) {
    # デプロイ日時の記録（初回リロード時の通知用 & フォルダ内目印用）
    $now = Get-Date
    $deployedAt = $now.ToString("yyyy-MM-ddTHH:mm:sszzz")
    $displayTime = $now.ToString("M月d日 H:mm")
    $fullDisplayTime = $now.ToString("yyyy年M月d日 HH:mm:ss")

    $versionContent = @{
        deployedAt = $deployedAt
        displayTime = $displayTime
        fullTime = $fullDisplayTime
    } | ConvertTo-Json

    Set-Content -Path "$DevSource\version.json" -Value $versionContent -Encoding UTF8
    Set-Content -Path "$DeployTarget\version.json" -Value $versionContent -Encoding UTF8

    # フォルダ内でひと目で同期確認できる目印テキストファイルを作成
    $indicatorLines = @(
        "============================================================",
        " Summon Balancer - デプロイ完了情報",
        "============================================================",
        "最終デプロイ日時: $fullDisplayTime",
        "同期状態: 正常完了 (Code: $exitCode)",
        "対象フォルダ: $DeployTarget",
        "============================================================"
    )
    Set-Content -Path "$DeployTarget\_最終デプロイ日時.txt" -Value $indicatorLines -Encoding UTF8
    Set-Content -Path "$DevSource\_最終デプロイ日時.txt" -Value $indicatorLines -Encoding UTF8

    Write-Host ""
    Write-Host "  ============================================================" -ForegroundColor Green
    Write-Host "   [OK] Deploy complete! ($displayTime)" -ForegroundColor Green
    Write-Host "  ============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  - Code files synced safely"
    Write-Host "  - Reservation/staff data NOT affected"
    Write-Host "  - 目印ファイル作成: _最終デプロイ日時.txt ($fullDisplayTime)"
    Write-Host "  - version.json updated ($displayTime)"
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "  [!] Error occurred (code: $exitCode)" -ForegroundColor Red
    Write-Host ""
}

if (-not $AutoYes) {
    Read-Host "  Press Enter to exit"
}
