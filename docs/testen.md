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

Die Testinstanz enthält: Sonne und Mond für drei Orte, erfundene Messwerte, zwei Autos, vier Familienmitglieder, Schalter, Wetterdaten, Termine, Erinnerungen, E-Mails und Anrufe, Eieruhr, vier Rezepte (mit Bild, ohne Angaben, mit kaputten Angaben, mit Zutatentabelle), Nachrichten aus zwei echten Feeds und einem unerreichbaren, einen Radiosender und absichtlich ein unbekanntes Widget. Nachrichten und Radio brauchen Internet. Die Einkaufsliste kommt von einem Platzhalter für Merkio (`plugins/source-merkio/src/standin.ts`) mit einer erfundenen Familie; er bildet Anmeldung, Listen, Einträge und Echtzeitkanal nach, ist aber nicht das echte Merkio. Für das Hinzufügen von Rezepten startet sie einen Platzhalter der Claude-API auf dem eigenen Rechner (`packages/recipe-import/src/standin.ts`): Er antwortet in der Form der echten Schnittstelle mit einem festen Rezept. So läuft der ganze Weg vom Hochladen bis zur Rezeptdatei, ohne dass etwas das Haus verlässt oder kostet – was das Sprachmodell aus einer echten Vorlage macht, prüft das nicht. Geräte über MQTT kommen von einem Platzhalter-Broker (`plugins/connector-mqtt/src/standin.ts`) mit einem nachgespielten Luftsensor und einem schaltbaren Licht, die sich wie Tasmota selbst anmelden. Home Assistant ist ein Platzhalter mit erfundenen Geräten (`plugins/connector-homeassistant/src/standin.ts`). Homematic kommt von einer Platzhalter-Zentrale (`plugins/connector-homematic/src/standin.ts`) mit Schalter, Rollladen und Wandthermostat. Für die Kachel `web` startet sie zwei kleine Seiten auf dem eigenen Rechner: eine, die sich einbetten lässt, und eine, die es verbietet.

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
- [ ] Der kurze Ton nach dem Klingeln ist deutlich leiser als das Klingeln selbst. Unter `?layout=web` ist die Uhr auf `"ringVolume": 50, "reminderVolume": 0` gestellt: Dort klingelt es leiser, und danach bleibt es still, während die Anzeige weiterzählt.
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
- [ ] Beide Kacheln zeigen den Streifenkuchen mit Bild – nur dieses Rezept hat eines; Rezepte ohne Bild kommen im Wechsel nicht an die Reihe.
- [ ] Antippen öffnet das Rezept: Angaben, Bild, Liste mit Kästchen, Verweis.
- [ ] Der Titel des Browserfensters lautet weiter „Culinola“, der Skript-Text steht als Text da, die zwei fremden Bilder fehlen.
- [ ] Der Pfeil öffnet die Liste mit vier Rezepten; „Kaputte Kopfdaten“ lässt sich öffnen. Unter dem Streifenkuchen steht die Herkunft „Familienrezept“, unter der Linsensuppe „Beispielseite“.
- [ ] A− und A+ ändern die Schriftgröße; sie bleibt nach dem Schließen erhalten.
- [ ] „Das koche ich“ bei der Linsensuppe: Nach dem Schließen zeigen beide Kacheln die Linsensuppe mit „Wird gekocht“ und wechseln nicht mehr; Antippen öffnet sie wieder. „Fertig gekocht“ bringt den Wechsel zurück.
- [ ] Pfannkuchen öffnen, „Einkaufen“: Fünf Zutaten stehen angewählt da, oben „4 Portionen“. Zweimal „+“: „6 Portionen“, aus 250 g Mehl werden 375 g. Salz abwählen (die Auswahl bleibt beim Umrechnen erhalten), „Auf die Liste setzen (4)“: Über dem Rezept steht, wie viele Zutaten neu auf die Liste kamen und wie viele schon dort standen; unter `?layout=einkauf` stehen „Mehl 375 g“ und „Butter zum Backen“. Milch und Eier standen schon dort und bleiben, wie sie sind.
- [ ] Beim Streifenkuchen und bei der Linsensuppe fehlt „Einkaufen“ – sie haben keine Zutatentabelle.
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

