# Testen

Dieses Dokument legt fest, wie Culinola geprüft wird: was automatisch läuft, was von Hand
nach fester Liste geprüft wird, und was sich nur mit eigenen Geräten prüfen lässt.

## Überblick

| Stufe | Prüft | Wie | Wann |
|---|---|---|---|
| Typprüfung | Kern, Plugins, Oberfläche einschließlich `.vue`-Dateien | `npm run typecheck` | bei jedem Push (GitHub) |
| Einzeltests | Logik je Paket: Feeds lesen, Rezepte lesen, Eieruhr, Zugriffsregeln, Verlaufsdaten … | `npm test` | bei jedem Push |
| Zusammenspiel | Kern mit echten Plugins über die API: Quellen, Aktionen, Zugriffsschutz, Plugin-Adressen | `npm test` (`packages/core/src/integration.test.ts`) | bei jedem Push |
| Lizenzen | Alle ausgelieferten Abhängigkeiten sind permissiv lizenziert | `npm run licenses` | bei jedem Push |
| Abbild | Docker-Abbild baut, startet, antwortet und beendet sich sauber | Auftrag `docker` in `.github/workflows/ci.yml` | bei jedem Push |
| Oberfläche | Jede Kachel nach der Liste unten | Testinstanz und Browser, von Hand | vor jeder Lieferung, die die Oberfläche berührt |
| Eigene Geräte | Schalten in openHAB, Kameras, Fernsehen, Ton | eigene Installation, von Hand | wenn der betreffende Baustein geändert wurde |

`npm run check` fasst Typprüfung, Tests und Lizenzprüfung zusammen. Vor jedem Commit muss es durchlaufen.

## Regeln für automatische Tests

- Tests liegen als `*.test.ts` neben dem Code, den sie prüfen, und laufen mit Vitest.
- Ein Plugin hält seine Logik in einem Modul ohne Netz und ohne Dateisystem (`parse.ts`, `library.ts`, `timer.ts` …). Dieses Modul hat Tests; `index.ts` verdrahtet nur.
- Bekommt ein Plugin Aktionen oder eigene Adressen, kommt ein Fall in den Test des Zusammenspiels.
- Wird ein Fehler behoben, entsteht zuerst der Test, der ihn zeigt.
- Alles, was Eingaben von außen liest – Feeds, Rezepte, Konfiguration, Adressen –, hat Tests für kaputte und böswillige Eingaben, nicht nur für gute.
- Tests brauchen weder Internet noch eigene Geräte noch einen offenen Port.

## Testinstanz

Die Oberfläche wird nie an den eigenen Daten geprüft, sondern an einer Testinstanz mit erfundenen Werten:

```bash
npm run build
```

```bash
npm run test:instance
```

Sie läuft auf <http://localhost:8191>, neben einer eigenen Installation auf Port 8090. Die Vorlage liegt in `testing/instance` und wird bei jedem Start frisch in einen Wegwerfordner gelegt; was dort verändert wird, ist nach dem nächsten Start vergessen.

Die Testinstanz enthält: erfundene Messwerte, Schalter, Wetterdaten, Termine, Erinnerungen, E-Mails und Anrufe, Eieruhr, drei Rezepte (mit Bild, ohne Angaben, mit kaputten Angaben), Nachrichten aus zwei echten Feeds und einem unerreichbaren, einen Radiosender und absichtlich ein unbekanntes Widget. Nachrichten und Radio brauchen Internet. Die Einkaufsliste kommt von einem Platzhalter für Merkio (`plugins/source-merkio/src/standin.ts`) mit einer erfundenen Familie; er bildet Anmeldung, Listen, Einträge und Echtzeitkanal nach, ist aber nicht das echte Merkio. Für das Hinzufügen von Rezepten startet sie einen Platzhalter der Claude-API auf dem eigenen Rechner (`packages/recipe-import/src/standin.ts`): Er antwortet in der Form der echten Schnittstelle mit einem festen Rezept. So läuft der ganze Weg vom Hochladen bis zur Rezeptdatei, ohne dass etwas das Haus verlässt oder kostet – was das Sprachmodell aus einer echten Vorlage macht, prüft das nicht.

