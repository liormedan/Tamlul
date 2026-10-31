# Puts uv.exe in src-tauri\bin for the installer (bundle.resources in tauri.conf.json).
# Runs before bundling (build.beforeBundleCommand). Downloads a pinned release once and
# checks its SHA-256, so every build ships the same uv.
$ErrorActionPreference = 'Stop'
$Version = '0.12.23'
$Sha256  = '75d05de6762778c31ee183398de7dd15093fad0ed90b1f236d8205ea5ec00c90'
$Asset   = 'uv-x86_64-pc-windows-msvc.zip'

$bin = Join-Path $PSScriptRoot 'bin'
$exe = Join-Path $bin 'uv.exe'
$stamp = Join-Path $bin 'uv.version'
if ((Test-Path $exe) -and (Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $Version)) {
    Write-Host "uv $Version already in $bin"
    exit 0
}

New-Item -ItemType Directory -Force $bin | Out-Null
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("uv-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $tmp | Out-Null
try {
    $zip = Join-Path $tmp $Asset
    $url = "https://github.com/astral-sh/uv/releases/download/$Version/$Asset"
    Write-Host "Downloading $url"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $Sha256) { throw "uv checksum mismatch: expected $Sha256, got $actual" }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    Copy-Item (Join-Path $tmp 'uv.exe') $exe -Force
    Set-Content -Path $stamp -Value $Version -Encoding ascii
    Write-Host "uv $Version -> $exe"
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
