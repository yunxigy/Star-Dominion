[CmdletBinding()]
param(
    [switch]$WithoutFrontends
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifestPath = Join-Path $PSScriptRoot 'local-services.json'
. (Join-Path $PSScriptRoot 'local-services.ps1')
$runtimeRoot = Join-Path $workspaceRoot '.runtime'
$logRoot = Join-Path $runtimeRoot 'logs'
$envFile = Join-Path $workspaceRoot '.env.local'

function Import-LocalEnvironment {
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
        throw "Missing .env.local. Copy .env.local.example and fill the required secrets."
    }
    foreach ($line in Get-Content -LiteralPath $envFile -Encoding utf8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2) { throw "Invalid .env.local entry." }
        [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], 'Process')
    }
    if ([string]::IsNullOrWhiteSpace($env:SITE_AUTH_INTERNAL_KEY) -or $env:SITE_AUTH_INTERNAL_KEY.Length -lt 32) {
        throw 'SITE_AUTH_INTERNAL_KEY must contain at least 32 characters.'
    }
    if ([string]::IsNullOrWhiteSpace($env:SITE_AUTH_ALLOWED_ORIGINS)) {
        throw 'SITE_AUTH_ALLOWED_ORIGINS is required.'
    }
}

function Get-ListeningProcessId([int]$Port) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $listener) { return $null }
    return [int]$listener.OwningProcess
}

function Wait-ServicePort([int[]]$Ports, $Process, [int]$TimeoutSeconds=30) {
    $deadline = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "Process $($Process.Id) exited before opening ports $($Ports -join ','). Check .runtime/logs."
        }
        $ready = $true
        foreach ($port in $Ports) {
            if ((Get-ListeningProcessId $port) -ne $Process.Id) { $ready = $false; break }
        }
        if ($ready) { return }
        Start-Sleep -Milliseconds 250
    } while ([datetime]::UtcNow -lt $deadline)
    throw "Process $($Process.Id) did not open ports $($Ports -join ',') within $TimeoutSeconds seconds."
}

function Start-ManagedService($Service) {
    $directoryCandidate = if ([System.IO.Path]::IsPathRooted($Service.working_directory)) {
        $Service.working_directory
    } else {
        Join-Path $workspaceRoot $Service.working_directory
    }
    $workingDirectory = (Resolve-Path -LiteralPath $directoryCandidate).Path
    $executable = (Get-Command $Service.executable -ErrorAction Stop).Source
    $commandFingerprint = "{0} {1}" -f $Service.executable, ($Service.arguments -join ' ')
    $metadataPath = Join-Path $runtimeRoot ($Service.name + '.json')
    $existingMetadata = $null
    if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
        $existingMetadata = Get-Content -Raw -LiteralPath $metadataPath -Encoding utf8 | ConvertFrom-Json
    }

    foreach ($port in $Service.ports) {
        $listenerPid = Get-ListeningProcessId $port
        if ($null -eq $listenerPid) { continue }
        if ($null -ne $existingMetadata -and $listenerPid -eq [int]$existingMetadata.pid) {
            Write-Host ("SKIP {0,-18} already running on {1}" -f $Service.name, $port)
            return
        }
        throw "Port $port is already owned by unrelated PID $listenerPid; $($Service.name) was not started."
    }

    if ($null -ne $existingMetadata) {
        $stale = Get-Process -Id ([int]$existingMetadata.pid) -ErrorAction SilentlyContinue
        if ($null -eq $stale) { Remove-Item -LiteralPath $metadataPath -Force }
    }

    $stdout = Join-Path $logRoot ($Service.name + '.out.log')
    $stderr = Join-Path $logRoot ($Service.name + '.err.log')
    $process = Start-Process -FilePath $executable `
        -ArgumentList $Service.arguments `
        -WorkingDirectory $workingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    $process.Refresh()
    [ordered]@{
        name = $Service.name
        pid = $process.Id
        process_start_utc = $process.StartTime.ToUniversalTime().ToString('o')
        working_directory = $workingDirectory
        executable = $executable
        command_fingerprint = $commandFingerprint
        ports = @($Service.ports)
        health_url = if ($Service.PSObject.Properties['health_url']) { [string]$Service.health_url } else { $null }
    } | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8
    Wait-ServicePort -Ports $Service.ports -Process $process
    Write-Host ("START {0,-17} PID {1}" -f $Service.name, $process.Id)
}

Import-LocalEnvironment
$env:PYTHONPATH = if ([string]::IsNullOrWhiteSpace($env:PYTHONPATH)) {
    $workspaceRoot
} else {
    "$workspaceRoot;$($env:PYTHONPATH)"
}
New-Item -ItemType Directory -Force -Path $runtimeRoot, $logRoot | Out-Null
if ([string]::IsNullOrWhiteSpace($env:STOCK_XHS_MCP_COMMAND)) {
    $env:STOCK_XHS_MCP_COMMAND = 'npx.cmd -y rednote-mcp@0.2.3 --stdio'
}
if ([string]::IsNullOrWhiteSpace($env:STOCK_XHS_DATA_DIR)) {
    $env:STOCK_XHS_DATA_DIR = Join-Path $workspaceRoot 'stock-research-package\stock-module\data\xhs-mcp'
}
New-Item -ItemType Directory -Force -Path $env:STOCK_XHS_DATA_DIR | Out-Null
$shouDirectory = Get-ChildItem -LiteralPath $workspaceRoot -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'server\middleware\site_auth_client.py') } |
    Select-Object -First 1 -ExpandProperty FullName
if ([string]::IsNullOrWhiteSpace($shouDirectory)) {
    throw 'ShouAnRen service directory was not found.'
}

$manifest = Get-LocalServiceManifest -Path $manifestPath
$shouService = @($manifest.services | Where-Object { $_.name -eq 'shouanren' }) | Select-Object -First 1
if ($null -ne $shouService) { $shouService.working_directory = $shouDirectory }
$services = @($manifest.services | Where-Object {
    -not $WithoutFrontends -or
    -not $_.PSObject.Properties['frontend'] -or
    $_.frontend -ne $true
})

foreach ($service in $services) { Start-ManagedService $service }
Write-Host 'Local services launched. Run scripts/check-local.ps1 after startup completes.'
