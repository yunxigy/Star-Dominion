Set-StrictMode -Version Latest

function Get-LocalServiceManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    $manifest = Get-Content -LiteralPath $resolved.Path -Raw -Encoding utf8 | ConvertFrom-Json
    if ($null -eq $manifest.services -or @($manifest.services).Count -eq 0) {
        throw "Local service manifest has no services: $($resolved.Path)"
    }

    $names = @($manifest.services | ForEach-Object { [string]$_.name })
    $duplicateName = $names | Group-Object | Where-Object Count -gt 1 | Select-Object -First 1
    if ($null -ne $duplicateName) {
        throw "Duplicate service name '$($duplicateName.Name)' in $($resolved.Path)"
    }

    $ports = @($manifest.services | ForEach-Object { @($_.ports) })
    $duplicatePort = $ports | Group-Object | Where-Object Count -gt 1 | Select-Object -First 1
    if ($null -ne $duplicatePort) {
        throw "Duplicate port '$($duplicatePort.Name)' in $($resolved.Path)"
    }

    foreach ($service in @($manifest.services)) {
        if ([string]::IsNullOrWhiteSpace([string]$service.name)) { throw "Service name is required in $($resolved.Path)" }
        if ($null -eq $service.ports -or @($service.ports).Count -eq 0) { throw "Service '$($service.name)' has no ports" }
        $hasHealthUrl = $null -ne $service.PSObject.Properties['health_url'] -and
            -not [string]::IsNullOrWhiteSpace([string]$service.health_url)
        $tcpOnly = $service.PSObject.Properties['tcp_only'] -and $service.tcp_only -eq $true
        if (-not $hasHealthUrl -and -not $tcpOnly) {
            throw "Service '$($service.name)' must define health_url or tcp_only=true"
        }
    }
    return $manifest
}
