# Installer checks on a test build with its own app id and name, so a real
# install on the same PC is never touched. Every install goes to -Root.
#   pwsh -File tests/installer/sidebyside.ps1 -New <new Setup.exe> -Old <old one-click Setup.exe> -Root <empty test folder>
# Build both with: -c.appId=com.fox.sillytaverndesktop.test "-c.productName=ST Desktop Test"
# (the old one with -c.nsis.oneClick=true and an Open-with id of its own).
param([Parameter(Mandatory)][string]$New, [Parameter(Mandatory)][string]$Old, [Parameter(Mandatory)][string]$Root)
$ErrorActionPreference = 'Stop'
$name = 'ST Desktop Test'
$script:fails = 0
function Check($label, $ok, $info = '') { if (-not $ok) { $script:fails++ }; '{0}  {1}  {2}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $label, $info }
function Key { Get-ChildItem 'HKCU:\Software' -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).InstallLocation -like "$Root*" } | Select-Object -First 1 }
function Loc { $k = Key; if ($k) { (Get-ItemProperty $k.PSPath).InstallLocation } }
# The uninstaller restarts itself from %TEMP% and returns at once: wait until the app is gone.
function WaitGone($exe) { for ($i = 0; $i -lt 40 -and (Test-Path $exe); $i++) { Start-Sleep -Milliseconds 500 } }
function Uninstalls { Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object DisplayName -like "$name*" }
function RealState {
    $u = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like 'SillyTavern Desktop*' } | ForEach-Object { "$($_.DisplayName)|$($_.DisplayVersion)|$($_.InstallLocation)" }
    $p = (Get-ItemProperty 'HKCU:\Software\Classes\SillyTavernDesktop.Import\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
    $o = foreach ($e in '.png', '.json', '.charx', '.byaf', '.yaml', '.yml', '.sttheme') { (Get-ItemProperty "HKCU:\Software\Classes\$e\OpenWithProgids" -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains 'SillyTavernDesktop.Import' }
    "$u ## $p ## $($o -join ',')"
}
function Run($exe, [string[]]$a) { $p = Start-Process $exe -ArgumentList $a -PassThru -Wait; $p.ExitCode }

Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class Win {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32")] public static extern bool EnumChildWindows(IntPtr h, P p, IntPtr l);
  [DllImport("user32")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, StringBuilder l);
  [DllImport("user32", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, string l);
  public static string Text(IntPtr h) { var s = new StringBuilder(1024); SendMessage(h, 0x0D, (IntPtr)1024, s); return s.ToString(); }
  public static string Cls(IntPtr h) { var s = new StringBuilder(128); GetClassName(h, s, 128); return s.ToString(); }
  public static List<IntPtr> Kids(uint pid) { var o = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) { o.Add(h); EnumChildWindows(h, (c, m) => { o.Add(c); return true; }, IntPtr.Zero); } return true; }, IntPtr.Zero);
    return o; }
}
'@

if (Get-ChildItem $Root -ErrorAction SilentlyContinue) { 'STOP: -Root must be empty or missing'; exit 2 }
if (Uninstalls) { 'STOP: a test install is already there'; exit 2 }
New-Item -ItemType Directory -Force $Root | Out-Null
$real = RealState

# 1. The folder page: suggests the roomiest drive that isn't Windows', refuses Windows' folders, no admin prompt.
$p = Start-Process $New -PassThru
$edit = $null
for ($i = 0; $i -lt 40 -and -not $edit; $i++) { Start-Sleep -Milliseconds 500; $edit = [Win]::Kids($p.Id) | Where-Object { [Win]::Cls($_) -eq 'Edit' } | Select-Object -First 1 }
$uac = Get-Process consent -ErrorAction SilentlyContinue
Check 'no admin prompt' (-not $uac)
Check 'folder page shown' ([bool]$edit)
if ($edit) {
    $best = (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Z]:\\$' -and $_.Root -ne "$env:SystemDrive\" -and $_.Free -ge 5GB } | Sort-Object Free -Descending | Select-Object -First 1).Root
    $want = if ($best) { "${best}SillyTavern Desktop" } else { '' }
    $got = [Win]::Text($edit)
    Check 'suggests the roomiest drive that isn''t Windows''' ($got -eq $want -or -not $best) "$got"
    $next = [Win]::Kids($p.Id) | Where-Object { [Win]::Cls($_) -eq 'Button' -and [Win]::Text($_) -match 'Install|Next' } | Select-Object -First 1
    $lower = "$env:ProgramFiles".ToLower(), "$env:SystemRoot".ToLower()
    foreach ($bad in "$env:ProgramFiles\ST", "$env:SystemRoot", "$env:ProgramData\ST", "$(${env:ProgramFiles(x86)})\ST", "$($lower[0])\st", "$($lower[1])\temp") {
        [void][Win]::SendMessage($edit, 0x0C, [IntPtr]::Zero, $bad); Start-Sleep -Milliseconds 300
        Check "refuses $bad" (-not [Win]::IsWindowEnabled($next))
    }
    foreach ($good in 'D:\Games\ST', "$env:SystemDrive\Games\ST", "$env:ProgramFiles Extra\ST") {
        [void][Win]::SendMessage($edit, 0x0C, [IntPtr]::Zero, $good); Start-Sleep -Milliseconds 300
        Check "allows $good" ([Win]::IsWindowEnabled($next))
    }
}
Stop-Process -Id $p.Id -Force; Start-Sleep 1
Check 'nothing installed by looking' (-not (Uninstalls))

