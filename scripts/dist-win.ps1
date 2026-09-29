# Builds the signed Windows release: setup.exe, portable.exe, zip, the public certificate
# and SHA256SUMS.txt, all in dist/. Run through `npm run dist:win` (it builds the app first).
#
# The signing key is read from $HOME\.odysseus-signing (see scripts/new-signing-cert.ps1),
# never from the repository. Without it the builds are produced unsigned.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$secretDir = Join-Path $HOME '.odysseus-signing'
$pfx = Join-Path $secretDir 'odysseus-codesign.pfx'

if (Test-Path $pfx) {
  $env:CSC_LINK = $pfx
  $env:CSC_KEY_PASSWORD = (Get-Content (Join-Path $secretDir 'password.txt') -Raw).Trim()
} else {
  Write-Warning "No signing key at $pfx; building unsigned."
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
}

Push-Location $root
try {
  npx electron-builder --win nsis portable zip
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
  Remove-Item Env:CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
}

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
Copy-Item (Join-Path $root 'certs\odysseus-codesign.cer'), (Join-Path $root 'certs\install-certificate.ps1') $dist

$files = "Odysseus-$version-setup.exe", "Odysseus-$version-portable.exe", "Odysseus-$version-win.zip",
  'odysseus-codesign.cer', 'install-certificate.ps1'
$sums = foreach ($f in $files) {
  $stream = [IO.File]::OpenRead((Join-Path $dist $f))
  try { $hash = -join ([Security.Cryptography.SHA256]::Create().ComputeHash([IO.Stream]$stream) | ForEach-Object { $_.ToString('x2') }) }
  finally { $stream.Dispose() }
  "$hash *$f"
}
Set-Content (Join-Path $dist 'SHA256SUMS.txt') $sums
$sums