## Prüfliste Oberfläche

Geprüft wird bei 1920 × 1080 und zusätzlich einmal schmal (etwa 800 × 480). Die Konsole des Browsers bleibt dabei offen; sie darf außer den zwei absichtlich fehlenden Bildern des Streifenkuchens keine Fehler zeigen.

**Start**
- [ ] Die Seite lädt, alle Kacheln stehen an ihrem Platz, nichts überlappt.
- [ ] An der Stelle des unbekannten Widgets steht ein Hinweis mit dessen Namen.
- [ ] `?layout=zweites` an der Adresse zeigt das zweite Layout (Uhr und ein Messwert), `?layout=fehlt` eine Meldung, dass es dieses Layout nicht gibt.
- [ ] Kern beenden: Die Meldung „Keine Verbindung zum Kern“ erscheint. Kern starten: Sie verschwindet ohne Neuladen.

**Uhr und Eieruhr**
- [ ] Uhrzeit mit Sekunden und Datum stimmen.
- [ ] Antippen öffnet die Auswahl. Eine Voreinstellung wählen, mit −10 s auf 10 Sekunden verkürzen, starten: Die Auswahl schließt sich, die Restzeit steht groß an der Stelle der Uhrzeit, die Uhrzeit mit Sekunden darunter an der Stelle des Datums.
- [ ] Nach Ablauf klingelt es einige Sekunden; die Anzeige wird rot und zählt mit Minuszeichen weiter, dazu alle zwei Sekunden ein kurzer Ton. Antippen schaltet alles aus, Uhrzeit und Datum stehen wieder da.
- [ ] Noch einmal ablaufen lassen und nicht antippen: Nach 30 Sekunden (in der Testinstanz; sonst 120) endet die Eieruhr von selbst.
- [ ] Stoppuhr starten: Die Zeit läuft vorwärts. Seite neu laden: Sie läuft weiter. Stoppen.

**Messwerte und Diagramm**
- [ ] Kacheln zeigen Wert, Einheit und Statuspunkt; die Werte ändern sich ohne Neuladen.
- [ ] Die zwei flachen Kacheln (Waschen, Bad) zeigen Punkt, Name, Nebenwert und Wert in einer Zeile, ohne dass etwas abgeschnitten ist.
- [ ] Das Diagramm zeigt „Heute“ von 0 bis 24 Uhr mit der Markierung für jetzt; Woche und Monat lassen sich wählen.

**Wetter**
- [ ] Die kleine Kachel zeigt Symbol, Temperatur, Wetterlage, Windrose mit Geschwindigkeit, UV-Index und so viele Tage, wie Platz haben; der erste heißt „Heute“.
- [ ] Die große Kachel zeigt alle fünf Tage mit passenden Symbolen: Wolken, Sonne, Regen, Gewitter, Schneeregen.
- [ ] Der Zeiger der Windrose wandert (in der Testinstanz einmal rundum je Stunde), die Himmelsrichtung darunter folgt ihm.

**Termine und Erinnerungen**
- [ ] Termine: „Heute“ beginnt mit dem laufenden mehrtägigen Besuch (ohne Uhrzeit), darunter der Abendtermin; „Morgen“ zeigt den ganztägigen Termin vor denen mit Uhrzeit; der Termin ohne Titel heißt „(ohne Titel)“.
- [ ] Erinnerungen: gestern grau, heute fett mit „heute“; Sätze mit Alter („wird … Jahre alt“), für Verstorbene („wäre … geworden“), Namenstag, Hochzeitstag und eine eigene Bezeichnung.
- [ ] Antippen einer Erinnerung zeigt den Satz und die Telefonnummern groß; bei einem Kontakt ohne Nummer steht der Hinweis darauf, bei Verstorbenen nichts.

