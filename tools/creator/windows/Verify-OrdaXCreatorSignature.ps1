param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,

    [Parameter(Mandatory = $true)]
    [string]$ContractPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Sha256HexFromBytes {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $sha.ComputeHash($Bytes)
        return (($digest | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha.Dispose()
    }
}

$ExecutablePath = [IO.Path]::GetFullPath($ExecutablePath)
$ContractPath = [IO.Path]::GetFullPath($ContractPath)

if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
    throw "Creator executable was not found: $ExecutablePath"
}
if (-not (Test-Path -LiteralPath $ContractPath -PathType Leaf)) {
    throw "Creator code-signing contract was not found: $ContractPath"
}

$exeItem = Get-Item -LiteralPath $ExecutablePath -Force
$contractItem = Get-Item -LiteralPath $ContractPath -Force
if (($exeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Creator executable may not be a reparse point or symlink'
}
if (($contractItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Creator code-signing contract may not be a reparse point or symlink'
}

$contract = Get-Content -LiteralPath $ContractPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($contract.'$schema' -ne 'prototype-ordax.creator-code-signing/1') {
    throw 'Unsupported Creator code-signing contract schema'
}
if ($contract.status -ne 'configured') {
    throw "Creator code signing is not configured; contract status is '$($contract.status)'"
}
if ($contract.platform -ne 'windows' -or $contract.artifact -ne 'OrdaX-Creator.exe' -or $contract.signature_format -ne 'authenticode') {
    throw 'Creator code-signing contract identity is invalid'
}
if ($contract.file_digest_algorithm -ne 'sha256') {
    throw 'Creator code-signing contract requires an unsupported file digest algorithm'
}
if ($contract.timestamp.required -ne $true -or $contract.timestamp.protocol -ne 'rfc3161' -or $contract.timestamp.digest_algorithm -ne 'sha256') {
    throw 'Creator code-signing timestamp policy is invalid'
}
if ($contract.verification.windows_signature_status_required -ne 'Valid' -or
    $contract.verification.windows_trust_chain_required -ne $true -or
    $contract.verification.exact_publisher_subject_required -ne $true -or
    $contract.verification.leaf_certificate_sha256_pin_required -ne $true -or
    $contract.verification.timestamp_certificate_required -ne $true) {
    throw 'Creator Authenticode verification policy was weakened'
}
if ($contract.release_policy.unsigned_candidate_publishable -ne $false -or
    $contract.release_policy.signature_with_unapproved_identity_publishable -ne $false -or
    $contract.release_policy.signature_without_timestamp_publishable -ne $false -or
    $contract.release_policy.authenticode_is_release_authenticity_root -ne $false -or
    $contract.release_policy.ed25519_release_verification_remains_required -ne $true -or
    $contract.release_policy.publish_allowed -ne $true) {
    throw 'Creator release policy is not explicitly configured for signed publication'
}
if ($contract.custody.private_key_may_enter_git -ne $false -or
    $contract.custody.private_key_may_enter_creator -ne $false -or
    $contract.custody.private_key_may_enter_github_artifact -ne $false -or
    $contract.custody.pfx_may_enter_git -ne $false -or
    $contract.custody.pfx_may_enter_github_artifact -ne $false -or
    $contract.custody.end_user_manages_code_signing_key -ne $false) {
    throw 'Creator code-signing custody policy was weakened'
}
if ([string]::IsNullOrWhiteSpace([string]$contract.custody.provider) -or $contract.custody.provider -eq 'unconfigured') {
    throw 'Creator code-signing provider is unresolved'
}

$expectedSubject = [string]$contract.publisher_identity.expected_subject
if ([string]::IsNullOrWhiteSpace($expectedSubject)) {
    throw 'Expected Authenticode publisher subject is unresolved'
}
$allowedHashes = @($contract.publisher_identity.allowed_leaf_certificate_sha256)
if ($allowedHashes.Count -eq 0) {
    throw 'No allowed Authenticode leaf certificate SHA-256 is configured'
}
foreach ($hash in $allowedHashes) {
    if ([string]$hash -cnotmatch '^[0-9a-f]{64}$') {
        throw "Invalid allowed Authenticode certificate SHA-256: $hash"
    }
}

$signature = Get-AuthenticodeSignature -LiteralPath $ExecutablePath
if ([string]$signature.Status -ne 'Valid') {
    throw "Authenticode signature status is '$($signature.Status)', expected 'Valid'"
}
if ($null -eq $signature.SignerCertificate) {
    throw 'Authenticode signer certificate is missing'
}
if ($signature.SignerCertificate.Subject -cne $expectedSubject) {
    throw "Authenticode publisher subject mismatch: '$($signature.SignerCertificate.Subject)'"
}
$leafSha256 = Get-Sha256HexFromBytes -Bytes $signature.SignerCertificate.RawData
if ($allowedHashes -cnotcontains $leafSha256) {
    throw "Authenticode signer certificate SHA-256 is not approved: $leafSha256"
}
if ($null -eq $signature.TimeStamperCertificate) {
    throw 'Required Authenticode timestamp certificate is missing'
}

$exeSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $ExecutablePath).Hash.ToLowerInvariant()
Write-Output 'AUTHENTICODE_SIGNATURE_VALID=YES'
Write-Output "AUTHENTICODE_PUBLISHER_SUBJECT=$expectedSubject"
Write-Output "AUTHENTICODE_CERTIFICATE_SHA256=$leafSha256"
Write-Output 'AUTHENTICODE_TIMESTAMP_PRESENT=YES'
Write-Output "CREATOR_EXECUTABLE_SHA256=$exeSha256"
Write-Output 'ED25519_RELEASE_AUTHORITY_STILL_REQUIRED=YES'
Write-Output 'CREATOR_CODE_SIGNING_GATE=PASS'
