param(
    [string]$CandidateDirectory = $PSScriptRoot,
    [string]$PrivateKeyPath = '',
    [string]$OutputDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RealFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $full = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        throw "$Label was not found: $full"
    }
    $item = Get-Item -LiteralPath $full -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label may not be a reparse point or symlink: $full"
    }
    return $full
}

function Get-RealDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $full = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $full -PathType Container)) {
        throw "$Label was not found: $full"
    }
    $item = Get-Item -LiteralPath $full -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label may not be a reparse point or symlink: $full"
    }
    return $full
}

function Assert-EmptyOutputDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    if (Test-Path -LiteralPath $full) {
        $item = Get-Item -LiteralPath $full -Force
        if (-not $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw "Release output must be a real directory: $full"
        }
        if (@(Get-ChildItem -LiteralPath $full -Force).Count -ne 0) {
            throw "Release output directory must be empty: $full"
        }
    } else {
        New-Item -ItemType Directory -Path $full | Out-Null
    }
    return $full
}

$CandidateDirectory = Get-RealDirectory -Path $CandidateDirectory -Label 'Creator publisher handoff directory'
if ([string]::IsNullOrWhiteSpace($PrivateKeyPath)) {
    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        throw 'USERPROFILE is unavailable; provide -PrivateKeyPath explicitly'
    }
    $PrivateKeyPath = Join-Path $env:USERPROFILE 'OrdaX-Private\release-signing\ordax-release-private.pem'
}
$PrivateKeyPath = Get-RealFile -Path $PrivateKeyPath -Label 'Canonical Ed25519 private key'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $CandidateDirectory 'final-release'
}
$OutputDirectory = Assert-EmptyOutputDirectory -Path $OutputDirectory

$launcher = Get-RealFile -Path (Join-Path $CandidateDirectory 'OrdaX-Creator.exe') -Label 'Creator stable launcher'
$app = Get-RealFile -Path (Join-Path $CandidateDirectory 'OrdaX-Creator-App.exe') -Label 'Creator versioned app'
$codeSigningContract = Get-RealFile -Path (Join-Path $CandidateDirectory 'creator-code-signing.json') -Label 'Creator code-signing contract'
$appContractPath = Get-RealFile -Path (Join-Path $CandidateDirectory 'creator-app-channel.json') -Label 'Creator app channel contract'
$publicTrust = Get-RealFile -Path (Join-Path $CandidateDirectory 'release-ed25519.json') -Label 'Canonical public release trust'
$verifier = Get-RealFile -Path (Join-Path $CandidateDirectory 'Verify-OrdaXCreatorSignature.ps1') -Label 'Creator Authenticode verifier'
$manifestTool = Get-RealFile -Path (Join-Path $CandidateDirectory 'ordax-creator-app-manifest.exe') -Label 'Creator app manifest generator'
$signerTool = Get-RealFile -Path (Join-Path $CandidateDirectory 'ordax-creator-app-signing.exe') -Label 'Creator app Ed25519 signer'
$provenancePath = Get-RealFile -Path (Join-Path $CandidateDirectory 'provenance.json') -Label 'Creator publisher handoff provenance'

$provenance = Get-Content -LiteralPath $provenancePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($provenance.'$schema' -ne 'prototype-ordax.creator-official-candidate/2') {
    throw 'Unsupported Creator publisher handoff provenance schema'
}
$sourceCommit = [string]$provenance.source_commit
$appVersion = [string]$provenance.app_version
$appSequence = [int64]$provenance.app_release_sequence
if ($sourceCommit -cnotmatch '^[0-9a-f]{40}$') { throw 'Publisher handoff source commit is invalid' }
if ($appVersion -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { throw 'Publisher handoff app version is invalid' }
if ($appSequence -le 0) { throw 'Publisher handoff app release sequence is invalid' }
if ($provenance.authenticode_signed -ne $false -or $provenance.publishable_to_end_users -ne $false) {
    throw 'Publisher handoff provenance unexpectedly claims a pre-finalized release'
}
if ($provenance.app_manifest_may_be_generated_before_authenticode_verification -ne $false) {
    throw 'Publisher handoff weakened Authenticode-before-manifest ordering'
}

$appContract = Get-Content -LiteralPath $appContractPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($appContract.'$schema' -ne 'prototype-ordax.creator-app-channel/1' -or
    $appContract.purpose -ne 'creator-app-windows-amd64' -or
    $appContract.artifact_name -ne 'OrdaX-Creator-App.exe' -or
    $appContract.envelope_name -ne 'creator-app-envelope.json') {
    throw 'Creator app channel contract identity is invalid'
}
if ([string]$appContract.version -cne $appVersion -or [int64]$appContract.release_sequence -ne $appSequence) {
    throw 'Creator app contract version/sequence does not match publisher handoff provenance'
}
if ($appContract.authenticode_required_before_manifest_generation -ne $true -or
    $appContract.ed25519_signature_required -ne $true -or
    $appContract.development_fallback_allowed_in_official_launcher -ne $false -or
    $appContract.same_sequence_different_commit_allowed -ne $false) {
    throw 'Creator app channel security policy was weakened'
}

$trustSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $publicTrust).Hash.ToLowerInvariant()
if ($trustSha -cne [string]$provenance.canonical_trust_sha256) {
    throw 'Canonical public trust does not match publisher handoff provenance'
}
$trust = Get-Content -LiteralPath $publicTrust -Raw -Encoding UTF8 | ConvertFrom-Json
if ($trust.'$schema' -ne 'prototype-ordax.release-trust/1' -or [string]$trust.key_id -cne 'ordax-prototype-release-v1') {
    throw 'Canonical public release trust identity is invalid'
}

