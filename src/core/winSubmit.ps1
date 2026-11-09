param(
  [string[]]$Keys = @('^{ENTER}', '~')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

$activated = $false
$cursorProc = Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -eq 'Cursor' -and $_.MainWindowHandle -ne [IntPtr]::Zero } |
  Select-Object -First 1

if ($cursorProc) {
  [void][Win32Focus]::SetForegroundWindow($cursorProc.MainWindowHandle)
  $activated = $true
}

if (-not $activated) {
  $shell = New-Object -ComObject WScript.Shell
  foreach ($title in @('Cursor', 'Cursor -')) {
    if ($shell.AppActivate($title)) {
      $activated = $true
      break
    }
  }
}

if (-not $activated) {
  Write-Error 'Could not focus Cursor window'
}

Start-Sleep -Milliseconds 450

foreach ($key in $Keys) {
  [System.Windows.Forms.SendKeys]::SendWait($key)
  Start-Sleep -Milliseconds 120
}
