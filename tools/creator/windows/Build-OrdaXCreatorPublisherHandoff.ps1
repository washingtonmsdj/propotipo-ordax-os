param(
    [Parameter(Mandatory = $true)][string]$TrustPath,
    [Parameter(Mandatory = $true)][string]$SourceCommit,
    [Parameter(Mandatory = $true)][string]$AppVersion,
    [Parameter(Mandatory = $true)][long]$AppReleaseSequence,
    [Parameter(Mandatory = $true)][ValidateSet('canonical', 'ci-disposable')][string]$TrustClass,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RealFile {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Label)
    $full = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "$Label was not found: $full" }
    $item = Get-Item -LiteralPath $full -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "$Label may not be a reparse point or symlink" }
    return $full
}

function Get-EmptyOutputDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    if (Test-Path -LiteralPath $full) {
        $item = Get-Item -LiteralPath $full -Force
        if (-not $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw 'publisher handoff output must be a real directory'
        }
        if (@(Get-ChildItem -LiteralPath $full -Force).Count -ne 0) { throw 'publisher handoff output must be empty' }
    } else {
        New-Item -ItemType Directory -Path $full | Out-Null
    }
    return $full
}

if ($SourceCommit -cnotmatch '^[0-9a-f]{40}$') { throw 'source commit must be lowercase 40-hex' }
if ($AppVersion -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { throw 'Creator app version is invalid' }
if ($AppReleaseSequence -le 0) { throw 'Creator app release sequence must be positive' }

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$TrustPath = Get-RealFile -Path $TrustPath -Label 'Creator public release trust'
$OutputDirectory = Get-EmptyOutputDirectory -Path $OutputDirectory
$trust = Get-Content -LiteralPath $TrustPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($trust.'$schema' -ne 'prototype-ordax.release-trust/1' -or [string]$trust.key_id -cne 'ordax-prototype-release-v1') {
    throw 'Creator public release trust identity is invalid'
}
try {
    $publicBytes = [Convert]::FromBase64String([string]$trust.public_key_base64)
} catch {
    throw 'Creator public release trust contains invalid base64'
}
if ($publicBytes.Length -ne 32) { throw 'Creator public release trust must contain a 32-byte Ed25519 public key' }
$trustSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant()
$trustBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($TrustPath))

Push-Location (Join-Path $repoRoot 'tools/creator')
try {
    go test -count=1 ./appchannel ./componentchannel ./physicalchannel ./cmd/ordax-creator-app ./cmd/ordax-creator-launcher
    if ($LASTEXITCODE -ne 0) { throw 'Creator handoff pre-build tests failed' }
    $launcherLd = "-s -w -H=windowsgui -X main.buildCanonicalTrustBase64=$trustBase64 -X main.buildCanonicalTrustSHA256=$trustSha"
    go build -trimpath -buildvcs=false -ldflags $launcherLd -o (Join-Path $OutputDirectory 'OrdaX-Creator.exe') ./cmd/ordax-creator-launcher
    if ($LASTEXITCODE -ne 0) { throw 'Creator launcher build failed' }
    $appLd = "-s -w -H=windowsgui -X main.buildPhysicalTrustBase64=$trustBase64 -X main.buildPhysicalTrustSHA256=$trustSha"
    go build -trimpath -buildvcs=false -ldflags $appLd -o (Join-Path $OutputDirectory 'OrdaX-Creator-App.exe') ./cmd/ordax-creator-app
    if ($LASTEXITCODE -ne 0) { throw 'Creator versioned app build failed' }
} finally {
    Pop-Location
}

Push-Location (Join-Path $repoRoot 'tools/release-signing')
try {
    go test -count=1 ./cmd/ordax-creator-app-signing ./cmd/ordax-creator-app-manifest
    if ($LASTEXITCODE -ne 0) { throw 'Creator publisher tooling tests failed' }
    go build -trimpath -buildvcs=false -ldflags '-s -w' -o (Join-Path $OutputDirectory 'ordax-creator-app-signing.exe') ./cmd/ordax-creator-app-signing
    if ($LASTEXITCODE -ne 0) { throw 'Creator app signing tool build failed' }
    go build -trimpath -buildvcs=false -ldflags '-s -w' -o (Join-Path $OutputDirectory 'ordax-creator-app-manifest.exe') ./cmd/ordax-creator-app-manifest
    if ($LASTEXITCODE -ne 0) { throw 'Creator app manifest tool build failed' }
} finally {
    Pop-Location
}

foreach ($name in @('OrdaX-Creator.exe', 'OrdaX-Creator-App.exe')) {
    $exe = Get-RealFile -Path (Join-Path $OutputDirectory $name) -Label $name
    $signature = Get-AuthenticodeSignature -LiteralPath $exe
    if ([string]$signature.Status -eq 'Valid' -or $null -ne $signature.SignerCertificate) {
        throw "$name unexpectedly contains an Authenticode signer before publisher handoff"
    }
}

