[CmdletBinding()]
param(
    [string]$PrimaryPrivateKeyPath = '',
    [Parameter(Mandatory = $true)]
    [string]$RecoveredPrivateKeyPath,
    [string]$ReviewDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$KeyId = 'ordax-prototype-release-v1'
$ScriptRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$Signer = Join-Path $ScriptRoot 'ordax-release-signing.exe'

if ([string]::IsNullOrWhiteSpace($PrimaryPrivateKeyPath)) {
    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        throw 'USERPROFILE is unavailable; specify -PrimaryPrivateKeyPath explicitly.'
    }
    $PrimaryPrivateKeyPath = Join-Path $env:USERPROFILE 'OrdaX-Private\release-signing\ordax-release-private.pem'
}
if ([string]::IsNullOrWhiteSpace($ReviewDirectory)) {
    $ReviewDirectory = Join-Path $ScriptRoot 'trust-review'
}

$PrimaryPrivateKeyPath = [IO.Path]::GetFullPath($PrimaryPrivateKeyPath)
$RecoveredPrivateKeyPath = [IO.Path]::GetFullPath($RecoveredPrivateKeyPath)
$ReviewDirectory = [IO.Path]::GetFullPath($ReviewDirectory)
if ($PrimaryPrivateKeyPath.Equals($RecoveredPrivateKeyPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Recovered private key must be a distinct restored file, not the primary custody path.'
}

function Assert-RegularFile([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label is missing: $Path"
    }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label may not be a reparse point or symlink: $Path"
    }
}

function Assert-PrivateOutsideToolkit([string]$Path, [string]$Label) {
    $prefix = $ScriptRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
        $Path.Equals($ScriptRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay outside the toolkit/repository directory."
    }
}

Assert-RegularFile $Signer 'release signer'
Assert-RegularFile $PrimaryPrivateKeyPath 'primary private key'
Assert-RegularFile $RecoveredPrivateKeyPath 'recovered private key'
Assert-PrivateOutsideToolkit $PrimaryPrivateKeyPath 'Primary private key'
Assert-PrivateOutsideToolkit $RecoveredPrivateKeyPath 'Recovered private key'

$TrustPath = Join-Path $ReviewDirectory 'release-ed25519.json'
$PrimaryDerivedPath = Join-Path $ReviewDirectory 'release-ed25519-derived.json'
$ProofManifestPath = Join-Path $ReviewDirectory 'trust-proof-manifest.json'
$InitialResultPath = Join-Path $ReviewDirectory 'ceremony-result.json'
$RecoveryDerivedPath = Join-Path $ReviewDirectory 'release-ed25519-recovered.json'
$RecoveryEnvelopePath = Join-Path $ReviewDirectory 'trust-proof-recovery-envelope.json'
$PublicEvidencePath = Join-Path $ReviewDirectory 'ceremony-public-evidence.json'
$PublicPromotionDirectory = Join-Path $ReviewDirectory 'public-promotion'
$PromotionTrustPath = Join-Path $PublicPromotionDirectory 'release-ed25519.json'
$PromotionEvidencePath = Join-Path $PublicPromotionDirectory 'ceremony-public-evidence.json'
$PromotionProofManifestPath = Join-Path $PublicPromotionDirectory 'trust-proof-manifest.json'
$PromotionRecoveryEnvelopePath = Join-Path $PublicPromotionDirectory 'trust-proof-recovery-envelope.json'

foreach ($path in @($TrustPath, $PrimaryDerivedPath, $ProofManifestPath, $InitialResultPath)) {
    Assert-RegularFile $path 'required trust ceremony file'
}

$InitialResult = Get-Content -LiteralPath $InitialResultPath -Raw | ConvertFrom-Json
if ($InitialResult.'$schema' -ne 'prototype-ordax.release-trust-ceremony-result/1' -or
    $InitialResult.key_id -ne $KeyId -or
    $InitialResult.offline_encrypted_backup_required -ne $true -or
    $InitialResult.ready_to_pin_public_anchor -ne $false) {
    throw 'Initial trust ceremony result is not the expected fail-closed pre-recovery state.'
}
foreach ($path in @(
    $RecoveryDerivedPath,
    $RecoveryEnvelopePath,
    $PublicEvidencePath,
    $PromotionTrustPath,
    $PromotionEvidencePath,
    $PromotionProofManifestPath,
    $PromotionRecoveryEnvelopePath
)) {
    if (Test-Path -LiteralPath $path) {
        throw "Refusing to replace an existing recovery proof output: $path"
    }
}
if (Test-Path -LiteralPath $PublicPromotionDirectory) {
    $existing = @(Get-ChildItem -LiteralPath $PublicPromotionDirectory -Force)
    if ($existing.Count -ne 0) {
        throw "Public promotion directory must be empty: $PublicPromotionDirectory"
    }
} else {
    New-Item -ItemType Directory -Path $PublicPromotionDirectory | Out-Null
}

