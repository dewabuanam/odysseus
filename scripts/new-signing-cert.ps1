# Creates the self-signed code-signing certificate used to sign Windows builds.
#
#   Private key (secret):  $HOME\.odysseus-signing\odysseus-codesign.pfx  + password.txt
#   Public certificate:    certs\odysseus-codesign.cer  (committed, attached to releases)
#
# The .pfx and its password never go into the repository. Back them up somewhere safe:
# a new certificate means every user has to trust it again.

param([switch]$Force)
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Security, PKI

$secretDir = Join-Path $HOME '.odysseus-signing'
$pfxPath = Join-Path $secretDir 'odysseus-codesign.pfx'
$pwdPath = Join-Path $secretDir 'password.txt'
$cerPath = Join-Path $PSScriptRoot '..\certs\odysseus-codesign.cer'

if ((Test-Path $pfxPath) -and -not $Force) {
  throw "$pfxPath already exists. Pass -Force to replace it (users will have to trust the new certificate)."
}

New-Item -ItemType Directory -Force $secretDir | Out-Null
New-Item -ItemType Directory -Force (Split-Path $cerPath) | Out-Null

$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject 'CN=Odysseus, O=Odysseus' -FriendlyName 'Odysseus code signing' `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable `
  -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(5)

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$plain = [Convert]::ToBase64String($bytes)
$password = ConvertTo-SecureString $plain -AsPlainText -Force

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password | Out-Null
Set-Content -Path $pwdPath -Value $plain -NoNewline
Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null

# The .pfx is now the only copy of the private key we keep.
Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)"

# Restrict the secret folder to the current user.
icacls $secretDir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null

Write-Host "Thumbprint:  $($cert.Thumbprint)"
Write-Host "Private key: $pfxPath"
Write-Host "Public cert: $((Resolve-Path $cerPath).Path)"