**Anrufe**
- [ ] Die Liste zeigt je Anruf Pfeil, Name oder Nummer, Zeit und Dauer; verpasste und abgewiesene mit rotem Zeichen, der Anruf ohne Nummer als „Unbekannt“. Bei Anrufern ohne Namen steht unter der Nummer die Herkunft: „Augsburg“, „Wien, Österreich“, „Sonderrufnummer“.
- [ ] Alle drei Minuten steht für zwanzig Sekunden „Es klingelt: Tante Rosa“ über der Liste – der Name kommt aus einem früheren Anruf derselben Nummer. Zu Beginn erklingt einmal ein kurzer Zweiklang (nachdem die Seite einmal angetippt wurde).
- [ ] Antippen zeigt Nummer, Art, Zeit, Dauer und Gerät. Beim Anruf mit Nachricht erscheint ein Abspielfeld, und ein Ton von einer Sekunde ist zu hören.

**E-Mail**
- [ ] Die Liste zeigt Absender, Betreff und Zeit, das Neueste oben; ungelesene fett, Nachrichten mit Anlagen mit Büroklammer, rechts das Postfach. Neben der Überschrift steht, dass „Verein“ nicht erreichbar ist.
- [ ] Die Liste lässt sich mit dem Finger oder Mausrad verschieben und kehrt nach einer Minute an den Anfang zurück; ebenso Termine und Erinnerungen.
- [ ] „Ihre Abrechnung“ öffnen: Kopfangaben, die Anlage mit Namen und Größe, der formatierte Text. Der Titel des Browserfensters lautet weiter „Culinola“, das fremde Bild fehlt, der Verweis führt nirgendwohin.
- [ ] Eine Textnachricht öffnen: Zeilenumbrüche bleiben erhalten. Die Nachricht ohne Absender und Betreff zeigt die Platzhalter.

**Schalter**
- [ ] Antippen schaltet um, der Zustand ist sofort sichtbar und nach dem Neuladen derselbe.

**Radio**
- [ ] Sender antippen: Ton läuft, der Titel erscheint, das Medienfenster zeigt den Sendernamen.
- [ ] Lauter und leiser wirken. „Aus“ beendet den Ton.

**Nachrichten**
- [ ] Die Kachel zeigt eine Meldung mit Bild, Feed und Uhrzeit und wechselt von selbst; die runde Taste springt weiter.
- [ ] Der unerreichbare Feed stört die anderen nicht; im Protokoll des Kerns steht dazu genau eine Warnung.
- [ ] Meldung der Augsburger Allgemeinen antippen: Der Artikel erscheint über der Anzeige. „Schließen“ und die Taste Esc führen zurück.
- [ ] Meldung der Deutschen Welle antippen: Ein eigenes Fenster in Bildschirmgröße öffnet sich. Wird es geschlossen, ist die Anzeige wieder frei; ohne Zutun schließt es sich nach 60 Sekunden von selbst.

**Rezepte**
- [ ] Beide Kacheln zeigen den Streifenkuchen mit Bild – nur dieses Rezept hat eines.
- [ ] Antippen öffnet das Rezept: Angaben, Bild, Liste mit Kästchen, Verweis.
- [ ] Der Titel des Browserfensters lautet weiter „Culinola“, der Skript-Text steht als Text da, die zwei fremden Bilder fehlen.
- [ ] Der Pfeil öffnet die Liste mit drei Rezepten; „Kaputte Kopfdaten“ lässt sich öffnen. Unter dem Streifenkuchen steht die Herkunft „Familienrezept“, unter der Linsensuppe „Beispielseite“.
- [ ] A− und A+ ändern die Schriftgröße; sie bleibt nach dem Schließen erhalten.
- [ ] Eine Datei in den Rezeptordner der Testinstanz legen: Sie erscheint ohne Neustart in der Liste.
- [ ] „+ Rezept“ in der Liste: Einen Text einfügen, dessen erste Zeile der Titel ist – nach „Übernehmen“ öffnet sich das neue Rezept mit dem Vermerk „Hinzugefügt.“ und steht in der Liste unter „Sonstiges“.
- [ ] Ein Foto wählen (gern über 5 MB): Das Rezept trägt den Namen der Datei, das Foto steht in der Leseansicht neben dem Text und erscheint auf der Kachel.
- [ ] Text „Kein Rezept“ und die Adresse `http://192.168.178.1/` werden mit einer lesbaren Meldung abgelehnt; die Eingabe bleibt stehen.
- [ ] Schmales Fenster (Telefon): Das Formular füllt die Breite, „Liste“ führt zurück.