# 2. Fresh silent install into a folder of our choice.
$app = Join-Path $Root 'new\SillyTavern Desktop'
$code = Run $New @('/S', "/D=$app")
$u = Uninstalls
Check 'installs silently without admin' ($code -eq 0 -and $u -and (Test-Path (Join-Path $app "$name.exe"))) "exit $code"
Check 'remembers the folder' ((Loc) -eq $app) (Loc)
$progid = (Get-ItemProperty 'HKCU:\Software\Classes\com.fox.sillytaverndesktop.test.Import\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
Check 'Open with uses the test id' ($progid -like "*$app*") $progid

# 3. The app keeps its data beside the install folder.
$beside = Join-Path $Root 'new\SillyTavern Desktop Data'
$env:ST_DESKTOP_APPDATA = Join-Path $Root 'fake-appdata'
$a = Start-Process (Join-Path $app "$name.exe") -ArgumentList '--remote-debugging-port=9661' -PassThru
Start-Sleep 12
Check 'data beside the install folder' (Test-Path (Join-Path $beside 'Local State'))
Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | ForEach-Object { [void]$_.CloseMainWindow() }
for ($i = 0; $i -lt 30 -and (Get-Process -Name $name -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item Env:\ST_DESKTOP_APPDATA
Set-Content (Join-Path $beside 'keep-me.txt') 'test'

# 4. A silent update (what self-update runs) keeps the folder and the data.
$code = Run $New @('--updated', '/S')
Check 'update keeps the folder' ($code -eq 0 -and (Loc) -eq $app -and (Test-Path (Join-Path $app "$name.exe"))) "exit $code"
Check 'update keeps the data' (Test-Path (Join-Path $beside 'keep-me.txt'))

# 5. Uninstall: app and registry go, data stays.
$un = Join-Path $app "Uninstall $name.exe"
$code = Run $un @('/S')
WaitGone (Join-Path $app "$name.exe"); Start-Sleep 2
Check 'uninstall removes the app' (-not (Test-Path (Join-Path $app "$name.exe")) -and -not (Uninstalls)) "exit $code"
Check 'uninstall removes Open with' (-not (Test-Path 'HKCU:\Software\Classes\com.fox.sillytaverndesktop.test.Import'))
Check 'uninstall keeps the data' (Test-Path (Join-Path $beside 'keep-me.txt'))

# 6. An old one-click install updates to the new installer in place, silently.
$oldApp = Join-Path $Root 'old\sillytavern-desktop'
$code = Run $Old @('/S', "/D=$oldApp")
Check 'old one-click install' ($code -eq 0 -and (Test-Path (Join-Path $oldApp "$name.exe"))) "exit $code"
$code = Run $New @('--updated', '/S')
Check 'new installer updates it in place' ($code -eq 0 -and (Loc) -eq $oldApp -and (Test-Path (Join-Path $oldApp "$name.exe"))) "exit $code"
Check 'one entry in Apps' (@(Uninstalls).Count -eq 1)

# 7. Reinstalling somewhere else (what someone moving off C: does) leaves one install.
$moved = Join-Path $Root 'moved\SillyTavern Desktop'
$code = Run $New @('/S', "/D=$moved")
Check 'moves to the new folder' ($code -eq 0 -and (Loc) -eq $moved -and (Test-Path (Join-Path $moved "$name.exe"))) "exit $code"
Check 'old folder removed' (-not (Test-Path (Join-Path $oldApp "$name.exe")))
Check 'still one entry in Apps' (@(Uninstalls).Count -eq 1)
$code = Run (Join-Path $moved "Uninstall $name.exe") @('/S'); WaitGone (Join-Path $moved "$name.exe"); Start-Sleep 2
Check 'clean at the end' (-not (Uninstalls)) "exit $code"

Check 'the real install untouched' ((RealState) -eq $real)
foreach ($l in "$env:USERPROFILE\Desktop\$name.lnk", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\$name.lnk") { if (Test-Path $l) { Check "shortcut left: $l" $false } }
"`n$script:fails failed"
exit $script:fails
