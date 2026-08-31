 $loader = Join-Path (Join-Path $PSScriptRoot '..') 'local-services.ps1'
 if (Test-Path -LiteralPath $loader) { . $loader }

Describe 'local service manifest' {
    It 'contains every managed port exactly once' {
        $manifest = Get-LocalServiceManifest -Path (Join-Path (Join-Path $PSScriptRoot '..') 'local-services.json')
        $ports = @($manifest.services | ForEach-Object { $_.ports })
        @($ports | Sort-Object | Get-Unique).Count | Should Be $ports.Count
        ($ports -contains 8000) | Should Be $true
        ($ports -contains 8014) | Should Be $true
        (@($ports | Where-Object { $_ -lt 8000 })).Count | Should Be 0
        (@($ports | Sort-Object) -join ',') | Should Be ((8000..8014) -join ',')
    }

    It 'uses the V2 OpenWrite service and the 8000-series frontend ports' {
        $manifest = Get-LocalServiceManifest -Path (Join-Path (Join-Path $PSScriptRoot '..') 'local-services.json')
        $openwrite = @($manifest.services | Where-Object { $_.name -eq 'openwrite' })
        $sd = @($manifest.services | Where-Object { $_.name -eq 'sd-frontend' })
        $stock = @($manifest.services | Where-Object { $_.name -eq 'stock-frontend' })
        $openwrite.Count | Should Be 1
        [string]$openwrite[0].working_directory | Should Be 'Openwrite-mainV2'
        (@($openwrite[0].ports) -contains 8001) | Should Be $true
        [string]$openwrite[0].health_url | Should Be 'http://127.0.0.1:8001/api/health'
        ($openwrite[0].arguments -join ' ') | Should Match '-m tools.cli studio'
        ($openwrite[0].arguments -join ' ') | Should Match '--port 8001'
        ($openwrite[0].arguments -join ' ') | Should Match '--no-open'
        $sd.Count | Should Be 1
        (@($sd[0].ports) -contains 8013) | Should Be $true
        $stock.Count | Should Be 1
        (@($stock[0].ports) -contains 8014) | Should Be $true
        @($manifest.services | Where-Object { $_.name -eq 'openwrite-frontend' }).Count | Should Be 0
    }

    It 'declares a health contract for every service' {
        $manifest = Get-LocalServiceManifest -Path (Join-Path (Join-Path $PSScriptRoot '..') 'local-services.json')
        foreach ($service in @($manifest.services)) {
            $hasUrl = $service.PSObject.Properties['health_url'] -and -not [string]::IsNullOrWhiteSpace([string]$service.health_url)
            $tcpOnly = $service.PSObject.Properties['tcp_only'] -and $service.tcp_only -eq $true
            ($hasUrl -or $tcpOnly) | Should Be $true
        }
    }

    It 'runs the in-memory video service as one worker on 8011' {
        $manifest = Get-LocalServiceManifest -Path (Join-Path (Join-Path $PSScriptRoot '..') 'local-services.json')
        $video = @($manifest.services | Where-Object { $_.name -eq 'video-downloader' })
        $video.Count | Should Be 1
        (@($video[0].ports) -contains 8011) | Should Be $true
        [string]$video[0].health_url | Should Be 'http://127.0.0.1:8011/health'
        ($video[0].arguments -join ' ') | Should Match '--workers 1'
    }

    It 'declares the webmaster inspector on 8012 as one worker' {
        $manifest = Get-LocalServiceManifest -Path (Join-Path (Join-Path $PSScriptRoot '..') 'local-services.json')
        $service = @($manifest.services | Where-Object { $_.name -eq 'webmaster-inspector' })
        $service.Count | Should Be 1
        (@($service[0].ports) -contains 8012) | Should Be $true
        [string]$service[0].working_directory | Should Be 'webmaster-inspector'
        [string]$service[0].health_url | Should Be 'http://127.0.0.1:8012/health'
        ($service[0].arguments -join ' ') | Should Match '--workers 1'
    }

    It 'makes lifecycle scripts consume the manifest loader' {
        foreach ($scriptName in @('start-local.ps1', 'stop-local.ps1', 'check-local.ps1')) {
            $content = Get-Content -LiteralPath (Join-Path (Join-Path $PSScriptRoot '..') $scriptName) -Raw
            $content | Should Match 'Get-LocalServiceManifest'
        }
    }
}
