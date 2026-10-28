[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$platformRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'local-services.ps1')
$manifestPath = Get-LocalServiceManifestPath -ScriptRoot $PSScriptRoot
$manifest = Get-LocalServiceManifest -Path $manifestPath
$runtimeRoot = Join-Path $platformRoot '.runtime'
if (-not (Test-Path -LiteralPath $runtimeRoot -PathType Container)) {
    Write-Host 'No managed local processes are recorded.'
    exit 0
}

$rootPrefix = $workspaceRoot.TrimEnd('\') + '\'
foreach ($metadataFile in Get-ChildItem -LiteralPath $runtimeRoot -Filter '*.json' -File) {
    $metadata = Get-Content -Raw -LiteralPath $metadataFile.FullName -Encoding utf8 | ConvertFrom-Json
    $recordedDirectory = [System.IO.Path]::GetFullPath([string]$metadata.working_directory)
    if (-not $recordedDirectory.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Error "Refusing unsafe metadata outside workspace: $($metadataFile.Name)"
        continue
    }
    $process = Get-Process -Id ([int]$metadata.pid) -ErrorAction SilentlyContinue
    if ($null -ne $process) {
        $serviceDefinition = @($manifest.services | Where-Object { $_.name -eq [string]$metadata.name }) | Select-Object -First 1
        if ($null -eq $serviceDefinition) {
            Write-Warning "Unknown managed service '$($metadata.name)'; stale metadata removed and process was not stopped."
            Remove-Item -LiteralPath $metadataFile.FullName -Force
            continue
        }
        if ($metadata.PSObject.Properties['command_fingerprint'] -and
            -not [string]::IsNullOrWhiteSpace([string]$metadata.command_fingerprint)) {
            $expectedFingerprint = "{0} {1}" -f $serviceDefinition.executable, ($serviceDefinition.arguments -join ' ')
            if ([string]$metadata.command_fingerprint -ne $expectedFingerprint) {
                Write-Warning "Command fingerprint mismatch for $($metadata.name); process was not stopped."
                Remove-Item -LiteralPath $metadataFile.FullName -Force
                continue
            }
        }
        $actualStart = $null
        try {
            $actualStart = $process.StartTime.ToUniversalTime()
        } catch {
            $actualStart = $null
        }
        if ($null -eq $actualStart) {
            $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$metadata.pid)" -ErrorAction SilentlyContinue
            if ($null -ne $processInfo -and $processInfo.CreationDate) {
                try {
                    $actualStart = ([datetime]$processInfo.CreationDate).ToUniversalTime()
                } catch {
                    $actualStart = $null
                }
            }
        }
        if ($null -eq $actualStart) {
            Write-Warning "Cannot verify PID $($metadata.pid) for $($metadata.name); process was not stopped."
            continue
        }
        # PowerShell 7 can deserialize ISO timestamps directly as DateTime.
        # Casting that value to string loses its UTC kind before parsing it again.
        $recordedStart = if ($metadata.process_start_utc -is [datetime]) {
            $metadata.process_start_utc.ToUniversalTime()
        } else {
            [datetime]::Parse(
                [string]$metadata.process_start_utc,
                [System.Globalization.CultureInfo]::InvariantCulture,
                [System.Globalization.DateTimeStyles]::RoundtripKind
            ).ToUniversalTime()
        }
        if ([math]::Abs(($actualStart - $recordedStart).TotalSeconds) -gt 2) {
            Write-Warning "PID reuse detected for $($metadata.name); stale metadata removed and process was not stopped."
            Remove-Item -LiteralPath $metadataFile.FullName -Force
            continue
        }
        Stop-Process -Id $process.Id -ErrorAction Stop
        Write-Host ("STOP  {0,-17} PID {1}" -f $metadata.name, $process.Id)
    }
    Remove-Item -LiteralPath $metadataFile.FullName -Force
}
