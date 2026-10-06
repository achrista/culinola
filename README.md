# Culinola

Ein modularer Infobildschirm fürs Zuhause – gedacht für einen Touch-Bildschirm in der Küche. Culinola führt Haustechnik, Medien und Alltag zusammen: Messwerte und Schalter, Diagramme, Kameras, Radio und Fernsehen, Nachrichten, Rezepte.

**Stand:** erste Lieferung im Aufbau. Es laufen der Kern mit API und Echtzeitkanal, die Anbindung an openHAB sowie Uhr, Messwert-Kachel, Schalterfeld und Diagramm.

## Grundgedanken

- **Kern und Plugins.** Der Kern liefert nur Infrastruktur; alles Fachliche ist ein Plugin.
- **Fähigkeiten statt fester Systeme.** Eine Kachel hängt an einem Datenpunkt, nicht an einem bestimmten Smart-Home-System.
- **Eine API für alles.** Die eigene Oberfläche nutzt dieselbe Schnittstelle wie jedes Fremdprogramm.
- **Nur permissiv lizenzierte Abhängigkeiten**, bei jedem Build geprüft.

Das ausführliche Konzept steht in [docs/konzept.md](docs/konzept.md).

## Aufbau

```
packages/
  core/      Backend-Kern
  sdk/       Verträge und Typen für Plugins
  ui/        Oberfläche
  ui-kit/    Gemeinsame Bausteine der Oberfläche
plugins/     Je Plugin ein Ordner
themes/      Mitgelieferte Themes
docker/      Abbild und Beispiel-Compose-Datei
docs/        Konzept und Anleitungen
```

## Starten

Voraussetzung: Node.js 22.18 oder neuer.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Danach läuft Culinola auf <http://localhost:8090>. Ohne eigene Konfiguration zeigt es erfundene Beispielwerte.

## Einrichten

Alles Eigene liegt im Ordner `data/`, der nicht ins Repository gelangt. Ein anderer Ort lässt sich über die Umgebungsvariable `CULINOLA_DATA` angeben.

- **`data/config.json`** – Quellen und Layout. [config.example.json](config.example.json) ist eine Vorlage.
- **`data/secrets.json`** – Zugangsdaten, getrennt von der Konfiguration und nie über die API lesbar:

  ```json
  { "openhab": { "token": "…" } }
  ```

  Der äußere Name ist die `id` der Quelle aus `config.json`.

### Layout

Die Anzeige ist ein Raster. Jedes Widget steht mit `at: [Spalte, Zeile, Breite, Höhe]` darin, gezählt ab 0.

| Typ | Zeigt | Wichtigste Angaben |
|---|---|---|
| `clock` | Uhrzeit mit Sekunden und Datum | – |
| `value-tile` | Messwert mit Statuspunkt und Verlaufslinie | `datapoint`, `label`, `secondary`, `unit`, `decimals`, `factor`, `warn`, `map` |
| `switches` | Feld von Schaltern, das sich dem Platz anpasst | `items: [{ datapoint, label }]` |
| `chart` | Zeitverlauf für heute, Woche, Monat | `title`, `series: [{ datapoint, label, area, forecast }]` |
| `note` | Hält einen Platz frei und beschriftet ihn | `title`, `text` |
| `radio` | Sendertasten, Lautstärke, laufender Titel | `source` (Radio-Instanz) |
| `video` | Live-Bild einer Kamera oder eines Streams; Antippen füllt den Bildschirm | `source` (Video-Instanz), `stream`, `label` |
| `media-window` | Fernsehbild beim Fernsehsender, Logo beim Radiosender | `source` (Radio-Instanz), `video` (Video-Instanz), `idle` |

`map` übersetzt Zustandswerte in Text, etwa `{ "0": "aus", "1": "läuft", "3": "fertig" }`.

Im Diagramm läuft „Heute“ von 0 bis 24 Uhr. Eine Reihe mit `forecast: true` wird gestrichelt gezeichnet und darf über den jetzigen Zeitpunkt hinausreichen; Messwerte enden an der Markierung „jetzt“.

`warn` nimmt bis zu vier Grenzen: `lowAlarm`, `lowWarn`, `highWarn`, `highAlarm`. Der Punkt ist grün im Bereich, gelb bei Achtung, rot außerhalb und grau ohne Bewertung.

`factor` rechnet einen Wert für die Anzeige um – etwa `100`, wenn die Quelle Feuchte als Bruchteil (0,58) statt in Prozent liefert.

### Radio und Fernsehen

Das Plugin `media-radio` führt die Senderliste. Radiosender (`kind: "audio"`) brauchen die Adresse ihres Tonstroms; der Ton läuft über den Kern zur Anzeige, dabei wird der laufende Titel herausgelesen. `image` ist die Adresse eines Logos für das Medienfenster.

