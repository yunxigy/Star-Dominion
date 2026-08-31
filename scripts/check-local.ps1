[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $workspaceRoot '.env.local'
$manifestPath = Join-Path $PSScriptRoot 'local-services.json'
. (Join-Path $PSScriptRoot 'local-services.ps1')
$manifest = Get-LocalServiceManifest -Path $manifestPath
$failures = 0

function Import-LocalEnvironment {
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { return }
    foreach ($line in Get-Content -LiteralPath $envFile -Encoding utf8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -eq 2) {
            [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], 'Process')
        }
    }
}

function Report([string]$Name, [bool]$Passed, [string]$Message='') {
    if ($Passed) {
        Write-Host ("PASS {0,-32} {1}" -f $Name, $Message) -ForegroundColor Green
    } else {
        Write-Host ("FAIL {0,-32} {1}" -f $Name, $Message) -ForegroundColor Red
        $script:failures += 1
    }
}

function Test-Port([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $task.Wait(1500)) { return $false }
        return $client.Connected
    } catch { return $false } finally { $client.Dispose() }
}

function Test-Http([string]$Name, [string]$Uri, [int]$ExpectedStatus, $WebSession=$null) {
    $statusCode = $null
    try {
        $parameters = @{ Uri=$Uri; Method='GET'; TimeoutSec=5; UseBasicParsing=$true }
        if ($null -ne $WebSession) { $parameters.WebSession = $WebSession }
        $response = Invoke-WebRequest @parameters
        $statusCode = [int]$response.StatusCode
    } catch {
        if ($null -ne $_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        } else {
            Report $Name $false $_.Exception.Message
            return
        }
    }
    Report $Name ($statusCode -eq $ExpectedStatus) "HTTP $statusCode"
}

Import-LocalEnvironment
$manifestPorts = @($manifest.services | ForEach-Object { @($_.ports) })
foreach ($port in $manifestPorts) { Report "port $port" (Test-Port $port) }
foreach ($service in @($manifest.services)) {
    if ($service.PSObject.Properties['health_url'] -and -not [string]::IsNullOrWhiteSpace([string]$service.health_url)) {
        Test-Http "$($service.name) health contract" ([string]$service.health_url) 200 | Out-Null
    }
}

Test-Http 'site-auth health' 'http://127.0.0.1:8000/health' 200 | Out-Null
Test-Http 'Openwrite health' 'http://127.0.0.1:8001/api/health' 200 | Out-Null
Test-Http 'stock public health' 'http://127.0.0.1:8002/api/v1/health' 200 | Out-Null
Test-Http 'stock directory search' 'http://127.0.0.1:8002/api/v1/stocks/search?q=600' 200 | Out-Null
Test-Http 'mom index history' 'http://127.0.0.1:8002/api/v1/mom-index/history?limit=1' 200 | Out-Null
Test-Http 'stock analysis health' 'http://127.0.0.1:8003/api/v1/health' 200 | Out-Null
Test-Http 'plagiarism health' 'http://127.0.0.1:8005/api/plagiarism/health' 200 | Out-Null
Test-Http 'ShouAnRen health' 'http://127.0.0.1:8006/api/health' 200 | Out-Null
Test-Http 'STM32 data' 'http://127.0.0.1:8007/data' 200 | Out-Null
Test-Http 'research reports health' 'http://127.0.0.1:8009/health' 200 | Out-Null
Test-Http 'research reports current issue' 'http://127.0.0.1:8009/api/v1/issues/current' 200 | Out-Null
Test-Http 'document converter health' 'http://127.0.0.1:8010/health' 200 | Out-Null
Test-Http 'document converter capabilities' 'http://127.0.0.1:8010/api/v1/capabilities' 200 | Out-Null
Test-Http 'webmaster inspector health' 'http://127.0.0.1:8012/health' 200 | Out-Null
try {
    $videoHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8011/health' -Method GET -TimeoutSec 5
    $hasCapabilities = $null -ne $videoHealth.capabilities `
        -and $null -ne $videoHealth.capabilities.PSObject.Properties['ytDlp'] `
        -and $null -ne $videoHealth.capabilities.PSObject.Properties['ffmpeg']
    Report 'video downloader capabilities' $hasCapabilities
} catch {
    Report 'video downloader capabilities' $false $_.Exception.Message
}
Test-Http 'research reports admin anonymous' 'http://127.0.0.1:8009/api/v1/admin/collections' 401 | Out-Null
Test-Http 'stock private anonymous' 'http://127.0.0.1:8002/api/v1/model-profiles' 401 | Out-Null
Test-Http 'ShouAnRen chat anonymous' 'http://127.0.0.1:8006/api/chat/characters' 401 | Out-Null

if (-not [string]::IsNullOrWhiteSpace($env:SITE_ADMIN_IDENTITY) -and
    -not [string]::IsNullOrWhiteSpace($env:SITE_ADMIN_PASSWORD)) {
    try {
        $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
        $loginBody = @{ identity=$env:SITE_ADMIN_IDENTITY; password=$env:SITE_ADMIN_PASSWORD } | ConvertTo-Json
        $login = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/v1/session/login' `
            -Method POST -ContentType 'application/json' -Body $loginBody `
            -Headers @{ Origin='http://127.0.0.1:8013' } -WebSession $session `
            -UseBasicParsing -TimeoutSec 5
        Report 'site-auth login' ($login.StatusCode -eq 204) "HTTP $($login.StatusCode)"
        Test-Http 'site-auth authenticated me' 'http://127.0.0.1:8000/api/v1/session/me' 200 $session | Out-Null
        Test-Http 'stock authenticated profiles' 'http://127.0.0.1:8002/api/v1/model-profiles' 200 $session | Out-Null
        Test-Http 'ShouAnRen authenticated chat' 'http://127.0.0.1:8006/api/chat/characters' 200 $session | Out-Null
        Test-Http 'research reports admin collections' 'http://127.0.0.1:8009/api/v1/admin/collections' 200 $session | Out-Null
    } catch {
        Report 'authenticated smoke checks' $false $_.Exception.Message
    }
} else {
    Report 'authenticated smoke configuration' $false 'SITE_ADMIN_IDENTITY/PASSWORD missing in .env.local'
}

if ($failures -gt 0) { exit 1 }
Write-Host 'All local smoke checks passed.'
