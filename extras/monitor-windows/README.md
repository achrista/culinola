# Monitor on and off (Windows)

A small helper program for the computer the display is attached to. It switches that computer's screen off and on – for example when a motion detector of the home automation reports that nobody is in the kitchen any more.

It is not part of Culinola itself: a browser cannot switch a monitor, and how it is done depends on the operating system. The script needs no open port on the display computer and no administrator rights.

The requirement is Windows 10 or 11 with the PowerShell that comes with it. Nothing is installed.

## Three ways to control the monitor

**Directly from openHAB** – the simplest, where openHAB controls the house. There is a switch "Screen on" (a Switch item); the rule with the motion detector switches it. The script queries the switch every two seconds: on means on, off means off. Culinola is not involved – the monitor is switched even if its computer's Culinola is off.

```json
{ "openhab": "http://192.168.178.10:8080", "item": "Kueche_Display" }
```

If openHAB requires a login, `"openhabToken"` is added; `"pollSeconds"` changes the interval between queries.

**Via a Culinola datapoint.** For every source Culinola knows, not only openHAB. The script listens on the real-time channel and follows the datapoint: switched on or greater than zero means on.

```json
{ "server": "http://192.168.178.10:8090", "token": "…", "datapoint": "openhab:Kueche_Display" }
```

**Via two Culinola messages.** A rule calls `POST /api/v1/events/monitor-aus` and `…/monitor-an`. So that the displays show nothing in the process, the two are listed in `config.json` as pure signals:

```json
"events": { "monitor-aus": { "show": false }, "monitor-an": { "show": false } }
```

```json
{ "server": "http://192.168.178.10:8090", "token": "…", "off": "monitor-aus", "on": "monitor-an" }
```

With the two ways via Culinola, `server` is its address – not that of the home automation – and `token` is the token of an access of level `read` (empty if the API is open). The computer running Culinola must be reachable from the display computer; under Windows the firewall asks about this the first time Culinola starts.

## Setting up

1. Copy the folder `monitor-windows` to the display computer, for example to `C:\Culinola\monitor-windows`.
2. Copy `monitor.example.json` to `monitor.json` and enter one of the three ways.
3. Try it out without anything being switched:

   ```
   powershell -ExecutionPolicy Bypass -File C:\Culinola\monitor-windows\monitor.ps1 -DryRun
   ```

   The window and `monitor.log` then show what would happen: "Probelauf: Monitor aus (…)" (the script's own wording: "dry run: monitor off").
4. Without `-DryRun` it really switches. To make it run after every sign-in: open the folder `shell:startup` with `Win+R` and create a shortcut there with this target:

   ```
   powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Culinola\monitor-windows\monitor.ps1"
   ```

The script must run in the session of the signed-in user, not as a service – only there does it reach the screen.

## Good to know

- Switching happens through Windows itself, just as power saving does it. When switching on, a tiny mouse movement is added, because not every screen wakes up on the signal alone.
- As long as the monitor is meant to be on, the script repeats the switching on every minute (`keepOnSeconds`, `0` turns this off). This keeps it on even if Windows wanted to turn it off after its own timeout – and it comes back if it did go off after all.
- Every touch and every mouse movement also wakes the screen; the script only turns it off again at the next "off".
- A switch that has never been set (openHAB reports `NULL`) has no effect: the monitor stays as it is.
- If the counterpart cannot be reached, the script keeps trying and reports this once in the log. The screen stays as it is meanwhile.
- `monitor.json` may contain a token and therefore does not belong in the repository; `monitor.log` stays small and starts over from 200 KB.
