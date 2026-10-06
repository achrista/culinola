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

`map` übersetzt Zustandswerte in Text, etwa `{ "0": "aus", "1": "läuft", "3": "fertig" }`.

Im Diagramm läuft „Heute“ von 0 bis 24 Uhr. Eine Reihe mit `forecast: true` wird gestrichelt gezeichnet und darf über den jetzigen Zeitpunkt hinausreichen; Messwerte enden an der Markierung „jetzt“.

`warn` nimmt bis zu vier Grenzen: `lowAlarm`, `lowWarn`, `highWarn`, `highAlarm`. Der Punkt ist grün im Bereich, gelb bei Achtung, rot außerhalb und grau ohne Bewertung.

`factor` rechnet einen Wert für die Anzeige um – etwa `100`, wenn die Quelle Feuchte als Bruchteil (0,58) statt in Prozent liefert.

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

Die API ist noch **ohne Zugriffsschutz** und deshalb nur für das eigene Heimnetz gedacht.

## Entwickeln

```bash
npm run check
```

`npm run check` prüft Typen, führt die Tests aus und kontrolliert die Lizenzen der ausgelieferten Abhängigkeiten.

Beim Arbeiten an der Oberfläche läuft sie mit `npm run dev:ui` auf eigenem Port und lädt Änderungen sofort nach; der Kern muss daneben mit `npm start` laufen.

## Lizenz

Apache License 2.0, siehe [LICENSE](LICENSE). Hinweise zum Mitwirken stehen in [CONTRIBUTING.md](CONTRIBUTING.md).