$copies = @(
    @{ Source = (Join-Path $repoRoot 'docs/contracts/creator-code-signing.json'); Destination = 'creator-code-signing.json' },
    @{ Source = (Join-Path $repoRoot 'docs/contracts/creator-app-channel.json'); Destination = 'creator-app-channel.json' },
    @{ Source = (Join-Path $repoRoot 'docs/contracts/creator-component-channel.json'); Destination = 'creator-component-channel.json' },
    @{ Source = $TrustPath; Destination = 'release-ed25519.json' },
    @{ Source = (Join-Path $repoRoot 'tools/creator/windows/Verify-OrdaXCreatorSignature.ps1'); Destination = 'Verify-OrdaXCreatorSignature.ps1' },
    @{ Source = (Join-Path $repoRoot 'tools/creator/windows/Finalize-OrdaXCreatorRelease.ps1'); Destination = 'Finalize-OrdaXCreatorRelease.ps1' }
)
foreach ($copy in $copies) {
    $sourcePath = Get-RealFile -Path ([string]$copy.Source) -Label "handoff source $($copy.Source)"
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $OutputDirectory ([string]$copy.Destination))
}

$names = @(
    'OrdaX-Creator.exe',
    'OrdaX-Creator-App.exe',
    'ordax-creator-app-signing.exe',
    'ordax-creator-app-manifest.exe',
    'Verify-OrdaXCreatorSignature.ps1',
    'Finalize-OrdaXCreatorRelease.ps1',
    'release-ed25519.json',
    'creator-code-signing.json',
    'creator-app-channel.json',
    'creator-component-channel.json'
)
$sumLines = foreach ($name in $names) {
    $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $OutputDirectory $name)).Hash.ToLowerInvariant()
    "$sha  $name"
}
$sumLines | Set-Content -Encoding ascii (Join-Path $OutputDirectory 'PRE-SIGNING-SHA256SUMS')

$launcherSha = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $OutputDirectory 'OrdaX-Creator.exe')).Hash.ToLowerInvariant()
$appSha = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $OutputDirectory 'OrdaX-Creator-App.exe')).Hash.ToLowerInvariant()
$canonicalTrustSha = $null
if ($TrustClass -eq 'canonical') { $canonicalTrustSha = $trustSha }
$provenance = [ordered]@{
    '$schema' = 'prototype-ordax.creator-official-candidate/2'
    source_commit = $SourceCommit
    app_version = $AppVersion
    app_release_sequence = $AppReleaseSequence
    trust_class = $TrustClass
    trust_sha256 = $trustSha
    canonical_trust_sha256 = $canonicalTrustSha
    launcher = [ordered]@{
        name = 'OrdaX-Creator.exe'
        role = 'stable-signed-app-loader'
        pre_signing_sha256 = $launcherSha
    }
    app = [ordered]@{
        name = 'OrdaX-Creator-App.exe'
        role = 'versioned-signed-creator-gui'
        pre_signing_sha256 = $appSha
        manifest_generated = $false
        ed25519_envelope_generated = $false
    }
    publisher_handoff_tools = @('Verify-OrdaXCreatorSignature.ps1', 'Finalize-OrdaXCreatorRelease.ps1', 'ordax-creator-app-manifest.exe', 'ordax-creator-app-signing.exe')
    creator_component_channel = 'signed-ed25519-only'
    development_component_channel_allowed = $false
    private_key_embedded = $false
    publisher_key_generation_available = $false
    authenticode_signed = $false
    app_manifest_may_be_generated_before_authenticode_verification = $false
    publishable_to_end_users = $false
    required_order = @('authenticode-sign-launcher-and-app', 'verify-authenticode-launcher-and-app', 'generate-app-manifest-from-signed-app-bytes', 'sign-app-manifest-ed25519', 'publish-public-assets')
    remaining_release_gate = 'real Authenticode publisher identity and timestamp, post-sign verification, Ed25519 app envelope, and explicit official publication'
}
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'provenance.json'), (($provenance | ConvertTo-Json -Depth 10) + "`n"), $utf8)

$forbidden = @(Get-ChildItem -LiteralPath $OutputDirectory -Recurse -File | Where-Object { $_.Extension -in @('.pem', '.key', '.p12', '.pfx', '.dpapi') })
if ($forbidden.Count -ne 0) { throw 'private signing material entered Creator publisher handoff' }
if (Test-Path -LiteralPath (Join-Path $OutputDirectory 'creator-app-manifest.json')) { throw 'Creator app manifest appeared before Authenticode verification' }
if (Test-Path -LiteralPath (Join-Path $OutputDirectory 'creator-app-envelope.json')) { throw 'Creator app Ed25519 envelope appeared before publisher signing' }

Write-Host 'CREATOR_PUBLISHER_HANDOFF_BUILT=YES'
Write-Host "CREATOR_PUBLISHER_HANDOFF_TRUST_CLASS=$TrustClass"
Write-Host "CREATOR_PUBLISHER_HANDOFF_TRUST_SHA256=$trustSha"
Write-Host 'CREATOR_PUBLISHER_HANDOFF_PRIVATE_KEY=ABSENT'
Write-Host 'CREATOR_PUBLISHER_HANDOFF_AUTHENTICODE_SIGNED=NO'
Write-Host 'CREATOR_PUBLISHER_HANDOFF_APP_MANIFEST=ABSENT'
Write-Host 'CREATOR_PUBLISHER_HANDOFF_ED25519_ENVELOPE=ABSENT'
Write-Host 'CREATOR_PUBLISHER_HANDOFF_PUBLISHABLE=NO'
