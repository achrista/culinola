# Testing

This document defines how Culinola is tested: what runs automatically, what is checked by hand
against a fixed list, and what can only be checked with your own devices.

## Overview

| Level | Checks | How | When |
|---|---|---|---|
| Type checking | Core, plugins, interface including `.vue` files | `npm run typecheck` | on every push (GitHub) |
| Unit tests | Logic per package: reading feeds, reading recipes, egg timer, access rules, history data … | `npm test` | on every push |
| Interplay | Core with real plugins via the API: sources, actions, access protection, plugin addresses, saving layouts, setting up sources at runtime | `npm test` (`packages/core/src/integration.test.ts`) | on every push |
| Licenses | All shipped dependencies are permissively licensed | `npm run licenses` | on every push |
| Image | Docker image builds, starts, responds and shuts down cleanly | job `docker` in `.github/workflows/ci.yml` | on every push |
| Interface | Every tile according to the list below | test instance and browser, by hand | before every delivery that touches the interface |
| Own devices | Switching in openHAB, cameras, television, sound | own installation, by hand | when the component in question was changed |

`npm run check` combines type checking, tests and license check. It must pass before every commit.

## Rules for automatic tests

- Tests live as `*.test.ts` next to the code they test, and run with Vitest.
- A plugin keeps its logic in a module without network and without file system (`parse.ts`, `library.ts`, `timer.ts` …). This module has tests; `index.ts` only wires things up.
- If a plugin gets actions or addresses of its own, a case goes into the interplay test.
- When a bug is fixed, the test that shows it comes first.
- Everything that reads input from outside – feeds, recipes, configuration, addresses – has tests for broken and malicious input, not only for good input.
- Tests need neither internet nor own devices nor an open port.

## Test instance

The interface is never checked against your own data, but against a test instance with made-up values:

```bash
npm run build
```

```bash
npm run test:instance
```

It runs at <http://localhost:8191>, alongside an own installation on port 8090. The template is in `testing/instance` and is placed afresh into a throwaway folder at every start; whatever is changed there is forgotten after the next start.

The test instance contains: sun and moon for three places, made-up readings, two cars, four family members, switches, weather data, appointments, reminders, e-mails and calls, egg timer, four recipes (with image, without details, with broken details, with ingredient table), news from two real feeds and one unreachable one, a radio station, and deliberately an unknown widget. News and radio need internet. The shopping list comes from a stand-in for Merkio (`plugins/source-merkio/src/standin.ts`) with a made-up family; it imitates sign-in, lists, entries and the real-time channel, but is not the real Merkio. For adding recipes, it starts a stand-in for the Claude API on your own computer (`packages/recipe-import/src/standin.ts`): it answers in the shape of the real interface with a fixed recipe. This way the whole path from upload to recipe file runs without anything leaving the house or costing anything – what the language model makes of a real source is not checked by this. Devices via MQTT come from a stand-in broker (`plugins/connector-mqtt/src/standin.ts`) with a replayed air sensor and a switchable light, which register themselves like Tasmota. Home Assistant is a stand-in with made-up devices (`plugins/connector-homeassistant/src/standin.ts`). Homematic comes from a stand-in central unit (`plugins/connector-homematic/src/standin.ts`) with a switch, a roller shutter and a wall thermostat. For the `web` tile, it starts two small pages on your own computer: one that can be embedded and one that forbids it.

## Interface checklist

Checking is done at 1920 × 1080 and additionally once narrow (about 800 × 480). The browser's console stays open meanwhile; apart from the two deliberately missing images of the Streifenkuchen, it must show no errors.

**Start**
- [ ] The page loads, all tiles are in their place, nothing overlaps.
- [ ] In the place of the unknown widget there is a notice with its name.
- [ ] `?layout=zweites` on the address shows the second layout (clock and a reading), `?layout=fehlt` a message that this layout does not exist.
- [ ] Stop the core: the message "No connection to the core" appears. Start the core: it disappears without reloading.