Write-Host '# OrdaX Creator - publisher finalization'
Write-Host 'Verifying Authenticode on stable launcher...'
& $verifier -ExecutablePath $launcher -ContractPath $codeSigningContract | Out-Host
Write-Host 'Verifying Authenticode on versioned app...'
& $verifier -ExecutablePath $app -ContractPath $codeSigningContract | Out-Host

$manifestPath = Join-Path $OutputDirectory 'creator-app-manifest.json'
$envelopePath = Join-Path $OutputDirectory 'creator-app-envelope.json'
& $manifestTool `
    --artifact $app `
    --out $manifestPath `
    --source-commit $sourceCommit `
    --version $appVersion `
    --release-sequence $appSequence | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Creator app manifest generation failed' }

& $signerTool `
    --manifest $manifestPath `
    --private-key $PrivateKeyPath `
    --trust $publicTrust `
    --out $envelopePath `
    --key-id 'ordax-prototype-release-v1' | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Creator app Ed25519 envelope signing failed' }

Copy-Item -LiteralPath $launcher -Destination (Join-Path $OutputDirectory 'OrdaX-Creator.exe')
Copy-Item -LiteralPath $app -Destination (Join-Path $OutputDirectory 'OrdaX-Creator-App.exe')
Copy-Item -LiteralPath $publicTrust -Destination (Join-Path $OutputDirectory 'release-ed25519.json')
Copy-Item -LiteralPath $codeSigningContract -Destination (Join-Path $OutputDirectory 'creator-code-signing.json')

$publicFiles = @(
    'OrdaX-Creator.exe',
    'OrdaX-Creator-App.exe',
    'creator-app-manifest.json',
    'creator-app-envelope.json',
    'release-ed25519.json',
    'creator-code-signing.json'
)
$sumLines = foreach ($name in $publicFiles) {
    $path = Join-Path $OutputDirectory $name
    $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    "$sha  $name"
}
$sumLines | Set-Content -Encoding ascii (Join-Path $OutputDirectory 'SHA256SUMS')

$forbidden = @(Get-ChildItem -LiteralPath $OutputDirectory -Recurse -File | Where-Object {
    $_.Extension -in @('.pem', '.key', '.p12', '.pfx', '.dpapi')
})
if ($forbidden.Count -ne 0) {
    throw 'Private signing material entered finalized public release output'
}
if (Get-ChildItem -LiteralPath $OutputDirectory -Recurse -File | Select-String -SimpleMatch 'PRIVATE KEY' -Quiet) {
    throw 'Private-key marker entered finalized public release output'
}

Write-Host 'CREATOR_AUTHENTICODE_LAUNCHER_VERIFIED=YES'
Write-Host 'CREATOR_AUTHENTICODE_APP_VERIFIED=YES'
Write-Host 'CREATOR_APP_MANIFEST_FROM_FINAL_SIGNED_BYTES=YES'
Write-Host 'CREATOR_APP_ED25519_ENVELOPE_SIGNED=YES'
Write-Host 'CREATOR_PRIVATE_KEY_IN_PUBLIC_RELEASE=NO'
Write-Host "CREATOR_FINAL_RELEASE_DIRECTORY=$OutputDirectory"
Write-Host 'CREATOR_RELEASE_READY_FOR_EXPLICIT_PUBLICATION=YES'
