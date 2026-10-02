# Run by the Odysseus installer after it installs the app, as the installing user.
#
#   ensure-ai.ps1 -Check     list the AI command-line tools that are missing, exit 0 if none are
#   ensure-ai.ps1 -Install   install the missing ones with their official install commands:
#                            Claude Code with its own installer (no Node.js needed), Codex,
#                            Gemini and Copilot with npm when Node.js is installed.
#
# Failures never stop setup: the app installs a missing tool the first time you open it.

param([switch]$Check, [switch]$Install)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# Tools installed moments ago aren't on the PATH this process inherited.
$env:Path = "$HOME\.local\bin;$env:APPDATA\npm;" + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')

$tools = @(
  @{ Name = 'Claude Code'; Command = 'claude'; Npm = $null },
  @{ Name = 'Codex'; Command = 'codex'; Npm = '@openai/codex' },
  @{ Name = 'Gemini'; Command = 'gemini'; Npm = '@google/gemini-cli' },
  @{ Name = 'Copilot'; Command = 'copilot'; Npm = '@github/copilot' }
)
$missing = @($tools | Where-Object { -not (Get-Command $_.Command -ErrorAction SilentlyContinue) })

if ($Check) {
  $missing | ForEach-Object { Write-Output $_.Name }
  if ($missing.Count) { exit 1 } else { exit 0 }
}

if ($Install) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  $report = @()
  foreach ($t in $missing) {
    try {
      if (-not $t.Npm) {
        Invoke-RestMethod 'https://claude.ai/install.ps1' | Invoke-Expression
      } elseif ($npm) {
        & $npm.Source install -g $t.Npm 2>&1 | Out-Null
      } else {
        $report += "$($t.Name): skipped, needs Node.js (https://nodejs.org)"
        continue
      }
      $ok = Get-Command $t.Command -ErrorAction SilentlyContinue
      $report += if ($ok) { "$($t.Name): installed" } else { "$($t.Name): install did not finish" }
    } catch {
      $report += "$($t.Name): $($_.Exception.Message)"
    }
  }
  $report | ForEach-Object { Write-Output $_ }
  exit 0
}
