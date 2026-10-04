# Builds the Microsoft Store package (dist/Odysseus-<version>.msix). Run through
# `npm run dist:store` (it builds the app first).
#
#   (no switch)  The package to upload to Partner Center. Unsigned: the Store signs it. Its
#                identity comes from the "appx" section of package.json, copied from
#                Partner Center > the app > Product identity.
#   -Test        A package to install on this computer before submitting: signed with the
#                Odysseus signing key from $HOME\.odysseus-signing, its publisher set to that
#                certificate's subject. Install certs/odysseus-codesign.cer first
#                (certs/install-certificate.ps1), then double-click the .msix.

param([switch]$Test)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$appx = $pkg.build.appx

$builderArgs = @('--win', 'appx')
# electron-builder signs nothing here: the Store signs uploads itself, and its bundled signtool
# can't sign the package. A test package is signed afterwards with the Windows SDK's signtool.
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Remove-Item Env:CSC_LINK -ErrorAction SilentlyContinue
if ($Test) {
  $secretDir = Join-Path $HOME '.odysseus-signing'
  $pfx = Join-Path $secretDir 'odysseus-codesign.pfx'
  if (-not (Test-Path $pfx)) { throw "No signing key at $pfx; run scripts/new-signing-cert.ps1 first." }
  $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1
  if (-not $signtool) { throw 'No signtool.exe from the Windows SDK; install the Windows SDK to sign a test package.' }
  $subject = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $root 'certs\odysseus-codesign.cer')).Subject
  $builderArgs += "-c.appx.publisher=$subject"
  if (-not $appx.identityName) { $builderArgs += '-c.appx.identityName=Odysseus.Test' }
} else {
  $missing = @('identityName', 'publisher', 'publisherDisplayName') | Where-Object { -not $appx.$_ }
  if ($missing) {
    throw "Set build.appx.$($missing -join ', build.appx.') in package.json from Partner Center > Product identity, or build with -Test to try the package locally."
  }
  if ($appx.publisher -notmatch '^CN=') { throw "build.appx.publisher should look like CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX (Partner Center > Product identity)." }
}

Push-Location $root
try {
  # Straight through node: npx goes through cmd, which splits a publisher like "CN=a, O=b".
  & node (Join-Path $root 'node_modules\electron-builder\cli.js') @builderArgs
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

$package = Join-Path $root "dist\Odysseus-$($pkg.version).msix"
if ($Test) {
  $password = (Get-Content (Join-Path $secretDir 'password.txt') -Raw).Trim()
  & $signtool.FullName sign /q /fd SHA256 /f $pfx /p $password $package
  if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)" }
}
Get-Item $package | Select-Object Name, @{ n = 'MB'; e = { [Math]::Round($_.Length / 1MB, 1) } }
