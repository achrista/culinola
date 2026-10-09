<#
  Culinola – Monitor ein und aus (Windows)

  Ein kleines Hilfsprogramm für den Rechner, an dem die Anzeige hängt. Es hört über den
  Echtzeitkanal von Culinola mit und schaltet den Bildschirm dieses Rechners aus und ein:

    * auf zwei Meldungen hin (Vorgabe "monitor-aus" und "monitor-an"), die etwa eine Regel der
      Haussteuerung über POST /api/v1/events/<name> auslöst, oder
    * nach einem Datenpunkt: eingeschaltet oder größer als null heißt "an", sonst "aus".

  Es gehört nicht zu Culinola selbst: Ein Browser kann keinen Monitor schalten, und wie das geht,
  hängt am Betriebssystem. Die Einstellungen stehen in monitor.json neben dieser Datei.

  Aufruf zum Ausprobieren, ohne dass wirklich geschaltet wird:
    powershell -ExecutionPolicy Bypass -File monitor.ps1 -DryRun
#>
param(
  # Einstellungen; ohne Angabe monitor.json neben diesem Skript
  [string]$Config = (Join-Path $PSScriptRoot 'monitor.json'),
  # Nur mitschreiben, was geschähe – der Monitor bleibt, wie er ist
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$logFile = Join-Path $PSScriptRoot 'monitor.log'

function Write-Log([string]$Text) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text
  Write-Host $line
  try {
    # Das Protokoll bleibt klein: Ab 200 KB beginnt es neu
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 200KB)) { Remove-Item $logFile -Force }
    Add-Content -Path $logFile -Value $line -Encoding UTF8
  } catch { }
}

if (-not (Test-Path $Config)) { Write-Log "Einstellungen fehlen: $Config (Vorlage: monitor.example.json)"; exit 1 }
$settings = Get-Content -Path $Config -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $settings.server) { Write-Log 'In monitor.json fehlt "server", etwa http://192.168.178.10:8090'; exit 1 }
$onEvent = if ($settings.on) { [string]$settings.on } else { 'monitor-an' }
$offEvent = if ($settings.off) { [string]$settings.off } else { 'monitor-aus' }
$datapoint = [string]$settings.datapoint

# Der Bildschirm wird über Windows selbst geschaltet – so, wie es auch der Energiesparmodus tut.
# Die Nachricht geht an alle Fenster; das Einschalten bekommt zusätzlich eine winzige Mausbewegung,
# weil nicht jeder Bildschirm allein auf die Nachricht hin aufwacht.
Add-Type -Namespace Culinola -Name Screen -MemberDefinition @'
[DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll")] static extern void mouse_event(int flags, int dx, int dy, int data, UIntPtr extra);
static readonly IntPtr AllWindows = (IntPtr)0xFFFF;
const int SystemCommand = 0x0112;
const int MonitorPower = 0xF170;
public static void Off() { PostMessage(AllWindows, SystemCommand, (IntPtr)MonitorPower, (IntPtr)2); }
public static void On() {
  PostMessage(AllWindows, SystemCommand, (IntPtr)MonitorPower, (IntPtr)(-1));
  mouse_event(0x0001, 0, 1, 0, UIntPtr.Zero);
  System.Threading.Thread.Sleep(40);
  mouse_event(0x0001, 0, -1, 0, UIntPtr.Zero);
}
'@

$script:state = ''
function Set-Monitor([bool]$On, [string]$Why) {
  $wanted = if ($On) { 'an' } else { 'aus' }
  # Ein Datenpunkt meldet seinen Wert immer wieder; geschaltet wird nur bei einem Wechsel
  if ($datapoint -and $script:state -eq $wanted) { return }
  $script:state = $wanted
  if ($DryRun) { Write-Log "Probelauf: Monitor $wanted ($Why)"; return }
  Write-Log "Monitor $wanted ($Why)"
  if ($On) { [Culinola.Screen]::On() } else { [Culinola.Screen]::Off() }
}

function Test-On($Value) {
  if ($Value -is [bool]) { return $Value }
  if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) { return $Value -gt 0 }
  return @('on', 'an', 'true', 'ein') -contains ([string]$Value).Trim().ToLower()
}

# Der Echtzeitkanal: dieselbe Adresse wie die Anzeige, nur als WebSocket
$address = ([string]$settings.server).TrimEnd('/') -replace '^http', 'ws'
$address = "$address/api/v1/stream"
if ($settings.token) { $address += '?token=' + [Uri]::EscapeDataString([string]$settings.token) }
# Als Liste festgelegt: Sonst macht PowerShell aus einer Liste mit einem Eintrag einen einzelnen Text
[string[]]$topics = if ($datapoint) { "dp/$datapoint" } else { "event/$onEvent", "event/$offEvent" }
$subscribe = [Text.Encoding]::UTF8.GetBytes((@{ op = 'sub'; topics = $topics } | ConvertTo-Json -Compress))

$mode = if ($datapoint) { "Datenpunkt $datapoint" } else { "Meldungen $offEvent und $onEvent" }
$dry = if ($DryRun) { ' (Probelauf, es wird nicht geschaltet)' } else { '' }
Write-Log "Monitorsteuerung gestartet: $($settings.server), $mode$dry"

$pause = 2
while ($true) {
  $socket = New-Object System.Net.WebSockets.ClientWebSocket
  $socket.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(20)
  $none = [Threading.CancellationToken]::None
  try {
    [void]$socket.ConnectAsync([Uri]$address, $none).GetAwaiter().GetResult()
    [void]$socket.SendAsync((New-Object ArraySegment[byte] (, $subscribe)), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $none).GetAwaiter().GetResult()
    Write-Log 'Mit Culinola verbunden.'
    $pause = 2
    $buffer = New-Object byte[] 65536
    while ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $text = New-Object Text.StringBuilder
      do {
        $part = $socket.ReceiveAsync((New-Object ArraySegment[byte] (, $buffer)), $none).GetAwaiter().GetResult()
        [void]$text.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $part.Count))
      } until ($part.EndOfMessage)
      if ($part.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { break }
      try { $message = $text.ToString() | ConvertFrom-Json } catch { continue }
      if ($message.t -eq "dp/$datapoint" -and $datapoint) { Set-Monitor (Test-On $message.d.value) "Datenpunkt meldet $($message.d.value)" }
      elseif ($message.t -eq "event/$offEvent") { Set-Monitor $false "Meldung $offEvent" }
      elseif ($message.t -eq "event/$onEvent") { Set-Monitor $true "Meldung $onEvent" }
    }
    Write-Log 'Verbindung beendet, neuer Versuch folgt.'
  } catch {
    $reason = $_.Exception.Message
    if ($_.Exception.InnerException) { $reason = $_.Exception.InnerException.Message }
    Write-Log "Keine Verbindung zu Culinola: $reason"
  } finally {
    $socket.Dispose()
  }
  Start-Sleep -Seconds $pause
  # Bleibt Culinola länger weg, wird seltener nachgefragt – höchstens jede Minute
  $pause = [Math]::Min(60, $pause * 2)
}
