# Trusts the Odysseus code-signing certificate for the current Windows user, so signed
# Odysseus builds show "Odysseus" as a verified publisher instead of "Unknown publisher".
#
#   powershell -ExecutionPolicy Bypass -File install-certificate.ps1            # trust
#   powershell -ExecutionPolicy Bypass -File install-certificate.ps1 -Remove    # untrust
#
# Run it from the folder holding odysseus-codesign.cer. No administrator rights needed;
# Windows asks you to confirm adding the certificate.

param([switch]$Remove)
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Security, PKI

$expected = '8BA7F8403BDBDB07C8ADA30688B5D1FE6293C9D1'
$stores = 'Cert:\CurrentUser\Root', 'Cert:\CurrentUser\TrustedPublisher'

if ($Remove) {
  foreach ($s in $stores) { Get-ChildItem $s | Where-Object Thumbprint -eq $expected | Remove-Item }
  Write-Host 'Odysseus certificate removed.'
  return
}

$cerPath = Join-Path $PSScriptRoot 'odysseus-codesign.cer'
$cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2 $cerPath
if ($cert.Thumbprint -ne $expected) {
  throw "Unexpected certificate thumbprint $($cert.Thumbprint). Download odysseus-codesign.cer again from the official release."
}

foreach ($s in $stores) { Import-Certificate -FilePath $cerPath -CertStoreLocation $s | Out-Null }
Write-Host "Trusted: $($cert.Subject)  ($expected)"
