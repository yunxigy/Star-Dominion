[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $workspaceRoot '.runtime'
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
        $actualStart = $process.StartTime.ToUniversalTime()
        $recordedStart = [datetime]::Parse([string]$metadata.process_start_utc).ToUniversalTime()
        if ([math]::Abs(($actualStart - $recordedStart).TotalSeconds) -gt 2) {
            Write-Error "PID reuse detected for $($metadata.name); process was not stopped."
            continue
        }
        Stop-Process -Id $process.Id -ErrorAction Stop
        Write-Host ("STOP  {0,-17} PID {1}" -f $metadata.name, $process.Id)
    }
    Remove-Item -LiteralPath $metadataFile.FullName -Force
}