Fernsehsender (`kind: "video"`) stehen ohne Adresse in der Senderliste. Ihr Bild liefert das Video-Plugin über einen Stream mit derselben Kennung.

### Video

Das Plugin `media-video` bereitet Kameras und Livestreams für den Browser auf. Dafür braucht es das Programm [go2rtc](https://github.com/AlexxIT/go2rtc), das nicht mitgeliefert wird:

```json
{ "id": "video", "plugin": "media-video", "config": {
    "go2rtc": { "binary": "tools/go2rtc/go2rtc", "ffmpeg": "/usr/bin/ffmpeg" },
    "streams": [
      { "id": "haustuer", "name": "Haustür" },
      { "id": "nachrichten", "name": "Nachrichten", "url": "https://example.org/live/master.m3u8" }
    ] } }
```

- Mit `binary` startet Culinola go2rtc selbst; ohne die Angabe muss es bereits laufen.
- Adressen mit Zugangsdaten gehören nicht in `config.json`, sondern in `secrets.json` unter der Kennung des Streams: `{ "video": { "haustuer": "rtsp://…" } }`.
- HLS-Adressen (`.m3u8`) spielt der Browser selbst ab. Alles andere läuft über go2rtc – auch dessen eigene Schreibweisen wie `ffmpeg:<Adresse>#video=h264#audio=opus`, mit der sich etwa Fernsehsender eines Tvheadend-Servers umwandeln lassen. `ffmpeg` muss dafür installiert sein.
- Liefert eine Kamera nur Einzelbilder statt eines Videostroms, erkennt Culinola das beim ersten Verbindungsversuch und zeigt sie als Bildfolge.

Die Verwaltungsschnittstelle von go2rtc hört nur auf dem eigenen Rechner; die Anzeige erreicht die Bilder ausschließlich über den Kern. Für die Bildübertragung selbst muss der Port 8555 (TCP und UDP) vom Anzeigerechner aus erreichbar sein.

## API

Die Oberfläche benutzt dieselbe Schnittstelle wie jedes andere Programm. Alle Pfade beginnen mit `/api/v1`.

| Aufruf | Zweck |
|---|---|
| `GET /status` | Zustand der Quellen |
| `GET /datapoints`, `GET /datapoints/{id}` | Aktuelle Werte |
| `POST /datapoints/{id}/command` | Schreibbaren Datenpunkt setzen, Rumpf `{ "value": … }` |
| `GET /series?ids=&from=&to=&step=&agg=` | Verlauf, auf Wunsch verdichtet |
| `GET /actions` | Verzeichnis der Aktionen |
| `POST /actions/{name}` | Aktion auslösen, Parameter im Rumpf – z. B. `switch.set` mit `{ "datapoint": "…", "on": true }` |
| `GET /layouts/{id}` | Layout |
| WebSocket `/stream` | Änderungen in Echtzeit; abonnieren mit `{ "op": "sub", "topics": ["dp/*"] }` |

### Zugriffsschutz

Ohne Einrichtung ist die API offen: Jeder im Netz kann lesen und schalten. Der Kern weist beim Start darauf hin. Zugänge werden so eingerichtet:

1. Je Zugang ein Token erzeugen:

   ```bash
   npm run token
   ```

2. In `data/config.json` die Zugänge mit ihrer Stufe benennen:

   ```json
   "access": { "tokens": [{ "name": "kueche", "role": "control" }, { "name": "flur", "role": "read" }] }
   ```

3. In `data/secrets.json` die Tokens dazu eintragen:

   ```json
   "api": { "kueche": "…", "flur": "…" }
   ```

| Stufe | Darf |
|---|---|
| `read` | lesen |
| `control` | lesen, schalten, Aktionen auslösen |
| `admin` | zusätzlich einrichten (noch ohne Funktion) |

Programme schicken das Token in der Kopfzeile `Authorization: Bearer …`. Eine Anzeige wird freigeschaltet, indem man die Adresse einmal mit `#token=…` am Ende öffnet; sie merkt sich den Zugang und entfernt das Token wieder aus der Adresszeile.

Der Schutz regelt, wer etwas darf. Er verschlüsselt nichts – außerhalb des eigenen Heimnetzes gehört HTTPS davor.

## Entwickeln

```bash
npm run check
```

`npm run check` prüft Typen, führt die Tests aus und kontrolliert die Lizenzen der ausgelieferten Abhängigkeiten.

Beim Arbeiten an der Oberfläche läuft sie mit `npm run dev:ui` auf eigenem Port und lädt Änderungen sofort nach; der Kern muss daneben mit `npm start` laufen.

## Lizenz

Apache License 2.0, siehe [LICENSE](LICENSE). Hinweise zum Mitwirken stehen in [CONTRIBUTING.md](CONTRIBUTING.md).
