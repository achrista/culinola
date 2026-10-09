# Monitor ein und aus (Windows)

Ein kleines Hilfsprogramm für den Rechner, an dem die Anzeige hängt. Es schaltet dessen Bildschirm aus und ein – etwa wenn ein Bewegungsmelder der Haussteuerung meldet, dass niemand mehr in der Küche ist.

Es gehört nicht zu Culinola selbst: Ein Browser kann keinen Monitor schalten, und wie das geht, hängt am Betriebssystem. Das Skript hört aber über denselben Echtzeitkanal mit wie die Anzeige; es braucht deshalb keinen offenen Port am Anzeigerechner und keine Rechte eines Administrators.

Voraussetzung ist Windows 10 oder 11 mit dem mitgelieferten PowerShell. Installiert wird nichts.

## Zwei Wege, den Monitor zu steuern

**Über einen Datenpunkt** – empfohlen. In der Haussteuerung gibt es einen Schalter „Bildschirm an“ (in openHAB ein Switch-Item); die Regel mit dem Bewegungsmelder schaltet ihn. Das Skript folgt dem Schalter: ein heißt an, aus heißt aus. Nach einem Neustart stellt es von selbst den richtigen Zustand her.

```json
{ "server": "http://192.168.178.10:8090", "token": "…", "datapoint": "openhab:Kueche_Display" }
```

**Über zwei Meldungen.** Die Regel ruft Culinola auf: `POST /api/v1/events/monitor-aus` und `…/monitor-an`. Damit die Anzeigen dabei nichts zeigen, stehen die beiden in `config.json` als reine Signale:

```json
"events": { "monitor-aus": { "show": false }, "monitor-an": { "show": false } }
```

```json
{ "server": "http://192.168.178.10:8090", "token": "…", "off": "monitor-aus", "on": "monitor-an" }
```

Ist die API von Culinola geschützt, braucht die Regel dafür das Token eines Zugangs der Stufe `control` – beim ersten Weg braucht sie keines.

## Einrichten

1. Den Ordner `monitor-windows` auf den Anzeigerechner kopieren, etwa nach `C:\Culinola\monitor-windows`.
2. `monitor.example.json` nach `monitor.json` kopieren und anpassen: `server` ist die Adresse von Culinola, `token` das Token eines Zugangs der Stufe `read` (leer, wenn die API offen ist), dazu einer der beiden Wege oben.
3. Ausprobieren, ohne dass geschaltet wird:

   ```
   powershell -ExecutionPolicy Bypass -File C:\Culinola\monitor-windows\monitor.ps1 -DryRun
   ```

   Im Fenster und in `monitor.log` steht dann, was geschähe: „Probelauf: Monitor aus (…)“.
4. Ohne `-DryRun` schaltet es wirklich. Damit es nach jeder Anmeldung läuft: mit `Win+R` den Ordner `shell:startup` öffnen und dort eine Verknüpfung mit diesem Ziel anlegen:

   ```
   powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Culinola\monitor-windows\monitor.ps1"
   ```

Das Skript muss in der Sitzung des angemeldeten Benutzers laufen, nicht als Dienst – nur dort erreicht es den Bildschirm.

## Zu wissen

- Geschaltet wird über Windows selbst, so wie es auch der Energiesparmodus tut. Beim Einschalten kommt eine winzige Mausbewegung dazu, weil nicht jeder Bildschirm allein auf das Signal hin aufwacht.
- Solange der Monitor an sein soll, wiederholt das Skript das Einschalten jede Minute (`keepOnSeconds`, `0` schaltet das ab). So bleibt er an, auch wenn Windows ihn nach seiner eigenen Wartezeit abschalten wollte – und er kommt zurück, falls er doch einmal ausging.
- Jede Berührung und jede Mausbewegung weckt den Bildschirm ebenfalls; das Skript schaltet ihn erst beim nächsten „aus“ wieder ab.
- Ist Culinola nicht erreichbar, versucht das Skript es weiter – erst alle paar Sekunden, dann jede Minute. Der Bildschirm bleibt so lange, wie er ist.
- `monitor.json` enthält das Token und gehört deshalb nicht ins Repository; `monitor.log` bleibt klein und beginnt ab 200 KB neu.
