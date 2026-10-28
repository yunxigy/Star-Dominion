[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$platformRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $platformRoot '.env.local'
. (Join-Path $PSScriptRoot 'local-services.ps1')
$manifestPath = Get-LocalServiceManifestPath -ScriptRoot $PSScriptRoot
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

$extraChecks = @(
    @{ service='stock-hub'; name='stock directory'; url='http://127.0.0.1:8002/api/v1/stocks/search?q=600'; status=200 },
    @{ service='stock-hub'; name='stock private anonymous'; url='http://127.0.0.1:8002/api/v1/model-profiles'; status=401 },
    @{ service='stm32'; name='STM32 data'; url='http://127.0.0.1:8007/data'; status=200 },
    @{ service='shouanren'; name='ShouAnRen anonymous'; url='http://127.0.0.1:8006/api/chat/characters'; status=401 },
    @{ service='research-reports'; name='reports current issue'; url='http://127.0.0.1:8009/api/v1/issues/current'; status=200 },
    @{ service='research-reports'; name='reports admin anonymous'; url='http://127.0.0.1:8009/api/v1/admin/collections'; status=401 },
    @{ service='document-converter'; name='converter capabilities'; url='http://127.0.0.1:8010/api/v1/capabilities'; status=200 }
)
foreach ($check in $extraChecks) {
    if (@($manifest.services.name) -contains $check.service) {
        Test-Http $check.name $check.url $check.status | Out-Null
    }
}
if (@($manifest.services.name) -contains 'site-auth' -and
    -not [string]::IsNullOrWhiteSpace($env:SITE_ADMIN_IDENTITY) -and
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
    } catch { Report 'authenticated smoke checks' $false $_.Exception.Message }
}
if ($failures -gt 0) { exit 1 }
Write-Host 'All configured local smoke checks passed.'
