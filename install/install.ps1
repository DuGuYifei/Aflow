param(
  [string]$RequestedVersion = ""
)

$ErrorActionPreference = "Stop"

$Repo = if ($env:SPECFLOW_REPO) { $env:SPECFLOW_REPO } else { "DuGuYifei/Aflow" }
$InstallDir = if ($env:SPECFLOW_INSTALL_DIR) { $env:SPECFLOW_INSTALL_DIR } else { Join-Path $HOME ".local\bin" }
$BinName = if ($env:SPECFLOW_BIN_NAME) { $env:SPECFLOW_BIN_NAME } else { "specflow.exe" }
$AflowBinName = if ($env:AFLOW_BIN_NAME) { $env:AFLOW_BIN_NAME } else { "aflow.exe" }
$Version = if ($RequestedVersion) { $RequestedVersion } elseif ($env:SPECFLOW_VERSION) { $env:SPECFLOW_VERSION } else { "" }

if (-not $Version) {
  $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases"
  $release = $releases | Where-Object { $_.tag_name -match '^v\d+\.\d+\.\d+$' } | Select-Object -First 1
  if (-not $release) {
    $release = $releases | Where-Object { $_.tag_name -match '^v\d+\.\d+\.\d+-[0-9A-Za-z.-]+$' } | Select-Object -First 1
  }
  if (-not $release) {
    throw "specflow installer: could not resolve the latest release for $Repo"
  }
  $Version = $release.tag_name
}

$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
switch ($arch) {
  "X64" { $cpu = "x64" }
  default { throw "specflow installer: unsupported CPU: $arch" }
}

$asset = "specflow-code-windows-$cpu.zip"
$url = "https://github.com/$Repo/releases/download/$Version/$asset"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("specflow-install-" + [System.Guid]::NewGuid())

New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  Write-Host "Installing Specflow and Aflow $Version for windows-$cpu..."
  $archive = Join-Path $tmp $asset
  try {
    Invoke-WebRequest -Uri $url -OutFile $archive
  }
  catch {
    throw "specflow installer: release asset not found: $url"
  }
  Expand-Archive -Path $archive -DestinationPath $tmp -Force

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $installPath = Join-Path $InstallDir $BinName
  $aflowInstallPath = Join-Path $InstallDir $AflowBinName
  Move-Item -Force -Path (Join-Path $tmp "specflow.exe") -Destination $installPath
  Move-Item -Force -Path (Join-Path $tmp "aflow.exe") -Destination $aflowInstallPath

  Write-Host "Specflow installed to $installPath"
  Write-Host "Aflow installed to $aflowInstallPath"
  if (-not (Get-Command "specflow" -ErrorAction SilentlyContinue)) {
    Write-Host "Add $InstallDir to PATH to run 'specflow' from any shell."
  }
  if (-not (Get-Command "aflow" -ErrorAction SilentlyContinue)) {
    Write-Host "Add $InstallDir to PATH to run 'aflow' from any shell."
  }
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
