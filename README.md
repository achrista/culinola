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
testing/     Testinstanz mit erfundenen Werten
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

### Mit Docker

Ein Abbild mit Kern, allen mitgelieferten Plugins und der Oberfläche baut [docker/Dockerfile](docker/Dockerfile); [docker/compose.yaml](docker/compose.yaml) ist ein Beispiel für den Betrieb:

```bash
cd docker && docker compose up -d --build
```

Der Ordner `docker/data` wird im Abbild zu `/data` und nimmt `config.json`, `secrets.json`, Rezepte und Senderlogos auf.

- Das Abbild enthält go2rtc und ffmpeg für Kameras und Fernsehen. In `config.json` lauten die Pfade dann `"go2rtc": { "binary": "/usr/local/bin/go2rtc", "ffmpeg": "/usr/bin/ffmpeg" }`. Wer kein Video braucht, baut mit `--build-arg WITH_MEDIA=false` ein kleineres Abbild.
- Das Beispiel nutzt das Netz des Rechners (`network_mode: host`, nur unter Linux), weil die Bildübertragung der Kameras eine im Heimnetz direkt erreichbare Gegenstelle braucht. Ohne Video genügt die Freigabe von Port 8090.
- Der Dienst läuft als Benutzer 1000 und muss in `data` schreiben dürfen.

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

Unter `layouts` dürfen mehrere Layouts stehen. Eine Anzeige zeigt `main`, mit dem Adresszusatz `?layout=name` ein anderes – so bekommt der Flur ein eigenes Bild, oder ein neuer Entwurf lässt sich neben dem bisherigen ansehen.

| Typ | Zeigt | Wichtigste Angaben |
|---|---|---|
| `clock` | Uhrzeit mit Sekunden und Datum; Antippen stellt die Eieruhr | `timer` (Eieruhr-Instanz) |
| `value-tile` | Messwert mit Statuspunkt und Verlaufslinie; eine Rasterzeile hoch zeigt sie alles in einer Zeile. Mit `gauge` steht der Wert in einer hohen Kachel in einem Ring, der sich mit ihm füllt – für Leistung, Ladestand oder Tankfüllung, mit dem Nebenwert (etwa der Reichweite) darunter | `datapoint`, `label`, `secondary`, `unit`, `decimals`, `factor`, `warn`, `map`, `gauge` (`{ "max": 100 }`, auf Wunsch mit `min`) |
| `presence` | Wer zu Hause ist: je Person ein Feld mit Namen und „daheim“ oder „weg“. Als anwesend gilt ein eingeschalteter Schalter, eine Zahl über null oder ein Text wie `home` oder `daheim` | `items` (Liste aus `datapoint` und `label`), `home` (eigene Texte für „daheim“) |
| `switches` | Feld von Schaltern, das sich dem Platz anpasst | `items: [{ datapoint, label }]` |
| `chart` | Zeitverlauf für heute, Woche, Monat | `title`, `series: [{ datapoint, label, area, forecast }]` |
| `note` | Hält einen Platz frei und beschriftet ihn | `title`, `text` |
| `radio` | Sendertasten, Lautstärke, laufender Titel | `source` (Radio-Instanz) |
| `voice` | Sprechen statt tippen: antippen, einen Satz sagen; die Antwort erscheint unten auf der Anzeige und wird vorgelesen | `source` (Vorgabe `voice`), `title`, `speak` (`false` schaltet das Vorlesen ab) |
| `video` | Live-Bild einer Kamera oder eines Streams; Antippen füllt den Bildschirm | `source` (Video-Instanz), `stream`, `label` |
| `media-window` | Fernsehbild beim Fernsehsender, Logo beim Radiosender | `source` (Radio-Instanz), `video` (Video-Instanz), `idle` |
| `news` | Eine Meldung mit Bild, reihum aus allen Feeds; Antippen öffnet den Artikel | `source` (Nachrichten-Instanz), `feeds`, `seconds`, `closeAfter` |
| `weather` | Wetterlage mit Symbol, Windrose, UV-Index und Vorhersage ab heute | `temperature`, `condition`, `code`, `wind`, `uv`, `sunrise`, `sunset`, `days` |
| `calls` | Anrufe und Nachrichten des Anrufbeantworters in einer Liste; Antippen zeigt Einzelheiten und spielt die Nachricht ab | `source` (FRITZ!Box-Instanz), `title`, `sound` |
| `calendar` | Die nächsten Termine, nach Tagen gegliedert | `source` (Google-Instanz), `title` |
| `reminders` | Anstehende Geburtstage und andere wiederkehrende Tage; Antippen zeigt die Telefonnummern | `source` (Google-Instanz), `title` |
| `mail` | E-Mails aller eingerichteten Postfächer, das Neueste zuerst; Antippen zeigt die Nachricht | `source` (Mail-Instanz), `title` |
| `checklist` | Eine Einkaufs- oder Aufgabenliste zum Abhaken, eng in Spalten gesetzt; „+“ trägt neue Einträge ein | `source` (Listen-Instanz, Vorgabe `merkio`), `list` (Kennung oder Name, sonst die erste), `title`, `recentHours` (so lange bleibt Abgehaktes sichtbar, Vorgabe 12) |
| `recipes` | Ein zufällig gewähltes Rezept mit Bild im Wechsel; Antippen öffnet es, der Pfeil die ganze Liste, in der sich auch neue Rezepte hinzufügen lassen | `source` (Rezept-Instanz), `title`, `seconds` |

