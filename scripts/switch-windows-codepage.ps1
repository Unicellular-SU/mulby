[CmdletBinding()]
param(
  [ValidateSet('status', 'gbk', 'utf8', 'session-gbk', 'session-utf8')]
  [string]$Mode = 'status',

  [switch]$NoRestartPrompt
)

$ErrorActionPreference = 'Stop'

$CodePageKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage'
$BackupDir = Join-Path $PSScriptRoot 'codepage-backups'

$Profiles = @{
  gbk = [ordered]@{
    ACP   = '936'
    OEMCP = '936'
    MACCP = '10008'
  }
  utf8 = [ordered]@{
    ACP   = '65001'
    OEMCP = '65001'
    MACCP = '65001'
  }
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-CodePageStatus {
  $codePage = Get-ItemProperty -LiteralPath $CodePageKey

  [pscustomobject]@{
    RegistryACP             = $codePage.ACP
    RegistryOEMCP           = $codePage.OEMCP
    RegistryMACCP           = $codePage.MACCP
    ActiveConsoleCodePage   = (& chcp) -replace '[^\d]', ''
    ConsoleInputEncoding    = ('{0} ({1})' -f [Console]::InputEncoding.WebName, [Console]::InputEncoding.CodePage)
    ConsoleOutputEncoding   = ('{0} ({1})' -f [Console]::OutputEncoding.WebName, [Console]::OutputEncoding.CodePage)
    PowerShellOutputEncoding = ('{0} ({1})' -f $OutputEncoding.WebName, $OutputEncoding.CodePage)
    SystemLocale            = (Get-WinSystemLocale).Name
  }
}

function Show-Status {
  Write-Host ''
  Write-Host 'Current Windows code page status:'
  Get-CodePageStatus | Format-List

  Write-Host 'Modes:'
  Write-Host '  gbk          Set system ANSI/OEM code pages to GBK/936 for legacy Chinese apps. Requires admin + reboot.'
  Write-Host '  utf8         Set system ANSI/OEM code pages to UTF-8/65001. Requires admin + reboot.'
  Write-Host '  session-gbk  Set this console window to code page 936.'
  Write-Host '  session-utf8 Set this console window to code page 65001.'
  Write-Host ''
  Write-Host 'Examples:'
  Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\switch-windows-codepage.ps1 status'
  Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\switch-windows-codepage.ps1 gbk'
  Write-Host '  . .\scripts\switch-windows-codepage.ps1 session-gbk'
}

function Ensure-AdminForSystemChange {
  if (Test-IsAdmin) {
    return
  }

  if (-not $PSCommandPath) {
    throw 'System mode requires an elevated PowerShell session.'
  }

  $args = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $PSCommandPath),
    '-Mode', $Mode
  )

  if ($NoRestartPrompt) {
    $args += '-NoRestartPrompt'
  }

  Write-Host 'Requesting administrator permission...'
  Start-Process -FilePath 'powershell.exe' -ArgumentList $args -Verb RunAs | Out-Null
  exit
}

function Backup-CodePageKey {
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupFile = Join-Path $BackupDir "nls-codepage-$stamp.reg"

  & reg.exe export 'HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage' $backupFile /y | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to export registry backup to $backupFile"
  }

  Write-Host "Backup written to: $backupFile"
}

function Set-SystemCodePage {
  param(
    [Parameter(Mandatory)]
    [ValidateSet('gbk', 'utf8')]
    [string]$Target
  )

  Ensure-AdminForSystemChange

  Write-Host 'Before:'
  Get-CodePageStatus | Format-List

  Backup-CodePageKey

  foreach ($entry in $Profiles[$Target].GetEnumerator()) {
    Set-ItemProperty -LiteralPath $CodePageKey -Name $entry.Key -Value $entry.Value
  }

  Write-Host ''
  Write-Host "Changed system code page profile to: $Target"
  Write-Host 'After registry values:'
  Get-CodePageStatus | Format-List
  Write-Host 'Restart Windows for the change to fully affect legacy apps and new terminals.'

  if (-not $NoRestartPrompt) {
    $answer = Read-Host 'Restart now? Type Y to restart, anything else to skip'
    if ($answer -eq 'Y') {
      Restart-Computer
    }
  }
}

function Set-SessionCodePage {
  param(
    [Parameter(Mandatory)]
    [ValidateSet(936, 65001)]
    [int]$CodePage
  )

  & chcp.com $CodePage | Out-Host

  $encoding = [Text.Encoding]::GetEncoding($CodePage)
  [Console]::InputEncoding = $encoding
  [Console]::OutputEncoding = $encoding
  $script:OutputEncoding = $encoding
  $global:OutputEncoding = $encoding

  Write-Host ''
  Write-Host "This console is now using code page $CodePage."
  Write-Host 'If you did not dot-source this script, PowerShell $OutputEncoding changed only inside the script process.'
}

switch ($Mode) {
  'status' { Show-Status }
  'gbk' { Set-SystemCodePage -Target 'gbk' }
  'utf8' { Set-SystemCodePage -Target 'utf8' }
  'session-gbk' { Set-SessionCodePage -CodePage 936 }
  'session-utf8' { Set-SessionCodePage -CodePage 65001 }
}
