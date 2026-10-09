# Monitor ein und aus (Windows)

Ein kleines Hilfsprogramm für den Rechner, an dem die Anzeige hängt. Es schaltet dessen Bildschirm aus und ein – etwa wenn ein Bewegungsmelder der Haussteuerung meldet, dass niemand mehr in der Küche ist.

Es gehört nicht zu Culinola selbst: Ein Browser kann keinen Monitor schalten, und wie das geht, hängt am Betriebssystem. Das Skript braucht keinen offenen Port am Anzeigerechner und keine Rechte eines Administrators.

Voraussetzung ist Windows 10 oder 11 mit dem mitgelieferten PowerShell. Installiert wird nichts.

## Drei Wege, den Monitor zu steuern

**Direkt aus openHAB** – der einfachste, wo openHAB das Haus steuert. Dort gibt es einen Schalter „Bildschirm an“ (ein Switch-Item); die Regel mit dem Bewegungsmelder schaltet ihn. Das Skript fragt den Schalter alle zwei Sekunden ab: ein heißt an, aus heißt aus. Culinola ist daran nicht beteiligt – der Monitor wird auch geschaltet, wenn dessen Rechner aus ist.

```json
{ "openhab": "http://192.168.178.10:8080", "item": "Kueche_Display" }
```

Verlangt openHAB eine Anmeldung, kommt `"openhabToken"` dazu; `"pollSeconds"` ändert den Abstand der Abfragen.

**Über einen Datenpunkt von Culinola.** Für jede Quelle, die Culinola kennt, nicht nur openHAB. Das Skript hört am Echtzeitkanal mit und folgt dem Datenpunkt: eingeschaltet oder größer als null heißt an.

```json
{ "server": "http://192.168.178.10:8090", "token": "…", "datapoint": "openhab:Kueche_Display" }
```

**Über zwei Meldungen von Culinola.** Eine Regel ruft `POST /api/v1/events/monitor-aus` und `…/monitor-an` auf. Damit die Anzeigen dabei nichts zeigen, stehen die beiden in `config.json` als reine Signale:

```json
"events": { "monitor-aus": { "show": false }, "monitor-an": { "show": false } }
```

```json
{ "server": "http://192.168.178.10:8090", "token": "…", "off": "monitor-aus", "on": "monitor-an" }
```

Bei den beiden Wegen über Culinola ist `server` dessen Adresse – nicht die der Haussteuerung –, und `token` das Token eines Zugangs der Stufe `read` (leer, wenn die API offen ist). Der Rechner mit Culinola muss vom Anzeigerechner aus erreichbar sein; unter Windows fragt die Firewall beim ersten Start von Culinola danach.

## Einrichten

1. Den Ordner `monitor-windows` auf den Anzeigerechner kopieren, etwa nach `C:\Culinola\monitor-windows`.
2. `monitor.example.json` nach `monitor.json` kopieren und einen der drei Wege eintragen.
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
- Ein Schalter, der noch nie gesetzt wurde (openHAB meldet `NULL`), bewirkt nichts: Der Monitor bleibt, wie er ist.
- Ist die Gegenstelle nicht erreichbar, versucht das Skript es weiter und meldet das einmal im Protokoll. Der Bildschirm bleibt so lange, wie er ist.
- `monitor.json` kann ein Token enthalten und gehört deshalb nicht ins Repository; `monitor.log` bleibt klein und beginnt ab 200 KB neu.