`map` übersetzt Zustandswerte in Text, etwa `{ "0": "aus", "1": "läuft", "3": "fertig" }`.

Im Diagramm läuft „Heute“ von 0 bis 24 Uhr. Eine Reihe mit `forecast: true` wird gestrichelt gezeichnet und darf über den jetzigen Zeitpunkt hinausreichen; Messwerte enden an der Markierung „jetzt“.

`warn` nimmt bis zu vier Grenzen: `lowAlarm`, `lowWarn`, `highWarn`, `highAlarm`. Der Punkt ist grün im Bereich, gelb bei Achtung, rot außerhalb und grau ohne Bewertung.

`factor` rechnet einen Wert für die Anzeige um – etwa `100`, wenn die Quelle Feuchte als Bruchteil (0,58) statt in Prozent liefert.

### Farbschema

Das Aussehen der Anzeige bestimmt ein Farbschema. Gewählt wird es in `config.json` mit `"site": { "theme": "glut" }`; zum Ausprobieren genügt der Adresszusatz `?theme=glut` – er gilt nur für diese eine Anzeige und geht der Konfiguration vor.

| Schema | Wirkung |
|---|---|
| `klar` (Vorgabe) | Kühles Hell mit Petrol; folgt dem hellen oder dunklen Modus des Geräts |
| `glut` | Warmes Hell: sandfarbener Grund, Kacheln mit weichem Schatten, Orange als Akzent, die Uhr in Orange |
| `schiefer` | Dunkler Grund mit hellen Kacheln – der stärkste Abstand zwischen den Kacheln |
| `signal` | Kühles Hell mit kräftigerem Grund; die Uhr steht als orangefarbene Fläche da |
| `nacht` | Dunkel mit warmem Orange, die Kacheln durch eine feine Kante getrennt |
| `spiegel` | Für die Anzeige hinter einem Spiegelglas: alles hell und kräftig auf Schwarz, ohne Kachelflächen |

Ein Schema besteht nur aus Werten – Farben, Rundung, Abstand, Schatten, Schrift der Überschriften, Farben der Uhr – in [theme.css](packages/ui/src/theme.css); ein eigenes ist ein weiterer Block dort.

### Wetter

Das Wetter kommt aus Datenpunkten – etwa aus openHAB, das sie von einem Wetterdienst oder einer eigenen Station bezieht. Jede Angabe ist die Kennung eines Datenpunkts; was fehlt, lässt die Kachel weg:

```json
{ "type": "weather", "at": [19, 0, 12, 3], "config": {
    "temperature": "openhab:Wetter_Temperatur",
    "condition": "openhab:Wetter_Lage",
    "code": "openhab:Wetter_Kennzahl",
    "wind": { "direction": "openhab:Wind_Richtung", "speed": "openhab:Wind_Geschwindigkeit" },
    "uv": "openhab:UV_Index",
    "sunrise": "openhab:Sonnenaufgang", "sunset": "openhab:Sonnenuntergang",
    "days": [
      { "condition": "openhab:Lage_0", "max": "openhab:Max_0", "min": "openhab:Min_0" },
      { "condition": "openhab:Lage_1", "max": "openhab:Max_1", "min": "openhab:Min_1" }
    ] } }
```