Write-Host 'Deriving trust from the recovered offline copy...'
& $Signer derive-trust --private-key $RecoveredPrivateKeyPath --out $RecoveryDerivedPath --key-id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'Recovered private key public derivation failed.' }

$CanonicalBytes = [IO.File]::ReadAllBytes($TrustPath)
$PrimaryDerivedBytes = [IO.File]::ReadAllBytes($PrimaryDerivedPath)
$RecoveredBytes = [IO.File]::ReadAllBytes($RecoveryDerivedPath)
if ($CanonicalBytes.Length -ne $PrimaryDerivedBytes.Length -or
    $CanonicalBytes.Length -ne $RecoveredBytes.Length) {
    throw 'Public trust derivation length mismatch.'
}
for ($i = 0; $i -lt $CanonicalBytes.Length; $i++) {
    if ($CanonicalBytes[$i] -ne $PrimaryDerivedBytes[$i]) {
        throw "Primary public derivation differs from canonical trust at byte $i."
    }
    if ($CanonicalBytes[$i] -ne $RecoveredBytes[$i]) {
        throw "Recovered backup derives different public trust at byte $i."
    }
}

$Trust = Get-Content -LiteralPath $TrustPath -Raw | ConvertFrom-Json
if ($Trust.'$schema' -ne 'prototype-ordax.release-trust/1') {
    throw 'Unexpected trust schema.'
}
if ($Trust.key_id -ne $KeyId) {
    throw 'Unexpected trust key_id.'
}
$PublicBytes = [Convert]::FromBase64String([string]$Trust.public_key_base64)
if ($PublicBytes.Length -ne 32) {
    throw 'Ed25519 public key must contain exactly 32 raw bytes.'
}

Write-Host 'Signing the proof manifest with the recovered offline copy...'
& $Signer sign --manifest $ProofManifestPath --private-key $RecoveredPrivateKeyPath --trust $TrustPath --key-id $KeyId --out $RecoveryEnvelopePath
if ($LASTEXITCODE -ne 0) { throw 'Recovered private key signing proof failed.' }

Write-Host 'Verifying the recovered signing proof with public trust only...'
& $Signer verify-envelope --envelope $RecoveryEnvelopePath --trust $TrustPath
if ($LASTEXITCODE -ne 0) { throw 'Recovered signing proof did not verify with public trust.' }

$TrustHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant()
$RecoveryEnvelopeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $RecoveryEnvelopePath).Hash.ToLowerInvariant()
$ProofManifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ProofManifestPath).Hash.ToLowerInvariant()
$Evidence = [ordered]@{
    '$schema' = 'prototype-ordax.release-trust-ceremony-evidence/1'
    status = 'pass'
    key_id = $KeyId
    public_trust_sha256 = $TrustHash
    proof_manifest_sha256 = $ProofManifestHash
    recovery_envelope_sha256 = $RecoveryEnvelopeHash
    primary_public_derivation_match = $true
    recovered_public_derivation_match = $true
    recovered_private_path_distinct = $true
    recovered_signing_proof = $true
    offline_encrypted_backup_recovery_verified = $true
    private_key_in_public_evidence = $false
    ready_to_pin_public_anchor = $true
}
$Utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($PublicEvidencePath, (($Evidence | ConvertTo-Json -Depth 5) + [Environment]::NewLine), $Utf8NoBom)

Copy-Item -LiteralPath $TrustPath -Destination $PromotionTrustPath
Copy-Item -LiteralPath $PublicEvidencePath -Destination $PromotionEvidencePath
Copy-Item -LiteralPath $ProofManifestPath -Destination $PromotionProofManifestPath
Copy-Item -LiteralPath $RecoveryEnvelopePath -Destination $PromotionRecoveryEnvelopePath

foreach ($path in @(
    $PromotionTrustPath,
    $PromotionEvidencePath,
    $PromotionProofManifestPath,
    $PromotionRecoveryEnvelopePath
)) {
    Assert-RegularFile $path 'public promotion output'
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $PromotionTrustPath).Hash.ToLowerInvariant() -ne $TrustHash) {
    throw 'Public promotion trust copy changed after verification.'
}

Write-Host ''
Write-Host 'OFFLINE_RECOVERY_VERIFIED=YES'
Write-Host 'PRIMARY_PUBLIC_DERIVATION_MATCH=YES'
Write-Host 'RECOVERED_PUBLIC_DERIVATION_MATCH=YES'
Write-Host 'RECOVERED_PRIVATE_PATH_DISTINCT=YES'
Write-Host 'RECOVERED_SIGNING_PROOF=YES'
Write-Host 'RECOVERED_ENVELOPE_VERIFIED=YES'
Write-Host "PUBLIC_TRUST_SHA256=$TrustHash"
Write-Host 'PRIVATE_KEY_PRINTED=NO'
Write-Host 'PRIVATE_KEY_COPIED_TO_PUBLIC_PROMOTION=NO'
Write-Host 'READY_TO_PIN_PUBLIC_ANCHOR=YES'
Write-Host "PUBLIC_PROMOTION_DIRECTORY=$PublicPromotionDirectory"
