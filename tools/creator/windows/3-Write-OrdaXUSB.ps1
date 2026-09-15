[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $PSCommandPath)
    )
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments | Out-Null
    exit 0
}

$Root = [IO.Path]::GetFullPath($PSScriptRoot)
$Creator = Join-Path $Root 'ordax-creator-physical-test.exe'
$Seed = Join-Path $Root 'ordax-bootstrap-seed.raw'
if (-not (Test-Path -LiteralPath $Creator -PathType Leaf)) {
    throw "Physical Creator executable is missing: $Creator"
}
if (-not (Test-Path -LiteralPath $Seed -PathType Leaf)) {
    throw "Canonical bootstrap seed is missing: $Seed"
}

$statusText = (& $Creator status | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Cannot read physical Creator build status.' }
$status = $statusText | ConvertFrom-Json
if (-not $status.raw_backend_linked) { throw 'Physical raw backend is not linked.' }
if (-not $status.build.ready) { throw 'This package is inspection-only; physical apply is not ready.' }
if (-not $status.build.physical_write_authorized) { throw 'Canonical physical-write authorization is not bound into this build.' }

$targetsText = (& $Creator targets | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate safe USB targets.' }
$targetReport = $targetsText | ConvertFrom-Json
$targets = @($targetReport.targets | Where-Object { $_.prototype_safe -and -not $_.system_disk -and $_.bus_type -eq 'usb' })
if ($targets.Count -eq 0) {
    throw 'No eligible USB target was detected. Connect the intended pendrive and run again.'
}

Write-Host ''
Write-Host '============================================================'
Write-Host '  OrdaX - PRIMEIRA GRAVACAO FISICA DO PENDRIVE'
Write-Host '============================================================'
Write-Host ''
Write-Host 'Somente os discos USB considerados seguros pelo Creator aparecem abaixo.'
Write-Host 'O disco do Windows e alvos que nao comprovem transporte USB sao excluidos.'
Write-Host ''
for ($index = 0; $index -lt $targets.Count; $index++) {
    $target = $targets[$index]
    $gib = [Math]::Round(([double]$target.physical_disk_bytes / 1GB), 2)
    $serial = if ([string]::IsNullOrWhiteSpace([string]$target.device_serial)) { '<sem serial exposto>' } else { [string]$target.device_serial }
    Write-Host ("[{0}] PhysicalDrive{1}  Unidade={2}  Rotulo={3}  Tamanho={4} GiB  Serial={5}" -f `
        ($index + 1), $target.disk_number, $target.drive_letter, $target.volume_label, $gib, $serial)
}

$selection = Read-Host 'Digite o numero do pendrive que sera APAGADO para receber o OrdaX'
$selectedIndex = 0
if (-not [int]::TryParse($selection, [ref]$selectedIndex) -or $selectedIndex -lt 1 -or $selectedIndex -gt $targets.Count) {
    throw 'Selecao invalida. Nenhum disco foi alterado.'
}
$target = $targets[$selectedIndex - 1]
$token = [string]$target.confirmation_token
if ($token.Length -ne 64) { throw 'Target confirmation token is invalid.' }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$preparedPath = Join-Path $env:TEMP ("ordax-physical-{0}-{1}.raw" -f $target.disk_number, $timestamp)
if (Test-Path -LiteralPath $preparedPath) { throw "Temporary physical image already exists: $preparedPath" }

Write-Host ''
Write-Host 'Preparando a imagem exatamente para a capacidade deste pendrive...'
$prepareText = (& $Creator prepare --confirm $token --seed $Seed --out $preparedPath | Out-String)
if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $preparedPath -Force -ErrorAction SilentlyContinue
    throw 'Physical image preparation failed. No physical disk was written.'
}
$prepared = $prepareText | ConvertFrom-Json

$preparedImage = $prepared.prepared_image
$authorization = [string]$prepared.destructive_authorization
$confirmationPhrase = "APAGAR PHYSICALDRIVE$($target.disk_number) $($token.Substring(0, 8))"

Write-Host ''
Write-Host 'ATENCAO: a proxima etapa e destrutiva.' -ForegroundColor Yellow
Write-Host ("Alvo: PhysicalDrive{0} / unidade {1} / {2} bytes" -f $target.disk_number, $target.drive_letter, $target.physical_disk_bytes)
Write-Host ("Imagem preparada SHA-256: {0}" -f $preparedImage.sha256)
Write-Host 'Todos os dados existentes nesse pendrive serao perdidos.' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Para autorizar ESTE disco, digite exatamente:'
Write-Host $confirmationPhrase -ForegroundColor Cyan
$userPhrase = Read-Host 'Confirmacao'
if ($userPhrase -cne $confirmationPhrase) {
    Remove-Item -LiteralPath $preparedPath -Force -ErrorAction SilentlyContinue
    throw 'Confirmacao destrutiva nao corresponde ao alvo atual. Nenhum disco foi escrito.'
}

Write-Host ''
Write-Host 'Revalidando o USB e gravando. Nao remova o pendrive durante esta etapa...'
try {
    $applyText = (& $Creator apply `
        --confirm $token `
        --image ([string]$preparedImage.path) `
        --sha256 ([string]$preparedImage.sha256) `
        --size ([string]$preparedImage.size_bytes) `
        --authorize $authorization | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'Physical apply failed.' }
    $apply = $applyText | ConvertFrom-Json
    if ($apply.status -ne 'pass-readback-verified') {
        throw "Unexpected apply status: $($apply.status)"
    }
    Write-Host ''
    Write-Host 'USB_WRITE=PASS_READBACK_VERIFIED' -ForegroundColor Green
    Write-Host ("PhysicalDrive{0} foi gravado e relido com SHA-256 verificado." -f $apply.result.disk_number) -ForegroundColor Green
    Write-Host 'Proxima etapa: remover o pendrive com seguranca e iniciar o notebook por UEFI/USB.'
} finally {
    Remove-Item -LiteralPath $preparedPath -Force -ErrorAction SilentlyContinue
}