- Das Symbol richtet sich nach `code` – einer Wetterkennzahl (`800`) oder Symbolkennung (`01d`) von OpenWeatherMap – und sonst nach dem Text in `condition`, deutsch oder englisch. Mit `sunrise` und `sunset` zeigt die Kachel nachts das Nachtsymbol.
- Die Windrose zeigt, woher der Wind kommt (`direction` in Grad), und in der Mitte die Geschwindigkeit in km/h. Liefert der Datenpunkt eine andere Einheit ohne sie zu nennen, steht sie in `wind.unit` (`m/s`, `mph`, `kn`).
- Der UV-Index trägt einen Punkt in der Farbe seiner Gefahrenstufe: grün bis 2, gelb bis 5, orange bis 7, rot bis 10, violett darüber.
- `days` ist die Vorhersage, beginnend mit heute. Gezeigt werden so viele Tage, wie in der Breite Platz haben.

Die Wettersymbole stammen aus dem Satz Meteocons (MIT) und werden ohne dessen Bewegungen gezeigt.

### Google-Konto

Kalender und Erinnerungen kommen aus einem Google-Konto. Das Plugin `source-google` braucht dafür einen eigenen Zugang bei Google und eine einmalige Anmeldung mit `npm run google:login`; die Schritte stehen in [docs/google-einrichten.md](docs/google-einrichten.md). Culinola erhält nur Lesezugriff.

```json
{ "id": "google", "plugin": "source-google", "config": { "calendars": ["primary", "Familie"], "days": 14, "leadDays": 3 } }
```

- **Termine** kommen aus den unter `calendars` genannten Kalendern (Name oder Kennung; `primary` ist der Hauptkalender und zugleich die Vorgabe), `days` Tage voraus.
- **Erinnerungen** kommen aus den Kontakten: der Geburtstag und die Ereignisse eines Kontakts (Namenstag, Hochzeitstag, Taufe, Todestag, Jahrestag oder eine eigene Bezeichnung). Sie erscheinen `leadDays` Tage vorher und bleiben bis zum Tag danach. Ist das Jahr eingetragen, nennt die Anzeige das Alter.
- Tage, die an keinem Kontakt hängen – ein Namenstag, der allen dieses Namens gilt, der Hochzeitstag eines Paares –, stehen als jährlich wiederkehrende ganztägige Termine in einem eigenen Kalender. Vorgabe ist ein Kalender namens `Erinnerungen`; andere nennt `reminderCalendars`. Der Titel nennt Art und Namen („Namenstag Andreas“); steht in der Beschreibung `Jahr: 1959`, errechnet die Anzeige das Jubiläum.
- Ein Ereignis darf hinter seiner Art einen Namen tragen – „Geburtstag Rosa“ an einem Kontakt, der für eine ganze Familie steht. Dann gilt der Tag dieser Person.
- Wer in der Kontaktgruppe (dem Label) `Verstorben` ist oder einen Todestag hat, gilt als verstorben; die Anzeige schreibt dann „wäre … geworden“. Der Name der Gruppe lässt sich mit `deceasedGroup` ändern.

### E-Mail

Das Plugin `source-mail` zeigt die neuesten Nachrichten aus einem oder mehreren IMAP-Postfächern, zusammen in einer Liste nach Eingang:

```json
{ "id": "mail", "plugin": "source-mail", "config": {
    "accounts": [
      { "id": "privat", "name": "Privat", "host": "imap.example.org", "user": "ich@example.org" },
      { "id": "verein", "name": "Verein", "host": "mail.example.net", "port": 143, "user": "vorstand" }
    ],
    "perAccount": 30, "refreshMinutes": 5 } }
```

Die Kennwörter stehen in `secrets.json` unter der Kennung der Quelle und des Kontos: `{ "mail": { "privat": "…", "verein": "…" } }`. Auch Anmeldename und Server dürfen dort stehen statt in `config.json` – als `"privat.user"` und `"privat.host"`. So enthält `config.json` keine persönlichen Angaben und lässt sich weitergeben. Bei Anbietern mit Zwei-Faktor-Anmeldung (etwa Google) ist das ein App-Kennwort, nicht das Kennwort des Kontos.

