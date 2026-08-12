 $loader = Join-Path (Join-Path $PSScriptRoot '..') 'local-services.ps1'
 if (Test-Path -LiteralPath $loader) { . $loader }

Describe 'local service manifest' {
    It 'contains every managed port exactly once' {
        $manifest = Get-LocalServiceManifest -Path (Join-Path (Join-Path $PSScriptRoot '..') 'local-services.json')
        $ports = @($manifest.services | ForEach-Object { $_.ports })
        @($ports | Sort-Object | Get-Unique).Count | Should Be $ports.Count
        ($ports -contains 8000) | Should Be $true
        ($ports -contains 5175) | Should Be $true
    }

    It 'declares a health contract for every service' {
        $manifest = Get-LocalServiceManifest -Path (Join-Path (Join-Path $PSScriptRoot '..') 'local-services.json')
        foreach ($service in @($manifest.services)) {
            $hasUrl = $service.PSObject.Properties['health_url'] -and -not [string]::IsNullOrWhiteSpace([string]$service.health_url)
            $tcpOnly = $service.PSObject.Properties['tcp_only'] -and $service.tcp_only -eq $true
            ($hasUrl -or $tcpOnly) | Should Be $true
        }
    }

    It 'makes lifecycle scripts consume the manifest loader' {
        foreach ($scriptName in @('start-local.ps1', 'stop-local.ps1', 'check-local.ps1')) {
            $content = Get-Content -LiteralPath (Join-Path (Join-Path $PSScriptRoot '..') $scriptName) -Raw
            $content | Should Match 'Get-LocalServiceManifest'
        }
    }
}
