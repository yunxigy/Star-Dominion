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
        @($service[0].ports) | Should Contain 8012
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
