# Google-Konto anbinden

Für Kalender und Erinnerungen liest Culinola aus einem Google-Konto. Dafür braucht es einen
eigenen Zugang bei Google, den jede Installation selbst anlegt – einmalig, kostenlos, etwa
zehn Minuten. Culinola erhält damit nur Lesezugriff auf Kalender und Kontakte.

## 1. Zugang bei Google anlegen

Im Browser mit dem Google-Konto anmelden, dessen Kalender und Kontakte gezeigt werden sollen.
Die Oberfläche erscheint deutsch oder englisch; genannt sind die englischen Bezeichnungen.

1. **Projekt anlegen:** <https://console.cloud.google.com/projectcreate> – Name `Culinola`, **Create**. Danach muss oben in der Leiste dieses Projekt gewählt sein.
2. **Schnittstellen einschalten,** jeweils **Enable**:
   - Google Calendar API: <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>
   - People API: <https://console.cloud.google.com/apis/library/people.googleapis.com>
3. **Zustimmungsseite einrichten:** <https://console.cloud.google.com/auth/overview> → **Get started**. App name `Culinola`, eigene Adresse als Support-Adresse; Audience **External**; eigene Adresse als Kontakt; Richtlinie bestätigen, **Create**.
4. **Zugang für das eigene Konto freigeben** – auf der Seite **Audience** einer von zwei Wegen:
   - **Testbetrieb:** unter **Test users** das eigene Google-Konto eintragen. Das geht sofort, die Anmeldung verfällt aber alle sieben Tage und muss dann mit `npm run google:login` wiederholt werden.
   - **Dauerbetrieb:** **Publish app**. Google gibt den Knopf erst frei, wenn auf der Seite **Branding** eine Startseite und eine Datenschutzerklärung auf einer eigenen Domain eingetragen sind und diese Domain unter den autorisierten Domains steht. Eine Prüfung durch Google ist für die eigene Nutzung nicht nötig; ein Logo sollte man nicht hochladen, weil es eine Prüfung auslöst.
5. **Zugang erzeugen:** links **Clients** → **Create client** → Application type **Desktop app**, Name `Culinola`, **Create**. Im Fenster danach **Download JSON** – später zeigt Google das Geheimnis nicht mehr an.
6. **Datei ablegen:** die heruntergeladene Datei als `client.json` in den Ordner `data/google` legen.

`client.json` gehört wie alle Zugangsdaten nur in den Datenordner und nie ins Repository.

## 2. Anmelden

```bash
npm run google:login
```

Der Befehl öffnet die Anmeldeseite von Google. Dort warnt Google, die App sei nicht überprüft –
das ist bei einem selbst angelegten Zugang so; über **Erweitert** → **Weiter zu Culinola** geht
es weiter. Beide Zugriffe (Kalender, Kontakte) erlauben. Die Anmeldung liegt danach in
`data/google/token.json`.

Die Antwort von Google geht an eine Adresse, die nur der eigene Rechner erreicht. Der Befehl
muss deshalb auf einem Rechner mit Browser laufen. Für einen Server ohne Bildschirm: auf einem
anderen Rechner anmelden und den Ordner `data/google` auf den Server kopieren.

## 3. Quelle eintragen

```json
{ "id": "google", "plugin": "source-google" }
```

Ohne weitere Angaben zeigt Culinola den Hauptkalender des Kontos. Welche Kalender das Konto
sieht, steht unter `/api/v1/resources/google/calendars`; weitere lassen sich mit
`"config": { "calendars": ["primary", "Name des Kalenders"] }` hinzunehmen. Alle Angaben
beschreibt die README im Abschnitt „Google-Konto“.

## Zugriff wieder entziehen

Unter <https://myaccount.google.com/permissions> lässt sich der Zugriff von Culinola jederzeit
entfernen. Danach `data/google/token.json` löschen.
