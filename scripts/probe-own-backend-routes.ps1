# Probe-скрипт живого own-бэкенда (runbook docs/deployment/own-backend.md):
# health/ready-проверки + таблица роутов 401-vs-404 БЕЗ аутентификации.
# 401/403 = роут существует и закрыт авторизацией; 404 «Not Found» = роута
# нет (стек собран из старого кода). Одна строка PASS/FAIL на роут.
#
# Использование: powershell -File scripts/probe-own-backend-routes.ps1 [-ApiUrl http://localhost:8000/api/v1]

param(
    [string]$ApiUrl = 'http://localhost:8000/api/v1'
)

$ErrorActionPreference = 'Stop'

function Get-Status([string]$Method, [string]$Url) {
    try {
        $request = [System.Net.HttpWebRequest]::Create($Url)
        $request.Method = $Method
        $request.Timeout = 10000
        try { $response = $request.GetResponse() } catch [System.Net.WebException] { $response = $_.Exception.Response }
        if ($null -eq $response) { return 0 }
        $code = [int]$response.StatusCode
        $response.Close()
        return $code
    } catch {
        return 0
    }
}

$failures = 0

function Assert-Health([string]$Name, [string]$Url, [int[]]$Acceptable = @(200)) {
    $code = Get-Status 'GET' $Url
    $ok = $Acceptable -contains $code
    if (-not $ok) { $script:failures++ }
    Write-Host ("{0,-14} {1} {2} (got {3})" -f $Name, $(if ($ok) { 'PASS' } else { 'FAIL' }), $Url, $code)
}

function Assert-Route([string]$Method, [string]$Path, [int[]]$Exists = @(401, 403)) {
    $code = Get-Status $Method "$ApiUrl$Path"
    $ok = $Exists -contains $code
    if (-not $ok) { $script:failures++ }
    $mark = if ($ok) { 'PASS' } else { 'FAIL' }
    $hint = if ($code -eq 404) { ' <- route MISSING (stale image?)' } else { '' }
    Write-Host ("{0,-14} {1,-6} {2}{3} (got {4})" -f $mark, $Method, $Path, $hint, $code)
}

Assert-Health 'health' 'http://localhost:8000/health'
Assert-Health 'ready' 'http://localhost:8000/ready'
Assert-Health 'storage' 'http://localhost:9000/health'

# chat-leave (2026-11-01) — отсутствовали на устаревшем контейнере
Assert-Route 'DELETE' '/chats/1/members/1'
Assert-Route 'POST' '/chats/1/leave'
Assert-Route 'POST' '/chats/1/rejoin'

# 2026-11-05-messenger-ux-pack
Assert-Route 'PUT' '/chats/1'
Assert-Route 'POST' '/chats/read-all'

# '@'-поиск: без авторизации это тоже 401, не 404
Assert-Route 'GET' '/chats/search?q=@probe'

if ($failures -gt 0) {
    Write-Host "probe: FAIL ($failures failures)" -ForegroundColor Red
    exit 1
}

Write-Host 'probe: PASS (all routes answered by auth, none missing)'
