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
| `clock` | Uhrzeit mit Sekunden und Datum; Antippen stellt die Eieruhr | `timer` (Eieruhr-Instanz), `alarmSeconds` |
| `value-tile` | Messwert mit Statuspunkt und Verlaufslinie | `datapoint`, `label`, `secondary`, `unit`, `decimals`, `factor`, `warn`, `map` |
| `switches` | Feld von Schaltern, das sich dem Platz anpasst | `items: [{ datapoint, label }]` |
| `chart` | Zeitverlauf für heute, Woche, Monat | `title`, `series: [{ datapoint, label, area, forecast }]` |
| `note` | Hält einen Platz frei und beschriftet ihn | `title`, `text` |
| `radio` | Sendertasten, Lautstärke, laufender Titel | `source` (Radio-Instanz) |
| `video` | Live-Bild einer Kamera oder eines Streams; Antippen füllt den Bildschirm | `source` (Video-Instanz), `stream`, `label` |
| `media-window` | Fernsehbild beim Fernsehsender, Logo beim Radiosender | `source` (Radio-Instanz), `video` (Video-Instanz), `idle` |
| `news` | Eine Meldung mit Bild, reihum aus allen Feeds; Antippen öffnet den Artikel | `source` (Nachrichten-Instanz), `feeds`, `seconds`, `closeAfter` |
| `recipes` | Ein zufällig gewähltes Rezept mit Bild im Wechsel; Antippen öffnet es, der Pfeil die ganze Liste | `source` (Rezept-Instanz), `title`, `seconds` |

`map` übersetzt Zustandswerte in Text, etwa `{ "0": "aus", "1": "läuft", "3": "fertig" }`.

Im Diagramm läuft „Heute“ von 0 bis 24 Uhr. Eine Reihe mit `forecast: true` wird gestrichelt gezeichnet und darf über den jetzigen Zeitpunkt hinausreichen; Messwerte enden an der Markierung „jetzt“.

`warn` nimmt bis zu vier Grenzen: `lowAlarm`, `lowWarn`, `highWarn`, `highAlarm`. Der Punkt ist grün im Bereich, gelb bei Achtung, rot außerhalb und grau ohne Bewertung.

`factor` rechnet einen Wert für die Anzeige um – etwa `100`, wenn die Quelle Feuchte als Bruchteil (0,58) statt in Prozent liefert.

### Eieruhr

Mit `{ "id": "timer", "plugin": "timer" }` als Quelle und `"timer": "timer"` in den Angaben der Uhr wird die Uhr zur Eieruhr: Antippen öffnet die Auswahl der Dauer, die laufende Zeit steht neben der Uhrzeit. Ist die Zeit um, klingelt die Anzeige `alarmSeconds` Sekunden lang (Vorgabe 120) und zeigt es an, bis jemand die Uhr antippt. Statt rückwärts läuft sie als Stoppuhr auch vorwärts.

Die Eieruhr lebt im Kern, nicht in der Anzeige: Sie übersteht ein Neuladen und einen Neustart, alle Anzeigen zeigen dieselbe, und sie lässt sich über die Aktionen `timer.start` (`minutes`, `seconds`), `timer.stopwatch`, `timer.add` (`seconds`) und `timer.stop` auch von außen stellen. Damit die Restzeit stimmt, müssen die Uhren von Kern und Anzeigerechner gleich gehen – bei beiden also die Zeit aus dem Netz beziehen.

Den Klingelton erzeugt der Browser selbst. Browser spielen Ton erst, nachdem die Seite einmal angetippt wurde; wird die Eieruhr nur von außen gestellt, bleibt es sonst bei der sichtbaren Meldung.

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

### Nachrichten

Das Plugin `source-rss` liest beliebig viele RSS- und Atom-Feeds:

```json
{ "id": "news", "plugin": "source-rss", "config": {
    "feeds": ["dw-de", "augsburger-allgemeine", { "id": "verein", "name": "Sportverein", "url": "https://example.org/feed" }],
    "refreshMinutes": 10 } }
```

Ein Feed ist entweder eine Kennung aus dem mitgelieferten Katalog ([catalog.json](plugins/source-rss/src/catalog.json), abrufbar auch unter `/api/v1/resources/<Instanz>/catalog`) oder ein eigener Eintrag mit `id`, `name` und `url`.

Die Kachel zeigt immer eine Meldung – Überschrift, Anreißer und das Bild, das der Anbieter im Feed mitliefert – und wechselt nach `seconds` Sekunden (Vorgabe 20) zur nächsten, reihum durch die Feeds. Antippen öffnet den Artikel über der Anzeige: eingebettet, wenn der Anbieter das Einbetten seiner Seiten erlaubt, sonst in einem eigenen Browserfenster in der Größe des Bildschirms. Ob er es erlaubt, prüft der Kern einmal am Tag. Schließen führt zurück zur Anzeige; nach `closeAfter` Sekunden (Vorgabe 600, `0` schaltet das ab) schließt Culinola den Artikel von selbst. Für das eigene Fenster muss der Browser dieser Seite Pop-ups erlauben.

### Rezepte

Das Plugin `recipes` zeigt Markdown-Dateien aus einem Ordner. Ohne die Angabe `folder` ist das der Ordner der Instanz im Datenordner, bei `{ "id": "recipes", "plugin": "recipes" }` also `data/recipes`. Unterordner werden mitgelesen und dienen als Kategorie; Änderungen im Ordner erscheinen ohne Neustart.

Ein Rezept ist gewöhnliches Markdown, auf Wunsch mit Angaben am Anfang – ein Beispiel liegt in [plugins/recipes/examples](plugins/recipes/examples/pfannkuchen.md):

```markdown
---
title: Pfannkuchen
category: Schnelle Küche
tags: [vegetarisch, Grundrezept]
time: 25 min
servings: 4
---

## Zutaten
…
```

Alle Angaben sind freiwillig; deutsche Feldnamen (`Titel`, `Kategorie`, `Stichworte`, `Zeit`, `Portionen`) gelten ebenso. Fehlt der Titel, gilt die erste Überschrift, sonst der Dateiname. Bilder liegen neben dem Rezept und werden wie üblich eingebunden: `![Kuchen](bilder/kuchen.jpg)`. Das erste Bild – oder das in den Angaben unter `image` genannte – ist das Bild des Rezepts auf der Kachel. Die Kachel zeigt alle `seconds` Sekunden (Vorgabe 30) ein anderes, zufällig gewähltes Rezept mit Bild. Eingebettetes HTML wird nicht ausgeführt, sondern als Text gezeigt.

In der Leseansicht lässt sich die Schrift in Stufen vergrößern; solange ein Rezept offen ist, hält die Anzeige den Bildschirm wach, soweit der Browser das zulässt (gesicherte Verbindung oder `localhost`).

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