- Das Plugin liest nur. Es öffnet die Postfächer ohne Schreibrecht, markiert nichts als gelesen und löscht nichts; ungelesene Nachrichten stehen fett in der Liste.
- Ohne `port` gilt 993 mit Verschlüsselung von Anfang an; bei einem anderen Port wird die Verbindung nachträglich verschlüsselt, wenn der Server das anbietet. `folder` wählt einen anderen Ordner als den Posteingang.
- Antippen zeigt die Nachricht: als Text oder als HTML. Eine Nachricht, die ihren Text nur im Rich-Text-Format (RTF) mitbringt, erscheint als reiner Text mit ihren Absätzen. HTML läuft abgeschottet – ohne Skripte, ohne Formulare und ohne Nachladen von außen, also auch ohne die Zählbilder, mit denen Absender das Öffnen bemerken. Bilder, die in der Nachricht selbst stecken, erscheinen. Mit `"remoteImages": true` in den Angaben der Quelle lädt die Anzeige auch Bilder aus dem Netz nach; die Nachricht sieht dann aus wie gedacht, der Absender kann daran aber bemerken, dass sie geöffnet wurde. Alles andere bleibt auch dann gesperrt.
- Anlagen zeigt Culinola nicht. Eine Büroklammer in der Liste sagt, dass es welche gibt; die geöffnete Nachricht nennt ihre Namen.

### Anrufe

Das Plugin `source-fritzbox` liest die Anrufliste einer FRITZ!Box:

```json
{ "id": "fritzbox", "plugin": "source-fritzbox", "config": { "host": "fritz.box", "max": 60 } }
```

Die Anmeldung steht in `secrets.json`: `{ "fritzbox": { "user": "…", "password": "…" } }`. Am besten legt man in der FRITZ!Box unter System → FRITZ!Box-Benutzer einen eigenen Benutzer dafür an, der nur „Sprachnachrichten, Faxnachrichten, FRITZ!App Fon und Anrufliste“ darf.

- Angenommene, verpasste, ausgehende und abgewiesene Anrufe stehen mit den Nachrichten des Anrufbeantworters in einer Liste, das Neueste zuerst. Namen kommen aus dem Telefonbuch der FRITZ!Box.
- Bei einem Anrufer ohne Namen steht dabei, woher die Nummer kommt: der Ort des Ortsnetzes („Augsburg“), bei Nummern aus dem Ausland Ort und Land („Wien, Österreich“), sonst die Art der Nummer („Mobilfunk“). `country` nennt das eigene Land (Vorgabe `DE`), `language` die Sprache der Namen (Vorgabe `de`).
- Antippen zeigt Nummer, Zeit, Dauer und Gerät. Hat der Anrufbeantworter eine Nachricht aufgenommen, spielt die Anzeige sie ab; die Aufnahme kommt über den Kern von der FRITZ!Box.
- Mit dem Anrufmonitor der FRITZ!Box zeigt die Kachel sofort, wenn es klingelt, und gibt dazu einen kurzen Ton (abschaltbar mit `"sound": false` an der Kachel), und die Liste aktualisiert sich gleich nach dem Auflegen. Er wird einmalig an einem angeschlossenen Telefon mit `#96*5*` eingeschaltet; `"monitor": false` verzichtet darauf.
- Das Plugin ändert an der FRITZ!Box nichts.

### Eieruhr

Mit `{ "id": "timer", "plugin": "timer" }` als Quelle und `"timer": "timer"` in den Angaben der Uhr wird die Uhr zur Eieruhr: Antippen öffnet die Auswahl der Dauer. Solange die Eieruhr läuft, steht sie groß an der Stelle der Uhrzeit, und die Uhrzeit rückt an die Stelle des Datums. Ist die Zeit um, klingelt die Anzeige und zählt danach mit Minuszeichen weiter – so sieht man, wie lange etwas schon nachkocht –, begleitet von einem kurzen Ton alle zwei Sekunden. Antippen schaltet sie aus; sonst endet sie nach der Nachlaufzeit von selbst (`overrunSeconds` in den Angaben der Quelle, Vorgabe 120). Statt rückwärts läuft sie als Stoppuhr auch vorwärts.

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

Alle Angaben sind freiwillig; deutsche Feldnamen (`Titel`, `Kategorie`, `Stichworte`, `Zeit`, `Portionen`) gelten ebenso. Die Herkunft eines Rezepts – `source: Familienrezept` in den Angaben oder eine Zeile `Quelle: [Instagram](https://…)` im Text – steht in der Rezeptliste klein unter dem Titel. Fehlt der Titel, gilt die erste Überschrift, sonst der Dateiname. Bilder liegen neben dem Rezept und werden wie üblich eingebunden: `![Kuchen](bilder/kuchen.jpg)`. Das erste Bild – oder das in den Angaben unter `image` genannte – ist das Bild des Rezepts auf der Kachel. Die Kachel zeigt alle `seconds` Sekunden (Vorgabe 30) ein anderes, zufällig gewähltes Rezept mit Bild. Eingebettetes HTML wird nicht ausgeführt, sondern als Text gezeigt.

