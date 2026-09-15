[CmdletBinding()]
param(
    [string]$PrivateKeyPath = (Join-Path $env:LOCALAPPDATA 'OrdaX\release-signing\ordax-release-private.pem')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$KeyId = 'ordax-prototype-release-v1'
$Root = [IO.Path]::GetFullPath($PSScriptRoot)
$Signer = Join-Path $Root 'ordax-release-signing.exe'
$Manifest = Join-Path $Root 'release-manifest.json'
$Trust = Join-Path $Root 'release-ed25519.json'
$Envelope = Join-Path $Root 'release-envelope.json'

foreach ($path in @($Signer, $Manifest, $Trust, $PrivateKeyPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required file is missing: $path"
    }
}
if (Test-Path -LiteralPath $Envelope) {
    throw "Refusing to replace existing release envelope: $Envelope"
}
if ([IO.Path]::GetFullPath($PrivateKeyPath).StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The canonical private key must remain outside the physical candidate directory.'
}

& $Signer sign `
    --manifest $Manifest `
    --private-key ([IO.Path]::GetFullPath($PrivateKeyPath)) `
    --trust $Trust `
    --key-id $KeyId `
    --out $Envelope
if ($LASTEXITCODE -ne 0) { throw 'Initial release signing failed.' }

$EnvelopeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Envelope).Hash.ToLowerInvariant()
$ManifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Manifest).Hash.ToLowerInvariant()
Write-Host ''
Write-Host 'INITIAL_RELEASE_SIGNED=YES'
Write-Host "RELEASE_MANIFEST_SHA256=$ManifestHash"
Write-Host "RELEASE_ENVELOPE_SHA256=$EnvelopeHash"
Write-Host "RELEASE_ENVELOPE_PATH=$Envelope"
Write-Host 'PRIVATE_KEY_COPIED_TO_PACKAGE=NO'
Write-Host 'READY_FOR_RELEASE_PUBLICATION=YES'
Write-Host ''
Write-Host 'release-envelope.json is public material and may be published with system.tar.'
Write-Host 'The private PEM must remain in local private storage and must never be uploaded.'
