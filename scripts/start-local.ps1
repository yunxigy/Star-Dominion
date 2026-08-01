[CmdletBinding()]
param(
    [switch]$WithoutFrontends
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
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
    $directoryCandidate = if ([System.IO.Path]::IsPathRooted($Service.WorkingDirectory)) {
        $Service.WorkingDirectory
    } else {
        Join-Path $workspaceRoot $Service.WorkingDirectory
    }
    $workingDirectory = (Resolve-Path -LiteralPath $directoryCandidate).Path
    $executable = (Get-Command $Service.Executable -ErrorAction Stop).Source
    $metadataPath = Join-Path $runtimeRoot ($Service.Name + '.json')
    $existingMetadata = $null
    if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
        $existingMetadata = Get-Content -Raw -LiteralPath $metadataPath -Encoding utf8 | ConvertFrom-Json
    }

    foreach ($port in $Service.Ports) {
        $listenerPid = Get-ListeningProcessId $port
        if ($null -eq $listenerPid) { continue }
        if ($null -ne $existingMetadata -and $listenerPid -eq [int]$existingMetadata.pid) {
            Write-Host ("SKIP {0,-18} already running on {1}" -f $Service.Name, $port)
            return
        }
        throw "Port $port is already owned by unrelated PID $listenerPid; $($Service.Name) was not started."
    }

    if ($null -ne $existingMetadata) {
        $stale = Get-Process -Id ([int]$existingMetadata.pid) -ErrorAction SilentlyContinue
        if ($null -eq $stale) { Remove-Item -LiteralPath $metadataPath -Force }
    }

    $stdout = Join-Path $logRoot ($Service.Name + '.out.log')
    $stderr = Join-Path $logRoot ($Service.Name + '.err.log')
    $process = Start-Process -FilePath $executable `
        -ArgumentList $Service.Arguments `
        -WorkingDirectory $workingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    $process.Refresh()
    [ordered]@{
        name = $Service.Name
        pid = $process.Id
        process_start_utc = $process.StartTime.ToUniversalTime().ToString('o')
        working_directory = $workingDirectory
        executable = $executable
        ports = @($Service.Ports)
    } | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8
    Wait-ServicePort -Ports $Service.Ports -Process $process
    Write-Host ("START {0,-17} PID {1}" -f $Service.Name, $process.Id)
}

Import-LocalEnvironment
New-Item -ItemType Directory -Force -Path $runtimeRoot, $logRoot | Out-Null
if ([string]::IsNullOrWhiteSpace($env:STOCK_XHS_MCP_COMMAND)) {
    $env:STOCK_XHS_MCP_COMMAND = 'npx.cmd -y @sillyl12324/xhs-mcp@2.7.0'
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

$services = @(
    [pscustomobject]@{ Name='site-auth'; WorkingDirectory='site-auth'; Executable='python'; Arguments=@('-m','uvicorn','site_auth.main:create_app','--factory','--host','127.0.0.1','--port','8000'); Ports=@(8000) },
    [pscustomobject]@{ Name='openwrite'; WorkingDirectory='Openwrite-main'; Executable='python'; Arguments=@('start.py'); Ports=@(8001) },
    [pscustomobject]@{ Name='stock-hub'; WorkingDirectory='stock-research-package/stock-module/backend'; Executable='python'; Arguments=@('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8002'); Ports=@(8002) },
    [pscustomobject]@{ Name='stock-analysis'; WorkingDirectory='stock-research-package/stock-module/analysis-service'; Executable='python'; Arguments=@('-m','uvicorn','analysis_service.main:app','--host','127.0.0.1','--port','8003'); Ports=@(8003) },
    [pscustomobject]@{ Name='stock-gateway'; WorkingDirectory='stock-research-package/stock-module/backend'; Executable='python'; Arguments=@('-m','uvicorn','app.gateway_main:app','--host','127.0.0.1','--port','8004'); Ports=@(8004) },
    [pscustomobject]@{ Name='plagiarism'; WorkingDirectory='plagiarism'; Executable='python'; Arguments=@('main.py'); Ports=@(8005) },
    [pscustomobject]@{ Name='shouanren'; WorkingDirectory=$shouDirectory; Executable='python'; Arguments=@('-m','server.main'); Ports=@(8006) },
    [pscustomobject]@{ Name='stm32'; WorkingDirectory='4G'; Executable='python'; Arguments=@('4G.py'); Ports=@(8007,8008) },
    [pscustomobject]@{ Name='research-reports'; WorkingDirectory='research-reports'; Executable='python'; Arguments=@('-m','uvicorn','research_reports.main:create_app','--factory','--host','127.0.0.1','--port','8009'); Ports=@(8009) }
)

if (-not $WithoutFrontends) {
    $services += @(
        [pscustomobject]@{ Name='sd-frontend'; WorkingDirectory='SD'; Executable='node'; Arguments=@('node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173'); Ports=@(5173) },
        [pscustomobject]@{ Name='openwrite-frontend'; WorkingDirectory='Openwrite-main/frontend'; Executable='node'; Arguments=@('node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5174'); Ports=@(5174) },
        [pscustomobject]@{ Name='stock-frontend'; WorkingDirectory='stock-research-package/stock-module/frontend'; Executable='node'; Arguments=@('node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5175'); Ports=@(5175) }
    )
}

foreach ($service in $services) { Start-ManagedService $service }
Write-Host 'Local services launched. Run scripts/check-local.ps1 after startup completes.'