In der Leseansicht lässt sich die Schrift in Stufen vergrößern; solange ein Rezept offen ist, hält die Anzeige den Bildschirm wach, soweit der Browser das zulässt (gesicherte Verbindung oder `localhost`). Das Bild aus den Angaben steht dort neben dem Text. „Das koche ich“ hält ein Rezept fest: Es bleibt auf der Kachel stehen, statt im Wechsel zu verschwinden, und ein Fingertipp öffnet es wieder – bis „Fertig gekocht“ gedrückt wird oder sechs Stunden um sind. Der Vermerk liegt im Kern (Datenpunkt `recipes:cooking`, Aktionen `recipes.cook` und `recipes.finish`), gilt also für alle Anzeigen und übersteht ein Neuladen.

#### Neue Rezepte hinzufügen

Aus einer Webseite, einem Dokument (PDF, Word, LibreOffice, Text) oder einem Foto – etwa einer abfotografierten Kochbuchseite – macht Culinola ein Rezept im eigenen Format und legt es samt Foto des Gerichts als `<Kategorie>/<Titel>.md` in den Rezeptordner. Das Lesen und Ordnen übernimmt ein Sprachmodell von Anthropic (Claude Haiku); die Arbeit dahinter steckt im Paket [recipe-import](packages/recipe-import/README.md).