**Listen** (Layout `einkauf`: <http://localhost:8191/?layout=einkauf>)
- [ ] „Einkauf“ zeigt die offenen Einträge in Spalten mit Menge dahinter, die Zahl der offenen im Kopf und „Kaffee“ durchgestrichen am Ende.
- [ ] Antippen hakt ab: Der Eintrag wandert durchgestrichen ans Ende, die zweite Einkauf-Kachel zieht sofort nach. Nochmal antippen nimmt den Haken weg.
- [ ] „+“: „2 kg Mehl“ erscheint als „Mehl 2 kg“; „kaffee“ macht den abgehakten Kaffee wieder offen, statt ihn doppelt einzutragen. Das Feld bleibt für weitere Einträge offen.
- [ ] „Zu tun“ zeigt die Aufgabenliste, die Kachel mit der unbekannten Liste „Urlaub“ sagt, dass diese Liste nicht gefunden wurde.

**Sprache**
- [ ] In `config.json` der Testinstanz `site` auf `{ "language": "en", "region": "en-US" }` stellen: Texte englisch, Uhr mit AM/PM, Datum in US-Schreibweise.

## Prüfung mit eigenen Geräten

Das Folgende lässt sich nicht nachstellen und wird an der eigenen Installation geprüft – bewusst und einzeln, nie nebenbei:

- Schalten gegen das echte openHAB (ein Licht, dessen Zustand man sieht)
- Kameras: Bild, Vollbild beim Antippen, Verhalten bei abgezogener Kamera
- Fernsehen: Bild und Ton über go2rtc und ffmpeg, Umschalten zwischen Sendern
- Ton der Anzeige am vorgesehenen Bildschirm: Radio, Klingelton der Eieruhr, Start ohne vorheriges Antippen
- Artikelfenster im vorgesehenen Browser und Vollbildmodus der Anzeige
- FRITZ!Box: Anmeldung, Anrufliste, Abspielen einer echten Nachricht des Anrufbeantworters, Klingeln über den Anrufmonitor
- E-Mail: Abruf aus einem echten Postfach, Öffnen einer HTML-Nachricht mit eingebetteten Bildern, Verhalten bei falschem Kennwort
- Google: Anmeldung mit `npm run google:login` am echten Konto; danach zeigen die Kacheln die echten Termine und die Erinnerungen aus den Kontakten

## Vor einer Lieferung

1. `npm run check` läuft durch.
2. `npm run build`, dann die Prüfliste Oberfläche an der Testinstanz – mindestens die Abschnitte der geänderten Bausteine und „Start“.
3. Was eigene Geräte braucht und geändert wurde, an der eigenen Installation prüfen.
4. Nach dem Push: Beide Aufträge auf GitHub sind grün.
5. In der Meldung zur Lieferung steht, was geprüft wurde und was nicht.

## Bekannte Lücken

- Die Oberfläche hat noch keine automatischen Tests; die Prüfliste oben ersetzt sie vorerst. Vorgesehen sind Browsertests gegen die Testinstanz mit Playwright (Apache-2.0).
- Die Abdeckung der Tests wird nicht gemessen.
- Die Plugins für openHAB, Radio und Video sind nur in ihrer Logik getestet, nicht gegen echte Gegenstellen.
