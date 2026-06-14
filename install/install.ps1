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
$checksumsUrl = "https://github.com/$Repo/releases/download/$Version/SHA256SUMS"
$binaryChecksumsUrl = "https://github.com/$Repo/releases/download/$Version/SHA256SUMS_BINARIES"
$targetVersion = $Version.TrimStart("v")
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("specflow-install-" + [System.Guid]::NewGuid())

function Get-InstalledToolVersion {
  param(
    [string]$Path,
    [string]$Kind
  )
  if (-not (Test-Path $Path)) {
    return ""
  }
  try {
    $output = (& $Path --version 2>$null | Select-Object -First 1)
  }
  catch {
    return ""
  }
  if (-not $output) {
    return ""
  }
  $text = [string]$output
  if ($Kind -eq "specflow" -and $text.StartsWith("specflow ")) {
    return $text.Substring("specflow ".Length)
  }
  return $text
}

function Get-Sha256 {
  param([string]$Path)
  return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

function Get-ExpectedChecksum {
  param(
    [string]$ChecksumFile,
    [string]$Target
  )
  foreach ($line in Get-Content $ChecksumFile) {
    $parts = $line -split "\s+", 2
    if ($parts.Length -eq 2 -and $parts[1] -eq $Target) {
      return $parts[0].ToLowerInvariant()
    }
  }
  return ""
}

function Test-BinaryChecksums {
  param(
    [string]$ChecksumFile,
    [string]$SpecflowPath,
    [string]$AflowPath
  )
  $specflowTarget = "specflow-code-windows-$cpu/specflow.exe"
  $aflowTarget = "specflow-code-windows-$cpu/aflow.exe"
  $specflowExpected = Get-ExpectedChecksum -ChecksumFile $ChecksumFile -Target $specflowTarget
  $aflowExpected = Get-ExpectedChecksum -ChecksumFile $ChecksumFile -Target $aflowTarget
  if (-not $specflowExpected -or -not $aflowExpected) {
    return $false
  }
  return (Get-Sha256 $SpecflowPath) -eq $specflowExpected -and (Get-Sha256 $AflowPath) -eq $aflowExpected
}

New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  $installPath = Join-Path $InstallDir $BinName
  $aflowInstallPath = Join-Path $InstallDir $AflowBinName

  $specflowCurrent = Get-InstalledToolVersion -Path $installPath -Kind "specflow"
  $aflowCurrent = Get-InstalledToolVersion -Path $aflowInstallPath -Kind "aflow"
  if ($specflowCurrent -eq $targetVersion -and $aflowCurrent -eq $targetVersion) {
    $binaryChecksumFile = Join-Path $tmp "SHA256SUMS_BINARIES"
    $binaryChecksumsAvailable = $false
    try {
      Invoke-WebRequest -Uri $binaryChecksumsUrl -OutFile $binaryChecksumFile -ErrorAction Stop
      $binaryChecksumsAvailable = Test-BinaryChecksums -ChecksumFile $binaryChecksumFile -SpecflowPath $installPath -AflowPath $aflowInstallPath
    }
    catch {
      $binaryChecksumsAvailable = $false
    }
    if ($binaryChecksumsAvailable) {
      Write-Host "Specflow and Aflow $Version are already up to date."
      return
    }
    Write-Host "Installed version matches $Version but checksum differs or is unavailable; reinstalling..."
  }

  Write-Host "Installing Specflow and Aflow $Version for windows-$cpu..."
  $archive = Join-Path $tmp $asset
  try {
    Invoke-WebRequest -Uri $url -OutFile $archive -ErrorAction Stop
  }
  catch {
    throw "specflow installer: release asset not found: $url"
  }
  $checksums = Join-Path $tmp "SHA256SUMS"
  try {
    Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksums -ErrorAction Stop
  }
  catch {
    throw "specflow installer: checksum file not found: $checksumsUrl"
  }
  $expected = Get-ExpectedChecksum -ChecksumFile $checksums -Target $asset
  if (-not $expected) {
    throw "specflow installer: checksum entry not found for $asset"
  }
  $actual = Get-Sha256 $archive
  if ($actual -ne $expected) {
    throw "specflow installer: checksum mismatch for $asset"
  }
  Expand-Archive -Path $archive -DestinationPath $tmp -Force

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
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
