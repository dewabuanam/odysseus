# Run by the Odysseus installer before it installs the app.
#
#   ensure-git.ps1 -Check     exit 0 if Git 2.36+ is installed, 1 if it's missing or too old
#   ensure-git.ps1 -Install   download the official Git for Windows installer, verify its
#                             signature and install it silently (asks for UAC). Exit 0 on success.

param([switch]$Check, [switch]$Install)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$minimum = [version]'2.36'

function Find-Git {
  $candidates = @()
  $onPath = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += $onPath.Source }
  foreach ($key in 'HKLM:\SOFTWARE\GitForWindows', 'HKCU:\SOFTWARE\GitForWindows') {
    $p = (Get-ItemProperty $key -ErrorAction SilentlyContinue).InstallPath
    if ($p) { $candidates += Join-Path $p 'cmd\git.exe' }
  }
  $candidates += "$env:ProgramFiles\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
  foreach ($c in $candidates) {
    if (-not (Test-Path $c)) { continue }
    $out = & $c --version 2>$null
    if ($out -match '(\d+\.\d+(\.\d+)?)') { return [pscustomobject]@{ Path = $c; Version = [version]$Matches[1] } }
  }
  return $null
}

if ($Check) {
  $git = Find-Git
  if ($git -and $git.Version -ge $minimum) { Write-Output "$($git.Path) $($git.Version)"; exit 0 }
  exit 1
}

if ($Install) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { '64-bit' }
    $release = Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest' `
      -Headers @{ 'User-Agent' = 'Odysseus-Installer' }
    $asset = $release.assets | Where-Object { $_.name -match "^Git-[\d.]+-$arch\.exe$" } | Select-Object -First 1
    if (-not $asset) { throw "No Git for Windows $arch installer in release $($release.tag_name)." }

    $file = Join-Path $env:TEMP $asset.name
    Invoke-WebRequest $asset.browser_download_url -OutFile $file -UseBasicParsing

    # Only run it if it's genuinely signed by the Git for Windows maintainer.
    $sig = Get-AuthenticodeSignature $file
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Johannes Schindelin') {
      Remove-Item $file -Force
      throw "The downloaded Git installer's signature could not be verified ($($sig.Status))."
    }

    $setupArgs = '/VERYSILENT /NORESTART /NOCANCEL /SP- /SUPPRESSMSGBOXES /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS'
    $p = Start-Process $file -ArgumentList $setupArgs -Verb RunAs -Wait -PassThru
    Remove-Item $file -Force -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0) { throw "Git setup exited with code $($p.ExitCode)." }

    $git = Find-Git
    if (-not $git -or $git.Version -lt $minimum) { throw 'Git setup finished but git.exe was not found.' }
    Write-Output "$($git.Path) $($git.Version)"
    exit 0
  } catch {
    Write-Output $_.Exception.Message
    exit 1
  }
}
