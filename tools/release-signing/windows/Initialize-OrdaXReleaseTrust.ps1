[CmdletBinding()]
param(
    [string]$PrivateKeyPath,
    [string]$ReviewDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptPath = $PSCommandPath
if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
    $ScriptPath = $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
    throw 'Unable to resolve the trust ceremony script path.'
}
$ScriptPath = [IO.Path]::GetFullPath($ScriptPath)
$ScriptRoot = Split-Path -Parent $ScriptPath
if ([string]::IsNullOrWhiteSpace($ScriptRoot)) {
    throw 'Unable to resolve the trust ceremony script directory.'
}

if ([string]::IsNullOrWhiteSpace($PrivateKeyPath)) {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'LOCALAPPDATA is unavailable; specify -PrivateKeyPath explicitly.'
    }
    $PrivateKeyPath = Join-Path $env:LOCALAPPDATA 'OrdaX\release-signing\ordax-release-private.pem'
}
if ([string]::IsNullOrWhiteSpace($ReviewDirectory)) {
    $ReviewDirectory = Join-Path $ScriptRoot 'trust-review'
}

$KeyId = 'ordax-prototype-release-v1'
$Signer = Join-Path $ScriptRoot 'ordax-release-signing.exe'
if (-not (Test-Path -LiteralPath $Signer -PathType Leaf)) {
    throw "ordax-release-signing.exe was not found next to this script: $Signer"
}

$PrivateKeyPath = [IO.Path]::GetFullPath($PrivateKeyPath)
$ReviewDirectory = [IO.Path]::GetFullPath($ReviewDirectory)
$PrivateDirectory = Split-Path -Parent $PrivateKeyPath
if ([string]::IsNullOrWhiteSpace($PrivateDirectory)) {
    throw 'PrivateKeyPath must include a parent directory.'
}
$ToolkitRoot = $ScriptRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if ($PrivateKeyPath.StartsWith($ToolkitRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The private key must be outside the downloaded toolkit/repository directory.'
}
if (Test-Path -LiteralPath $PrivateKeyPath) {
    throw "Refusing to replace an existing private key: $PrivateKeyPath"
}

New-Item -ItemType Directory -Force -Path $PrivateDirectory | Out-Null
if (Test-Path -LiteralPath $ReviewDirectory) {
    $existing = @(Get-ChildItem -LiteralPath $ReviewDirectory -Force)
    if ($existing.Count -ne 0) {
        throw "ReviewDirectory must be empty: $ReviewDirectory"
    }
} else {
    New-Item -ItemType Directory -Path $ReviewDirectory | Out-Null
}

$TrustPath = Join-Path $ReviewDirectory 'release-ed25519.json'
$DerivedTrustPath = Join-Path $ReviewDirectory 'release-ed25519-derived.json'
$ManifestPath = Join-Path $ReviewDirectory 'trust-proof-manifest.json'
$EnvelopePath = Join-Path $ReviewDirectory 'trust-proof-envelope.json'
$ResultPath = Join-Path $ReviewDirectory 'ceremony-result.json'

Write-Host 'Generating canonical Ed25519 key material locally...'
& $Signer generate-key `
    --private-key $PrivateKeyPath `
    --trust $TrustPath `
    --key-id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'generate-key failed.' }

Write-Host 'Deriving the public anchor independently from the private key...'
& $Signer derive-trust `
    --private-key $PrivateKeyPath `
    --out $DerivedTrustPath `
    --key-id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'derive-trust failed.' }

$TrustBytes = [IO.File]::ReadAllBytes($TrustPath)
$DerivedBytes = [IO.File]::ReadAllBytes($DerivedTrustPath)
if ($TrustBytes.Length -ne $DerivedBytes.Length) {
    throw 'Independent public trust derivation length mismatch.'
}
for ($i = 0; $i -lt $TrustBytes.Length; $i++) {
    if ($TrustBytes[$i] -ne $DerivedBytes[$i]) {
        throw "Independent public trust derivation differs at byte $i."
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

$ProofCommit = '0123456789abcdef0123456789abcdef01234567'
$Manifest = [ordered]@{
    '$schema' = 'prototype-ordax.release-manifest/1'
    source_repository = 'washingtonmsdj/prototipo-ordax-os'
    source_commit = $ProofCommit
    release_id = $ProofCommit
    created_from_ci_recipe = 'release/native/1'
    artifacts = @(
        [ordered]@{
            name = 'system.tar'
            role = 'system'
            url = 'https://example.invalid/releases/system.tar'
            sha256 = ('a' * 64)
            size = 123
        }
    )
}
$Utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($ManifestPath, (($Manifest | ConvertTo-Json -Depth 6) + "`n"), $Utf8NoBom)

Write-Host 'Signing a protocol-shaped proof manifest...'
& $Signer sign `
    --manifest $ManifestPath `
    --private-key $PrivateKeyPath `
    --trust $TrustPath `
    --key-id $KeyId `
    --out $EnvelopePath
if ($LASTEXITCODE -ne 0) { throw 'proof signing failed.' }

$TrustHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant()
$Result = [ordered]@{
    '$schema' = 'prototype-ordax.release-trust-ceremony-result/1'
    status = 'local-key-generated-public-anchor-verified-proof-signed'
    key_id = $KeyId
    public_trust_path = $TrustPath
    public_trust_sha256 = $TrustHash
    independent_derivation_byte_equal = $true
    proof_signature_created = $true
    private_key_location = $PrivateKeyPath
    private_key_in_repository = $false
    offline_encrypted_backup_required = $true
    ready_to_pin_public_anchor = $false
    remaining_gate = 'create and verify at least one encrypted offline recovery copy before pinning public anchor'
}
[IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 5) + "`n"), $Utf8NoBom)

Write-Host ''
Write-Host 'CANONICAL_KEY_MATERIAL_GENERATED=YES'
Write-Host 'PUBLIC_TRUST_DERIVATION_MATCH=PASS'
Write-Host 'PROOF_SIGNATURE_CREATED=YES'
Write-Host "PUBLIC_TRUST_SHA256=$TrustHash"
Write-Host "PUBLIC_TRUST_PATH=$TrustPath"
Write-Host "PRIVATE_KEY_PATH=$PrivateKeyPath"
Write-Host 'OFFLINE_ENCRYPTED_BACKUP_REQUIRED=YES'
Write-Host 'READY_TO_PIN_PUBLIC_ANCHOR=NO'
Write-Host ''
Write-Host 'Next: create and verify an encrypted offline backup of the private PEM.'
Write-Host 'Do NOT paste, upload, commit, or place the private PEM on the OrdaX USB.'