Dafür braucht es einen Schlüssel der Claude-API (<https://platform.claude.com>), eingetragen in `secrets.json` unter der Kennung der Rezept-Instanz:

```json
{ "recipes": { "anthropicApiKey": "sk-ant-…" } }
```

Im Docker-Abbild geht stattdessen auch die Umgebungsvariable `ANTHROPIC_API_KEY`. Nach einem Neustart gibt es zwei Wege:

- **In der Anzeige:** In der Rezeptliste erscheint „+ Rezept“. Dort eine Webadresse eintragen, eine Datei oder ein Foto wählen oder den Text einfügen. Weil die Anzeige eine gewöhnliche Webseite ist, geht das von jedem Gerät im Haus – am bequemsten vom Telefon, das die Kochbuchseite gleich fotografiert, oder vom Rechner, auf dem die Datei liegt. Große Fotos verkleinert der Browser vor dem Hochladen.
- **Für ganze Ordner:** `npm run recipes:import -- <Ordner oder Adresse …> --recipes data/recipes` wandelt alles auf einmal um; ein Bild, das wie die Vorlage heißt (`Apfelkuchen.pdf` und `Apfelkuchen.jpg`), wird das Foto des Rezepts. Im Rezeptordner wird dabei nichts überschrieben und nichts gelöscht.

Ohne Schlüssel fehlt die Taste, alles andere läuft wie gewohnt. Ist die API durch Zugänge geschützt, braucht das Hinzufügen die Stufe `control`.

Zu wissen: Die Vorlage wird zum Umwandeln an Anthropic übertragen, und jede Umwandlung kostet einen kleinen Betrag nach Verbrauch – der Kern schreibt die Zahl der Token ins Protokoll. Webadressen im eigenen Netz werden nicht gelesen. Das Ergebnis stammt von einem Sprachmodell: Mengen und Zeiten vor dem ersten Nachkochen mit der Vorlage vergleichen. Mit `importModel` und `importLanguage` (`de`, `en`, `fr`) in der Konfiguration des Plugins lassen sich Modell und Sprache der neuen Rezepte ändern.

### Einkaufs- und Aufgabenlisten aus Merkio

Culinola führt selbst keine Listen. Das Plugin `source-merkio` zeigt die Listen aus [Merkio](https://merkio.de), hakt dort ab und trägt dort ein – gepflegt wird weiter am Telefon, und über Merkios Echtzeitkanal sehen beide Seiten sofort denselben Stand.

```json
{ "id": "merkio", "plugin": "source-merkio", "config": { "lists": ["Einkauf"] } }
```

Am besten bekommt die Anzeige ein eigenes Merkio-Konto, das Mitglied der Familiengruppe ist. Seine Zugangsdaten stehen in `secrets.json`:

```json
{ "merkio": { "email": "kueche@example.org", "password": "…" } }
```

`lists` nennt die Listen, die gezeigt werden – mit ihrem Namen, bei gleichnamigen Listen in mehreren Gruppen als `{ "name": "Einkauf", "group": "Familie" }`. Ohne die Angabe sind es alle Einkaufslisten des Kontos. Welche Listen es gibt, schreibt der Kern beim Start ins Protokoll, wenn eine genannte fehlt, und es steht unter `/api/v1/resources/merkio/available`. Jede Liste bekommt eine Kennung aus ihrem Namen (`Einkauf` → `einkauf`); die Kachel `checklist` wählt ihre Liste mit `list`.

Antippen hakt einen Eintrag ab; Abgehaktes bleibt einige Stunden durchgestrichen stehen, damit sich der Haken zurücknehmen lässt. „+“ öffnet ein Eingabefeld: „2 kg Mehl“ wird in Menge, Einheit und Namen zerlegt, und was schon abgehakt auf der Liste steht, wird wieder offen statt doppelt. Dasselbe geht über die Aktionen `lists.add` (`text`, `list`) und `lists.check` (`item`, `checked`).

Das Plugin meldet sich mit Konto und Kennwort an, merkt sich Merkios Erneuerungstoken in `data/merkio/token.json` und meldet sich von selbst neu an, wenn es abgelaufen ist. Der Datenpunkt `merkio:state` sagt, wie es steht: `ok`, `nogroup` (angemeldet, aber das Konto ist noch in keiner Gruppe – in Merkio beitreten und bestätigen lassen), `login` (Zugangsdaten fehlen oder werden abgelehnt) oder `offline`. Mit `url` lässt sich eine eigene Merkio-Installation ansprechen, mit `refreshMinutes` (Vorgabe 5) der Abstand, in dem zusätzlich zum Echtzeitkanal alles neu gelesen wird.

### Sprachsteuerung

„Eieruhr auf acht Minuten“, „Setz Milch und Butter auf die Einkaufsliste“, „Spiel Bayern 2“, „Ich koche den Apfelkuchen“: Die Kachel `voice` nimmt einen gesprochenen Satz entgegen, das Plugin `voice` führt ihn aus.

```json
{ "id": "voice", "plugin": "voice" }
```

So läuft es ab: Antippen startet die Spracherkennung des Browsers; den erkannten Satz schickt die Anzeige an den Kern. Dort ordnet ein Sprachmodell von Anthropic (Claude Haiku) ihn den **Aktionen** zu, die die anderen Plugins angemeldet haben (`GET /api/v1/actions`), löst sie aus und antwortet in einem Satz, den die Anzeige zeigt und vorliest. Jede neue Aktion ist damit von selbst auch per Sprache erreichbar; was als heikel angemeldet ist (`sensitive`), bleibt ausgenommen.

Voraussetzungen:

- **Schlüssel der Claude-API** in `secrets.json`: `{ "voice": { "anthropicApiKey": "sk-ant-…" } }` – derselbe wie für das Hinzufügen von Rezepten; ersatzweise die Umgebungsvariable `ANTHROPIC_API_KEY`.
- **Ein Browser mit Spracherkennung** – Chrome oder Edge – und ein Mikrofon am Anzeigerechner. Der Browser fragt einmal nach der Erlaubnis für das Mikrofon. Er gibt sie nur Seiten mit gesicherter Verbindung oder `localhost`: Läuft die Anzeige auf einem anderen Rechner als der Kern, braucht es HTTPS davor.
- Wo es keine Spracherkennung gibt, lässt sich der Satz in dasselbe Feld tippen (Taste ⌨).

Zu wissen: In Chrome geht die Aufnahme zum Erkennen an Google, der erkannte Satz zum Zuordnen an Anthropic; jeder Satz kostet einen Bruchteil eines Cents. Ins Protokoll des Kerns kommt, was ausgelöst wurde – nicht, was gesagt wurde. Die Kachel hört nur nach dem Antippen zu, nicht dauernd. Läuft dabei das Radio, hört das Mikrofon es mit; leiser stellen hilft. `model` und `language` (`de`, `en`, `fr`) in der Konfiguration des Plugins ändern Modell und Sprache der Antworten.

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

Wie geprüft wird – automatisch, an der Testinstanz (`npm run test:instance`) und mit eigenen Geräten –, steht in [docs/testen.md](docs/testen.md).

Beim Arbeiten an der Oberfläche läuft sie mit `npm run dev:ui` auf eigenem Port und lädt Änderungen sofort nach; der Kern muss daneben mit `npm start` laufen.

## Lizenz

Apache License 2.0, siehe [LICENSE](LICENSE). Hinweise zum Mitwirken stehen in [CONTRIBUTING.md](CONTRIBUTING.md).