**Edit layout** (<http://localhost:8191/?layout=haus&edit>, alongside it in a second window <http://localhost:8191/?layout=haus>)
- [ ] The layout is shown to scale with real values and grid; the tiles cannot be operated here. Tapping selects a tile: frame, eight handles, kind and position on the right.
- [ ] Dragging moves the tile in the grid, also with a finger; at the edge it stops. Over another tile the target turns red, and on release it jumps back.
- [ ] Each handle resizes, the opposite edge stays put; the tile's content adapts already while dragging.
- [ ] Arrow keys move, with Shift they resize, Del removes; the number fields on the right set the position, an occupied one is not accepted. ↶ and ↷ (Ctrl+Z, Ctrl+Y) undo and redo every step, "Discard" too.
- [ ] Reload the page: the draft is still there, "Save" is selectable.
- [ ] The sidebar lists the tile types by House, Media, Family, Other with symbol, name and a sentence. Tap "Note": it appears at the first free spot and is selected. In the test instance, "Calls", "E-mail", "Calendar", "Reminders" and "Camera" appear greyed out and name the source they lack.
- [ ] "Copy" duplicates the selected tile with its settings at the same size. If there is no room for it (for example under `?layout=kueche&edit`), the editor says so instead of moving anything.
- [ ] A tile cannot be dragged smaller than its smallest sensible size (a chart in the 48 × 24 grid: 8 × 4).
- [ ] Select the new note: enter heading and text – after leaving the field the tile shows it. Empty the field: the entry disappears again.
- [ ] Select a reading, "Choose" at the reading: searching for "batt" finds "Batterie" with value and unit; the filters by source and "switchable only" narrow it down. Tapping enters the datapoint, the tile shows it immediately. The identifier can also be entered by hand.
- [ ] "Ring" and "Warning limits" unfold; a maximum value turns the number into a ring, emptying all fields removes the group entirely (check under "Advanced").
- [ ] Switches (`?layout=zweites&edit`): unfold entries, reorder with ↑ ↓, remove with ✕, "+ Add" – for the new entry the selection at first shows only switchable things. "Kind: Move" gives the entry three buttons.
- [ ] Tiles with a source (radio, clock): the list names the configured instances; "Default" removes the entry.
- [ ] "Advanced": the JSON follows the form; `{ "title": "Probe" }` and "Apply" works like the form, invalid JSON is rejected with a message. An entry that the form does not know is preserved when changes are made in the form.
- [ ] Every change to the settings can be undone with ↶.
- [ ] "Grid … ▾" under `?layout=haus&edit`: 12 × 6 to 24 × 12 with "Convert tiles" – the picture stays the same, the grid is finer. Going back to 12 × 6 works. 12 × 6 to 5 × 3 is rejected because tiles would overlap. Without "Convert tiles" to 12 × 8: the tiles stay at the top, two rows are free at the bottom.
- [ ] Screen 9 and 16: the view is upright; 1280 and 800: wider, the tiles show what they show on such a screen. Every change can be undone.
- [ ] "Layouts ▾": create "probe" from the template "Kitchen" – the editor shows the new layout with the kitchen's arrangement, the readings without value. Created as a "Copy", it contains what was currently in the editor, including unsaved changes. A name that exists and one with capital letters are rejected.
- [ ] Rename to "probe-zwei": the editor shows it under the new name, in `config.json` it is at the same place. With unsaved changes, renaming is blocked.
- [ ] "Delete" asks; "Yes, delete" removes the layout and shows another. A display that showed the deleted layout keeps its picture until reload.
- [ ] The unknown tile (main layout) can be selected, moved and copied; its settings are preserved when saving.
- [ ] "Save": the second window shows the new layout without reloading. In the test instance's data folder there is a `config.vor-<timestamp>.json` with the state before, and the core's log says "Layout "haus" gespeichert" (layout saved).
- [ ] Edit in two windows: the first saves, the second has a draft of its own – there the query appears with "Reload" and "Save my version"; both do what they say.
- [ ] Change the test instance's `config.json` by hand (move a tile): after a few seconds display and editor show the new state. A broken file produces a warning in the log, the displays stay as they are.
- [ ] Narrow and with `&theme=nacht`: the control bar wraps, the sidebar moves below the layout.

**Setting up sources** (<http://localhost:8191/?edit=sources>)
- [ ] The list shows all sources of the test instance with a green dot and "running". "Layouts" leads to the layout editor, there "Sources" leads back.
- [ ] Select `timer`, set "Keep counting after expiry" to 45, "Save and restart": the message "Saved …" appears, the core's log says "Quelle "timer" geändert, sie startet neu" (source changed, restarting), and afterwards the egg timer can be set on a display. The new value is in the test instance's `config.json`, next to it a backup.
- [ ] `merkio`: the credentials appear as "stored", the fields are empty. Saving without input does not change them; "Remove stored" at the password and save: the source appears as faulty with the cause. Enter the password from the test instance's `secrets.json` again: it runs again.
- [ ] `news`: the feeds from the catalog cannot be changed in the form (notice), but under "Advanced" as JSON.
- [ ] `radio`: unfold stations, change a name, save – a display's radio bar shows it after reloading.
- [ ] "Add a source": plugin "Sun and moon", identifier `astro-test`, "Next" – the source appears as "new" in the list and is not yet created. Without latitude, "Create and start" is rejected with the plugin's message; with 48 and 11 it runs, and its datapoints (`astro-test:…`) appear in the selection in the layout editor.
- [ ] "Add a source" with "openHAB" and the address `http://localhost:9`: the explanation for setting up appears unfolded; after creating, the source is faulty, and the message names the reason in words ("Connection refused …"), not just "fetch failed". Empty fields show their example as "e.g. …".
- [ ] "Homematic" with the address `localhost` as a new source: it runs, but delivers only its state; under "Source messages", after a few seconds, it says that the central unit is unreachable. The existing source `homematic` of the test instance shows there how many channels and datapoints were read in.
- [ ] A second "Egg timer" (`kurzzeit`) does not start – the cause is shown at the source, the first egg timer keeps running. "Remove source" asks and takes it out.
- [ ] An invalid setting (for example `"overrunSeconds": "viel"` under "Advanced") is rejected on saving with the plugin's message; nothing is saved then.

**Settings** (<http://localhost:8191/?edit=settings>, alongside it in a second window a display)
- [ ] Display: choose color scheme "Nacht" and save – the second window turns dark without reloading. Language "English": the texts of the display and of this page change immediately; layout editor and sources are English afterwards too. Set it back.
- [ ] Set "Night begins … minutes after sunset" to 45 and save: under "Sources" the value appears at `astro`, the source is running. Empty the field: the default 30 applies again.
- [ ] Messages: the test instance's four messages are there; unfolded they show text, sound and their condition. "Trigger as a test: hausglocke" – the board appears on this page with doorbell and the text read aloud, and in the second window (there with sound only after it has been tapped once).
- [ ] "+ Add": name `probe`, text "Probe", under "Trigger by itself" the datapoint `demo:licht_esstisch`, condition "exactly", value `true`. Save, then switch on at the "Esstisch" switch of a display: the board appears. A message without text or with a duplicate name is rejected on saving with a readable message.
- [ ] Access protection: the page says that Culinola is open, and "How access protection works" explains password, pairing and tokens. Set a setup password – two different entries are rejected, one with fewer than 8 characters too. Afterwards the page stays operable and says that a password is set.
- [ ] Pairing: reload the second window – instead of the display it shows a six-digit code and the address of the settings. Within a few seconds the request appears on the settings page under "Pair devices" with the same code, browser, layout and address. Allow it as `flur` with "read": the second window loads the display by itself; it can be viewed but not switched, and `flur` is listed under "Access entries and tokens". A name that already exists is rejected with a readable message and the request stays.
- [ ] Remove `flur`: the second window shows a code again after reloading. "Reject" – it says that the request was rejected and offers "Ask again".
- [ ] "Sign out": the sign-in page appears. A wrong password is rejected with "Das Kennwort stimmt nicht."; the right one opens the settings again. Opening `?layout=main&edit` or `?edit=sources` in a window that is not signed in shows the sign-in page too; "Back to the display" leads to the display.
- [ ] "Forgot the password?" → "Request setup code": the page names the file; `einrichtungscode.txt` is in the test instance's data folder, and the core's log names the same code. A wrong code is rejected; with the right one and a new password the settings open, the old password no longer works, the file is gone, and the paired displays keep running.
- [ ] Access entries and tokens: create `regel` with "read and operate" – the token appears once; `Authorization: Bearer …` with it may trigger a message (`POST /api/v1/events/hausglocke`) but not read `/api/v1/settings`. As long as a password is set, no entry needs the level "set up".
- [ ] Remove all access entries, then "Remove password": the page says that Culinola is open again, and the second window shows the display without a code.

**Clock and egg timer**
- [ ] Time with seconds and date are right.
- [ ] Tapping opens the selection. Choose a preset, shorten to 10 seconds with −10 s, start: the selection closes, the remaining time appears large in the place of the time, the time with seconds below in the place of the date, both dark on a yellow surface.
- [ ] After expiry it rings for a few seconds; the display turns red and keeps counting with a minus sign, plus a short sound every two seconds. Tapping switches everything off, time and date are back.
- [ ] The short sound after the ringing is clearly quieter than the ringing itself. Under `?layout=web` the clock is set to `"ringVolume": 50, "reminderVolume": 0`: it rings more quietly there, and afterwards stays silent while the display keeps counting.
- [ ] Let it expire again and do not tap: after 30 seconds (in the test instance; otherwise 120) the egg timer ends by itself.
- [ ] Start stopwatch: the time runs forwards, without a colored surface. Reload the page: it keeps running. Stop.

**Readings and chart**
- [ ] Tiles show value, unit and status dot; the values change without reloading.
- [ ] The two flat tiles (Waschen, Bad) show dot, name, secondary value and value in one line, without anything cut off.
- [ ] The chart shows "Today" from 0 to 24 o'clock with the marker for now; week and month can be chosen.

**Weather**
- [ ] The small tile shows symbol, temperature, weather conditions, wind rose with speed, UV index and as many days as there is room for; the first is called "Today".
- [ ] The large tile shows all five days with matching symbols: clouds, sun, rain, thunderstorm, sleet.
- [ ] The wind rose's pointer moves (in the test instance once around per hour), the compass direction below follows it.

**Appointments and reminders**
- [ ] Appointments: "Today" begins with the ongoing multi-day visit (without time), below it the evening appointment; "Tomorrow" shows the all-day appointment before those with a time; the appointment without a title is called "(untitled)".
- [ ] Reminders: yesterday grey, today bold with "today"; sentences with age ("turns … years old"), for the deceased ("would have turned …"), name day, wedding anniversary and a custom label.
- [ ] Tapping a reminder shows the sentence and the phone numbers large; for a contact without a number the notice about that appears, for the deceased nothing.

**Calls**
- [ ] The list shows per call arrow, name or number, time and duration; missed and rejected ones with a red sign, the call without a number as "Unknown". For callers without a name, the origin appears under the number: "Augsburg", "Vienna, Austria", "Special-rate number".
- [ ] Every three minutes, for twenty seconds, "Ringing: Tante Rosa" appears above the list – the name comes from an earlier call of the same number. At the beginning a short two-tone sounds once (after the page has been tapped once).
- [ ] Tapping shows number, kind, time, duration and device. For the call with a message, a player appears, and a one-second tone can be heard.

**E-mail**
- [ ] The list shows sender, subject and time, newest on top; unread ones bold, messages with attachments with a paperclip, the mailbox on the right. Next to the heading it says that "Verein" is unreachable.
- [ ] The list can be scrolled with finger or mouse wheel and returns to the start after a minute; likewise appointments and reminders.
- [ ] Open "Ihre Abrechnung": header details, the attachment with name and size, the formatted text. The browser window's title stays "Culinola", the foreign image is missing, the link leads nowhere.
- [ ] Open a text message: line breaks are preserved. The message without sender and subject shows the placeholders.

**Switches**
- [ ] Tapping toggles, the state is visible immediately and the same after reloading.

**Radio**
- [ ] Tap a station: sound plays, the title appears, the media window shows the station name. A title longer than its field scrolls through after a short rest and starts over; a short one stands still.
- [ ] Louder and quieter work. "Off" ends the sound.

**News**
- [ ] The tile shows an item with image, feed and time and changes by itself; the round button skips ahead.
- [ ] The unreachable feed does not disturb the others; the core's log shows exactly one warning about it.
- [ ] Tap an item from the Augsburger Allgemeine: the article appears over the display. "Close" and the Esc key lead back.
- [ ] Tap an item from Deutsche Welle: a window of its own the size of the screen opens. If it is closed, the display is free again; without intervention it closes by itself after 60 seconds.

**Recipes**
- [ ] Both tiles show the Streifenkuchen with image – only this recipe has one; recipes without an image don't come up in the rotation.
- [ ] Tapping opens the recipe: details, image, list with checkboxes, link.
- [ ] The browser window's title stays "Culinola", the script text appears as text, the two foreign images are missing.
- [ ] The arrow opens the list with four recipes; "Kaputte Kopfdaten" can be opened. Under the Streifenkuchen the origin "Familienrezept" appears, under the Linsensuppe "Beispielseite".
- [ ] Type "kuch" into the search field: only Pfannkuchen and Streifenkuchen remain; "SUPPE lins" leaves the Linsensuppe, "xyz" the note that no recipe matches. × empties the field, and after closing and reopening the list it is empty again.
- [ ] A− and A+ change the font size; it is kept after closing.
- [ ] "Cooking this" at the Linsensuppe: after closing, both tiles show the Linsensuppe with "Cooking now" and no longer change; tapping opens it again. "Done cooking" brings back the rotation.
- [ ] Open Pfannkuchen, "Shopping": five ingredients appear selected, "4 servings" at the top. Press "+" twice: "6 servings", 250 g of flour become 375 g. Deselect salt (the selection is kept when converting), "Add to the list (4)": above the recipe it says how many ingredients were newly put on the list and how many were already there; under `?layout=einkauf`, "Mehl 375 g" and "Butter zum Backen" appear. Milk and eggs were already there and stay as they are.
- [ ] For the Streifenkuchen and the Linsensuppe, "Shopping" is missing – they have no ingredient table.
- [ ] Put a file into the test instance's recipe folder: it appears in the list without a restart.
- [ ] "+ Recipe" in the list: paste a text whose first line is the title – after "Add" the new recipe opens with the note "Added." and appears in the list under "Sonstiges".
- [ ] Choose a photo (preferably over 5 MB): the recipe bears the file's name, the photo appears in the reading view next to the text and on the tile.
- [ ] The text "Kein Rezept" and the address `http://192.168.178.1/` are rejected with a readable message; the input stays.
- [ ] Narrow window (phone): the form fills the width, "List" leads back.

**Lists** (layout `einkauf`: <http://localhost:8191/?layout=einkauf>)
- [ ] "Einkauf" shows the open entries in columns with the quantity behind them, the number of open ones in the header and "Kaffee" struck through at the end.
- [ ] Tapping ticks off: the entry moves struck through to the end, the second Einkauf tile follows immediately. Tapping again removes the tick.
- [ ] "+": "2 kg Mehl" appears as "Mehl 2 kg"; "kaffee" makes the ticked-off coffee open again instead of entering it twice. The field stays open for further entries.
- [ ] "Zu tun" shows the task list, the tile with the unknown list "Urlaub" says that this list was not found.

**House** (layout `haus`: <http://localhost:8191/?layout=haus>)
- [ ] PV, battery and consumption appear as rings that fill with the value; the battery is green because it is above its warning limits.
- [ ] The two cars show fill level in the ring and the range below; the almost empty estate car is yellow.
- [ ] The same entry in the flat and in the narrow tile stays legible.
- [ ] The estate car and "Bad veraltet" appear greyed out because their "Data current" switch is off; the narrow tile alternates every minute between fresh and greyed out.
- [ ] Presence: Anna and Ben "home" in green, Cleo and Dana "away"; the tall tile has two rows, the flat one one; an entry without a value appears pale as "unknown".

**Speaking** (layout `haus`)
- [ ] Tap the "Speaking" tile. With microphone and Chrome: say "Eieruhr auf 5 Minuten" (egg timer for 5 minutes) – the sentence appears at the bottom, then "Done.", the answer is read aloud, and the clock next to it counts backwards. The Claude API stand-in only understands fixed sentences: egg timer for n minutes, "Put … on the shopping list", "Play …".
- [ ] Without speech recognition (or via ⌨) the sentence can be typed; "Put yeast on the shopping list" then appears in the list (`?layout=einkauf`).
- [ ] "How warm is it outside?" (typed or spoken): the answer gives the value of the "Außen" tile – with the stand-in raw as "Außen: 15,8 °C", the real language model makes a sentence of it. "Is the light at the dining table on?" names the switch. The core's log says which values were read, not their state. The stand-in reads what is named in the sentence, otherwise the first value.
- [ ] "Put the ingredients for the pancakes on the shopping list": "Done.", and the ingredients are on the list.
- [ ] A sentence the stand-in does not know gets an answer without an action; the board disappears by itself after a few seconds.
- [ ] Wake word (only with speech model: `CULINOLA_VOSK_MODEL=<path to model.tar.gz> npm run test:instance`, microphone and `localhost`): under the button it says "computer …". "Computer, put yeast on the shopping list" leads to the entry without tapping; just "Computer" yields a tone and "Listening …", the next sentence is carried out; a sentence without the word does nothing. After an answer without an action ("not understood") "Listening …" appears again, and the next sentence is carried out without the word; if it stays silent, the board disappears after a few seconds.

**Devices via MQTT** (layout `mqtt`: <http://localhost:8191/?layout=mqtt>)
- [ ] CO₂ appears as a ring and changes every ten seconds, the temperature shows 21.5 °C, "Bauart" shows "B" (set up by hand), "Broker" shows "ok". Names and units come from the devices themselves.
- [ ] "Nachtlicht" can be switched on and off; the switch follows the device's feedback.
- [ ] `GET /api/v1/datapoints` lists under `mqtt:` only the understood devices – the sensor with a computing template and the heater are missing; the core's log says how many were registered and how many skipped.

**Home Assistant** (layout `homeassistant`: <http://localhost:8191/?layout=homeassistant>)
- [ ] "Außen" shows 12.3 °C, "Strom" a ring, "Waschmaschine" the text "Schleudern", "Ohne Verbindung" appears without a value, Anna is "home", "Home Assistant" shows "ok".
- [ ] Kitchen light and coffee machine can be switched; at the roller shutter ▲ moves to 100 %, ▼ to 0 %.
- [ ] The chart shows the history from the recording (two points with the stand-in).

**Homematic** (layout `homematic`: <http://localhost:8191/?layout=homematic>)
- [ ] "Bad" shows 22.4 °C with 58 % below, "Rollladen" a ring at 50 %, "Rollladen fährt" the text "STABLE", "Zentrale" shows "ok".
- [ ] "Flurlicht" can be switched and stays in the new position after a second. At the roller shutter ▲ moves to 100 %, ▼ to 0 %; the ring follows.
- [ ] The core's log says that all values arrive in one call.

**Embedding other pages** (layout `web`: <http://localhost:8191/?layout=web>)
- [ ] "Vorschau" (preview) shows the page shrunk, the time in it runs. Tapping opens it across the whole display; there the "Angetippt" (tapped) button counts along, and the page was not reloaded in the process ("Geladen um" (loaded at) stays). "Versuch, die Anzeige zu verlassen" (attempt to leave the display) does nothing – the console shows a line about the refused navigation, which is expected here. The cross brings the tile back.
- [ ] "Bedienbar" (operable) can already be operated and scrolled in the tile, the arrow at the top right shows it large; every minute it is reloaded ("Geladen um" jumps).
- [ ] "Verboten" (forbidden) says that the page does not allow embedding and names the header; "Ohne Adresse" (without address) reports an invalid web address.
- [ ] `curl "http://localhost:8191/api/v1/embed?url=https://example.org/"` is rejected with 400: the core only fetches addresses that appear in a tile.

**Messages**
- [ ] `curl -X POST http://localhost:8191/api/v1/events/hausglocke`: on every open display the board "Jemand klingelt an der Haustür!" appears at the top, the doorbell sounds (after a touch of the page), the text is read aloud; after 15 seconds or by tapping it disappears.
- [ ] Set the egg timer to a few seconds: when it expires, "Die Eieruhr ist abgelaufen." appears by itself – triggered by the datapoint, without a call from outside.
- [ ] An unknown message (`…/events/gibt-es-nicht`) is rejected with 404.
- [ ] `…/events/monitor-aus` is a pure signal: nothing appears on the displays.
- [ ] Monitor control as a dry run: create `monitor.json` with `{ "server": "http://localhost:8191" }` and start `powershell -ExecutionPolicy Bypass -File extras\monitor-windows\monitor.ps1 -DryRun`. On `…/events/monitor-aus` and `…/monitor-an`, "Probelauf: Monitor aus" or "an" appears in the window; with `"datapoint": "demo:licht_esstisch"` it follows the "Esstisch" switch. In a dry run nothing is actually switched.

**Television in the camera tile, awning** (layout `zweites`: <http://localhost:8191/?layout=zweites>)
- [ ] The "Camera" tile has no image in the test instance, but bears its name. In the radio bar choose "Testbild": the tile is now called "Testbild" – television has taken it over. "Off" gives it back to the camera.
- [ ] Awning: ▼ extends, the percentage next to it runs up to 100; ■ stops, ▲ retracts. In the main picture the buttons are called "on" and "off".

**Kitchen** (layout `kueche`: <http://localhost:8191/?layout=kueche>)
- [ ] The whole arrangement of a kitchen screen at a glance: on the left two camera areas, sun and moon and the recipe with image; in the middle clock, weather, speaking, sixteen readings, charts, calls, e-mail, switches with awning and radio; on the right news, appointments, reminders and the shopping list. Nothing overlaps, nothing is cut off – not even with `&theme=glut&night=nacht`.

**Sun and moon** (layout `haus`)
- [ ] Three tiles for three places on Earth – Germany, Tokyo, San Francisco –, so that one always shows day and one night: by day the sun with its rays travels across the arc, at night the moon in its phase in front of twinkling stars; at the bottom are sunrise, sunset and day length, at the top what comes next and the moon phase.
- [ ] <http://localhost:8191/?layout=haus&theme=glut&night=nacht>: half an hour after sunset in Germany, the display shows the scheme "Nacht", until half an hour before sunrise – otherwise "Glut"; without `night` it stays at "Glut".

**Color scheme**
- [ ] <http://localhost:8191/?theme=glut>, `schiefer`, `signal`, `nacht` and `spiegel` in turn: every tile stays legible, the clock bears the accent color (with `signal` as a surface), headings, switches and chart suit the scheme. Without a suffix, "Klar" applies again.
- [ ] Set the egg timer in every scheme and let it expire: yellow surface while it counts down, red surface afterwards, the digits stay legible on both.

**Language**
- [ ] In the test instance's `config.json`, set `site` to `{ "language": "en", "region": "en-US" }`: texts English, clock with AM/PM, date in US notation.

## Testing with own devices

The following cannot be reproduced and is tested on your own installation – deliberately and one at a time, never on the side:

- Switching against the real openHAB (a light whose state you can see)
- Restarting sources at runtime that hold more than a timer: cameras (go2rtc is stopped and restarted – are the ports free again immediately?), FRITZ!Box (call monitor), MQTT, Homematic, Merkio. After the restart nothing may run twice and nothing may hang
- Cameras: image fills the tile without black edges, full screen on tapping shows the whole image, behavior with the camera unplugged
- Home Assistant on a real installation (a throwaway container is enough): sign-in with token, reading in, setting light, switch, roller shutter and number, history
- Homematic on a real central unit: reading in, switching a switch and setting it back – read-only calls and `setValue` only; the connector must never register for notifications (`init`), as that can cripple the central unit
- MQTT on the real broker: sign-in, reading a device, switching a device and restoring the previous state, self-registered devices
- Television: picture and sound via go2rtc and ffmpeg, switching between stations
- The display's sound on the intended screen: radio, the egg timer's ringtone, start without tapping beforehand
- Article window in the intended browser and the display's full-screen mode
- FRITZ!Box: sign-in, call list, playing a real answering-machine message, ringing via the call monitor
- E-mail: fetching from a real mailbox, opening an HTML message with embedded images, behavior with a wrong password
- Google: sign-in with `npm run google:login` on the real account; afterwards the tiles show the real appointments and the reminders from the contacts
- Voice with the real language model: questions about values ("How warm is it outside?", "When does the sun set?") – does the answer hit the right value, does it read well aloud as a sentence?
- Putting the ingredients of a recipe of your own onto the real shopping list: quantities, units and the product groups that Merkio assigns itself
- Third-party pages that are actually meant to be embedded (Grafana, device pages): sign-in, presentation in the tile, behavior over HTTPS

## Before a delivery

1. `npm run check` passes.
2. `npm run build`, then the interface checklist on the test instance – at least the sections for the changed components and "Start".
3. What needs own devices and was changed, check on your own installation.
4. After the push: both jobs on GitHub are green.
5. The delivery message says what was checked and what was not.

## Known gaps

- The interface has no automatic tests yet; the checklist above replaces them for now. This also applies to dragging in the layout editor: its calculation is tested (snapping, limits, overlap, undo), not the operation with mouse and finger. Browser tests against the test instance with Playwright (Apache-2.0) are planned.
- Test coverage is not measured.
- The plugins for openHAB, MQTT, Homematic, Home Assistant, radio and video are tested in their logic and – for MQTT, Homematic and Home Assistant – against stand-ins, not automatically against real counterparts.
