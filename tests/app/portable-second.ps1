# A second launch of the portable hands over to the first and leaves its files alone.
# pwsh -File tests/app/portable-second.ps1 -Exe <portable exe> -Run <empty test folder>
# Only touches its own processes. Stops if a copy is already running.
param([Parameter(Mandatory)][string]$Exe, [Parameter(Mandatory)][string]$Run)
if (Get-Process -Name 'SillyTavern Desktop', 'SillyTavern-Desktop' -ErrorAction SilentlyContinue) { 'STOP: a copy is already running'; exit 2 }
Remove-Item -Recurse -Force $Run -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$Run\data", "$Run\tmp" | Out-Null
'{"autoStart":false,"checkUpdatesOnLaunch":false,"checkAppUpdates":false,"confirmBeforeQuit":false}' | Set-Content "$Run\data\settings.json"
$env:TEMP = "$Run\tmp"; $env:TMP = "$Run\tmp"
$script:fails = 0
function Check($name, $ok, $info = '') { if (-not $ok) { $script:fails++ }; "{0}  {1}  {2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $info }
function AppFiles { (Get-ChildItem "$Run\tmp" -Recurse -File -Force -Filter 'app.asar' | Measure-Object).Count; }
function AllFiles { (Get-ChildItem "$Run\tmp" -Recurse -File -Force | Measure-Object).Count }

$a = Start-Process $Exe -ArgumentList "--user-data-dir=$Run\data", '--remote-debugging-port=9871' -PassThru
Start-Sleep 16
$before = AllFiles
Check 'first copy runs' (-not $a.HasExited) "$before files unpacked"

$b = Start-Process $Exe -ArgumentList "--user-data-dir=$Run\data" -PassThru
$t0 = Get-Date
while (-not $b.HasExited -and ((Get-Date) - $t0).TotalSeconds -lt 45) { Start-Sleep -Milliseconds 500 }
Check 'second launch ends by itself' $b.HasExited ("{0:n1} s" -f ((Get-Date) - $t0).TotalSeconds)
if (-not $b.HasExited) { Stop-Process -Id $b.Id -Force }
Start-Sleep 2
Check 'first copy keeps all its files' ((AllFiles) -ge $before) "$(AllFiles) of $before"
$pages = try { Invoke-RestMethod 'http://127.0.0.1:9871/json/list' -TimeoutSec 5 } catch { @() }
Check 'first copy still answers' (@($pages).Count -ge 1)
$extra = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'SillyTavern Desktop.exe' -and $_.CommandLine -notmatch '--type=' }
Check 'only one main process' (@($extra).Count -eq 1) "$(@($extra).Count)"

# Quit the first copy the way a user does, by closing its window.
$w = Get-Process -Name 'SillyTavern Desktop' -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0
$w | ForEach-Object { [void]$_.CloseMainWindow() }
$t0 = Get-Date
while (-not $a.HasExited -and ((Get-Date) - $t0).TotalSeconds -lt 20) { Start-Sleep -Milliseconds 500 }
Check 'first copy quits' $a.HasExited
if (-not $a.HasExited) { Stop-Process -Id $a.Id -Force; Get-Process -Name 'SillyTavern Desktop' -ErrorAction SilentlyContinue | Stop-Process -Force }
Start-Sleep 3
Check 'unpacked files removed afterwards' ((AllFiles) -lt 5) "$(AllFiles) left"
"`n$script:fails failed"
exit $script:fails
