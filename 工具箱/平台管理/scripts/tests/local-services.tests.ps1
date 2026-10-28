 $loader = Join-Path (Join-Path $PSScriptRoot '..') 'local-services.ps1'
 if (Test-Path -LiteralPath $loader) { . $loader }

Describe 'local service manifest' {
    It 'contains every managed port exactly once' {
        $manifest = Get-LocalServiceManifest -Path (Join-Path (Join-Path $PSScriptRoot '..') 'local-services.json')
        $ports = @($manifest.services | ForEach-Object { $_.ports })
        @($ports | Sort-Object | Get-Unique).Count | Should Be $ports.Count
        (@($ports | Where-Object { $_ -lt 8000 })).Count | Should Be 0
        (@($ports | Sort-Object) -join ',') | Should Be '8005,8009,8010,8011,8012,8013'
    }

    It 'publishes only the six toolbox services' {
        $manifest = Get-LocalServiceManifest -Path (Join-Path (Join-Path $PSScriptRoot '..') 'local-services.json')
        @($manifest.services).Count | Should Be 6
        foreach ($service in $manifest.services) {
            $service.working_directory | Should Match '^工具箱/'
        }
    }

    It 'uses an optional ignored manifest only when present' {
        $public = Join-Path $TestDrive 'local-services.json'
        $private = Join-Path $TestDrive 'local-services.private.json'
        '{}' | Set-Content -LiteralPath $public
        (Get-LocalServiceManifestPath -ScriptRoot $TestDrive) | Should Be $public
        '{}' | Set-Content -LiteralPath $private
        (Get-LocalServiceManifestPath -ScriptRoot $TestDrive) | Should Be $private
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
        [string]$service[0].working_directory | Should Be '工具箱/webmaster-inspector'
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