**Haus** (Layout `haus`: <http://localhost:8191/?layout=haus>)
- [ ] PV, Batterie und Verbrauch stehen als Ringe da, die sich mit dem Wert füllen; die Batterie ist grün, weil sie über ihren Warngrenzen liegt.
- [ ] Die beiden Autos zeigen Füllstand im Ring und die Reichweite darunter; der fast leere Kombi ist gelb.
- [ ] Dieselbe Angabe in der flachen und in der engen Kachel bleibt lesbar.
- [ ] Der Kombi und „Bad veraltet“ stehen ausgegraut da, weil ihr Schalter „Daten aktuell“ aus ist; die enge Kachel wechselt jede Minute zwischen frisch und ausgegraut.
- [ ] Anwesenheit: Anna und Ben „daheim“ in Grün, Cleo und Dana „weg“; die hohe Kachel hat zwei Reihen, die flache eine; ein Eintrag ohne Wert steht blass als „unbekannt“ da.

**Sprechen** (Layout `haus`)
- [ ] Die Kachel „Sprechen“ antippen. Mit Mikrofon und Chrome: „Eieruhr auf 5 Minuten“ sagen – unten erscheint der Satz, dann „Erledigt.“, die Antwort wird vorgelesen, und die Uhr daneben zählt rückwärts. Der Platzhalter der Claude-API versteht nur feste Sätze: Eieruhr auf n Minuten, „Setze … auf die Einkaufsliste“, „Spiele …“.
- [ ] Ohne Spracherkennung (oder über ⌨) lässt sich der Satz tippen; „Setze Hefe auf die Einkaufsliste“ steht danach in der Liste (`?layout=einkauf`).
- [ ] „Wie warm ist es Außen?“ (getippt oder gesprochen): Die Antwort nennt den Wert der Kachel „Außen“ – beim Platzhalter roh als „Außen: 15,8 °C“, das echte Sprachmodell macht daraus einen Satz. „Ist das Licht am Esstisch an?“ nennt den Schalter. Im Protokoll des Kerns steht, welche Werte gelesen wurden, nicht ihr Stand. Der Platzhalter liest, was im Satz beim Namen genannt ist, sonst den ersten Wert.
- [ ] „Setz die Zutaten für die Pfannkuchen auf die Einkaufsliste“: „Erledigt.“, und die Zutaten stehen auf der Liste.
- [ ] Ein Satz, den der Platzhalter nicht kennt, bekommt eine Antwort ohne Aktion; die Tafel verschwindet nach einigen Sekunden von selbst.
- [ ] Aktivierungswort (nur mit Sprachmodell: `CULINOLA_VOSK_MODEL=<Pfad zu model.tar.gz> npm run test:instance`, Mikrofon und `localhost`): Unter der Taste steht „computer …“. „Computer, setz Hefe auf die Einkaufsliste“ führt ohne Antippen zum Eintrag; nur „Computer“ ergibt einen Ton und „Ich höre …“, der nächste Satz wird ausgeführt; ein Satz ohne das Wort bewirkt nichts. Nach einer Antwort ohne Aktion („nicht verstanden“) steht wieder „Ich höre …“ da, und der nächste Satz wird ohne das Wort ausgeführt; bleibt es still, verschwindet die Tafel nach einigen Sekunden.

**Geräte über MQTT** (Layout `mqtt`: <http://localhost:8191/?layout=mqtt>)
- [ ] CO₂ steht als Ring da und ändert sich alle zehn Sekunden, die Temperatur zeigt 21,5 °C, „Bauart“ zeigt „B“ (von Hand eingerichtet), „Broker“ zeigt „ok“. Namen und Einheiten kommen von den Geräten selbst.
- [ ] „Nachtlicht“ lässt sich ein- und ausschalten; der Schalter folgt der Rückmeldung des Geräts.
- [ ] `GET /api/v1/datapoints` nennt unter `mqtt:` nur die verstandenen Geräte – der Sensor mit rechnender Vorlage und die Heizung fehlen; im Protokoll des Kerns steht, wie viele angemeldet und wie viele übergangen wurden.

**Home Assistant** (Layout `homeassistant`: <http://localhost:8191/?layout=homeassistant>)
- [ ] „Außen“ zeigt 12,3 °C, „Strom“ einen Ring, „Waschmaschine“ den Text „Schleudern“, „Ohne Verbindung“ steht ohne Wert da, Anna ist „daheim“, „Home Assistant“ zeigt „ok“.
- [ ] Küchenlicht und Kaffeemaschine lassen sich schalten; am Rollladen fährt ▲ auf 100 %, ▼ auf 0 %.
- [ ] Das Diagramm zeigt den Verlauf aus der Aufzeichnung (beim Platzhalter zwei Punkte).

**Homematic** (Layout `homematic`: <http://localhost:8191/?layout=homematic>)
- [ ] „Bad“ zeigt 22,4 °C mit 58 % darunter, „Rollladen“ einen Ring bei 50 %, „Rollladen fährt“ den Text „STABLE“, „Zentrale“ zeigt „ok“.
- [ ] „Flurlicht“ lässt sich schalten und bleibt nach einer Sekunde in der neuen Stellung. Am Rollladen fährt ▲ auf 100 %, ▼ auf 0 %; der Ring folgt.
- [ ] Im Protokoll des Kerns steht, dass alle Werte in einem Aufruf kommen.

**Fremde Seiten** (Layout `web`: <http://localhost:8191/?layout=web>)
- [ ] „Vorschau“ zeigt die Seite verkleinert, die Uhrzeit darin läuft. Antippen öffnet sie über die ganze Anzeige; dort zählt die Taste „Angetippt“ mit, und die Seite wurde dabei nicht neu geladen („Geladen um“ bleibt). „Versuch, die Anzeige zu verlassen“ bewirkt nichts – in der Konsole steht dazu eine Zeile über die verweigerte Navigation, die hier erwartet ist. Das Kreuz bringt die Kachel zurück.
- [ ] „Bedienbar“ lässt sich schon in der Kachel bedienen und rollen, der Pfeil oben rechts zeigt sie groß; jede Minute wird sie neu geladen („Geladen um“ springt).
- [ ] „Verboten“ sagt, dass die Seite das Einbetten nicht erlaubt, und nennt die Kopfzeile; „Ohne Adresse“ meldet eine ungültige Webadresse.
- [ ] `curl "http://localhost:8191/api/v1/embed?url=https://example.org/"` wird mit 400 abgelehnt: Der Kern ruft nur Adressen ab, die in einer Kachel stehen.

**Meldungen**
- [ ] `curl -X POST http://localhost:8191/api/v1/events/hausglocke`: Auf jeder offenen Anzeige erscheint oben die Tafel „Jemand klingelt an der Haustür!“, die Türglocke ertönt (nach einer Berührung der Seite), der Text wird vorgelesen; nach 15 Sekunden oder durch Antippen verschwindet sie.
- [ ] Die Eieruhr auf wenige Sekunden stellen: Läuft sie ab, erscheint von selbst „Die Eieruhr ist abgelaufen.“ – ausgelöst durch den Datenpunkt, ohne Aufruf von außen.
- [ ] Eine unbekannte Meldung (`…/events/gibt-es-nicht`) wird mit 404 abgelehnt.
- [ ] `…/events/monitor-aus` ist ein reines Signal: Auf den Anzeigen erscheint nichts.
- [ ] Monitorsteuerung im Probelauf: `monitor.json` mit `{ "server": "http://localhost:8191" }` anlegen und `powershell -ExecutionPolicy Bypass -File extras\monitor-windows\monitor.ps1 -DryRun` starten. Auf `…/events/monitor-aus` und `…/monitor-an` hin steht „Probelauf: Monitor aus“ bzw. „an“ im Fenster; mit `"datapoint": "demo:licht_esstisch"` folgt es dem Schalter „Esstisch“. Wirklich geschaltet wird im Probelauf nichts.

**Fernsehen in der Kamerakachel, Markise** (Layout `zweites`: <http://localhost:8191/?layout=zweites>)
- [ ] Die Kachel „Kamera“ hat in der Testinstanz kein Bild, trägt aber ihren Namen. In der Radioleiste „Testbild“ wählen: Die Kachel heißt jetzt „Testbild“ – das Fernsehen hat sie übernommen. „Aus“ gibt sie der Kamera zurück.
- [ ] Markise: ▼ fährt aus, die Prozentzahl daneben läuft bis 100; ■ hält an, ▲ fährt ein. Im Hauptbild heißen die Tasten „ein“ und „aus“.

**Küche** (Layout `kueche`: <http://localhost:8191/?layout=kueche>)
- [ ] Die ganze Aufteilung eines Küchenbildschirms auf einen Blick: links zwei Kameraflächen, Sonne und Mond und das Rezept mit Bild; in der Mitte Uhr, Wetter, Sprechen, sechzehn Messwerte, Diagramme, Anrufe, E-Mail, Schalter mit Markise und Radio; rechts Nachrichten, Termine, Erinnerungen und die Einkaufsliste. Nichts überlappt, nichts ist abgeschnitten – auch nicht mit `&theme=glut&night=nacht`.

**Sonne und Mond** (Layout `haus`)
- [ ] Drei Kacheln für drei Orte der Erde – Deutschland, Tokio, San Francisco –, damit immer eine den Tag und eine die Nacht zeigt: Am Tag wandert die Sonne mit Strahlenkranz über den Bogen, nachts der Mond in seiner Phase vor funkelnden Sternen; unten stehen Auf- und Untergang und die Tageslänge, oben was als Nächstes kommt und die Mondphase.
- [ ] <http://localhost:8191/?layout=haus&theme=glut&night=nacht>: Eine halbe Stunde nach Sonnenuntergang in Deutschland zeigt die Anzeige das Schema „Nacht“, bis eine halbe Stunde vor Sonnenaufgang – sonst „Glut“; ohne `night` bleibt es bei „Glut“.

**Farbschema**
- [ ] <http://localhost:8191/?theme=glut>, `schiefer`, `signal`, `nacht` und `spiegel` nacheinander: Jede Kachel bleibt lesbar, die Uhr trägt die Akzentfarbe (bei `signal` als Fläche), Überschriften, Schalter und Diagramm passen zum Schema. Ohne Zusatz gilt wieder „Klar“.
- [ ] Eieruhr in `signal` ablaufen lassen: Die Fläche der Uhr wird rot, die Ziffern bleiben lesbar.

**Sprache**
- [ ] In `config.json` der Testinstanz `site` auf `{ "language": "en", "region": "en-US" }` stellen: Texte englisch, Uhr mit AM/PM, Datum in US-Schreibweise.

## Prüfung mit eigenen Geräten

Das Folgende lässt sich nicht nachstellen und wird an der eigenen Installation geprüft – bewusst und einzeln, nie nebenbei:

- Schalten gegen das echte openHAB (ein Licht, dessen Zustand man sieht)
- Kameras: Bild füllt die Kachel ohne schwarze Ränder, Vollbild beim Antippen zeigt das ganze Bild, Verhalten bei abgezogener Kamera
- Home Assistant an einer echten Installation (ein Wegwerf-Container genügt): Anmeldung mit Token, einlesen, Licht, Schalter, Rollladen und Zahl setzen, Verlauf
- Homematic an einer echten Zentrale: einlesen, einen Schalter schalten und zurückstellen – nur lesende Aufrufe und `setValue`; der Konnektor darf sich nie für Meldungen anmelden (`init`), das kann die Zentrale lahmlegen
- MQTT am echten Broker: Anmeldung, ein Gerät lesen, ein Gerät schalten und den vorigen Zustand wiederherstellen, selbst angemeldete Geräte
- Fernsehen: Bild und Ton über go2rtc und ffmpeg, Umschalten zwischen Sendern
- Ton der Anzeige am vorgesehenen Bildschirm: Radio, Klingelton der Eieruhr, Start ohne vorheriges Antippen
- Artikelfenster im vorgesehenen Browser und Vollbildmodus der Anzeige
- FRITZ!Box: Anmeldung, Anrufliste, Abspielen einer echten Nachricht des Anrufbeantworters, Klingeln über den Anrufmonitor
- E-Mail: Abruf aus einem echten Postfach, Öffnen einer HTML-Nachricht mit eingebetteten Bildern, Verhalten bei falschem Kennwort
- Google: Anmeldung mit `npm run google:login` am echten Konto; danach zeigen die Kacheln die echten Termine und die Erinnerungen aus den Kontakten
- Sprache mit dem echten Sprachmodell: Fragen nach Werten („Wie warm ist es draußen?“, „Wann geht die Sonne unter?“) – trifft die Antwort den richtigen Wert, ist sie als Satz gut vorzulesen?
- Zutaten eines eigenen Rezepts auf die echte Einkaufsliste setzen: Mengen, Einheiten und die Warengruppen, die Merkio selbst vergibt
- Fremde Seiten, die tatsächlich eingebettet werden sollen (Grafana, Geräteseiten): Anmeldung, Darstellung in der Kachel, Verhalten über HTTPS

## Vor einer Lieferung

1. `npm run check` läuft durch.
2. `npm run build`, dann die Prüfliste Oberfläche an der Testinstanz – mindestens die Abschnitte der geänderten Bausteine und „Start“.
3. Was eigene Geräte braucht und geändert wurde, an der eigenen Installation prüfen.
4. Nach dem Push: Beide Aufträge auf GitHub sind grün.
5. In der Meldung zur Lieferung steht, was geprüft wurde und was nicht.

## Bekannte Lücken

- Die Oberfläche hat noch keine automatischen Tests; die Prüfliste oben ersetzt sie vorerst. Vorgesehen sind Browsertests gegen die Testinstanz mit Playwright (Apache-2.0).
- Die Abdeckung der Tests wird nicht gemessen.
- Die Plugins für openHAB, MQTT, Homematic, Home Assistant, Radio und Video sind in ihrer Logik und – bei MQTT, Homematic und Home Assistant – gegen Platzhalter getestet, nicht automatisch gegen echte Gegenstellen.
