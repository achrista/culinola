# Culinola

A modular information display for the home – meant for a touch screen in the kitchen. Culinola brings together home automation, media and everyday life: readings and switches, charts, cameras, radio and television, news, recipes.

**Status:** first release under construction. The core with its API and real-time channel, the openHAB connection, and the clock, value tile, switch panel and chart are running.

## Basic ideas

- **Core and plugins.** The core provides infrastructure only; everything domain-specific is a plugin.
- **Capabilities instead of fixed systems.** A tile is tied to a datapoint, not to a particular smart-home system.
- **One API for everything.** The built-in interface uses the same API as any third-party program.
- **Only permissively licensed dependencies**, checked on every build.



## Structure

```
packages/
  core/      Backend core
  sdk/       Contracts and types for plugins
  ui/        User interface
  ui-kit/    Shared building blocks of the interface
plugins/     One folder per plugin
themes/      Bundled themes
docker/      Image and example Compose file
docs/        Concept and guides
testing/     Test instance with made-up values
```

## Getting started

Requirement: Node.js 22.18 or newer.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Culinola then runs at <http://localhost:8090>. Without any configuration of your own it shows made-up sample values.

### With Docker

[docker/Dockerfile](docker/Dockerfile) builds an image with the core, all bundled plugins and the interface; [docker/compose.yaml](docker/compose.yaml) is an example for running it:

```bash
cd docker && docker compose up -d --build
```

In the image, the folder `docker/data` becomes `/data` and holds `config.json`, `secrets.json`, recipes and station logos.

- The image contains go2rtc and ffmpeg for cameras and television. In `config.json` the paths are then `"go2rtc": { "binary": "/usr/local/bin/go2rtc", "ffmpeg": "/usr/bin/ffmpeg" }`. If you don't need video, build a smaller image with `--build-arg WITH_MEDIA=false`.
- On amd64 the image also contains the Intel VAAPI drivers. Pass `/dev/dri` into the container (see the commented lines in the compose example) and TV pictures are converted by the graphics chip instead of the processor. Without the device, nothing changes.
- The example uses the host's network (`network_mode: host`, Linux only), because the cameras' video transmission needs a peer that can be reached directly on the home network. Without video, exposing port 8090 is enough.
- The service runs as user 1000 and must be able to write to `data`.

## Setting up

Everything of your own lives in the `data/` folder, which does not end up in the repository. A different location can be given with the environment variable `CULINOLA_DATA`.

- **`data/config.json`** – sources and layout. [config.example.json](../config.example.json) is a template.
- **`data/secrets.json`** – credentials, kept apart from the configuration and never readable through the API:

  ```json
  { "openhab": { "token": "…" } }
  ```

  The outer name is the source's `id` from `config.json`.

### Sources in the interface

With the suffix `?edit=sources` – for example `http://localhost:8090/?edit=sources`, or via "Sources" in the layout editor – you can set up the sources without restarting the core: the page shows each source with its state (running, faulty and why), its settings as a form, and its credentials. "Save and restart" writes `config.json` and `secrets.json` (each with a backup next to it) and restarts only that one source; all the others keep running. New sources are added via "Add a source".

- **Credentials** are write-only. The core never gives passwords and tokens back out; the page only shows "stored" or "not stored".
- **"Running"** means that the source has started. Whether it reaches its device is shown by the **source's messages** on the same page and by its number of datapoints – for example "Central unit 192.168.178.9 unreachable: connection refused". If a plugin rejects the settings, nothing is saved; if the start fails, the cause is shown at the source.
- **"How to set up this source"** explains per plugin what to enter and where to get it – where in openHAB or Home Assistant a token is created, what has to be enabled on the Homematic central unit or the FRITZ!Box.
- What a form cannot show – for example feeds from the catalog, which appear only with their identifier – is preserved and can be changed as JSON under "Advanced".
- If access protection is set up, the page asks you to sign in with the setup password.
- If the sources in `config.json` are changed by hand, this takes effect as before after a restart; until then the page rejects changes so that nothing is overwritten.

### Settings in the interface

Under `?edit=settings` – or via "Settings" in the layout editor and on the sources page – you find whatever else can be set up. Every change takes effect immediately, without a restart, and is afterwards stored in `config.json`.

- **Display:** language, region for numbers and dates, color scheme, color scheme for the night, and the source that knows day and night. Open displays pick up the change without reloading.
- **Messages:** create, change, remove – text, sound, reading aloud, camera, duration, signal only, and the condition that triggers a message by itself. Saved messages can be triggered as a test.
- **Access protection:** the setup password, pairing displays, and access entries with tokens for programs – see [Access protection](#access-protection). Every change applies at once; nothing needs a restart.

Not in the interface: the port, HTTPS and the data folder – these stay in `config.json` and need a restart.

### Anonymous usage ping

So that we know how many installations there are, Culinola reports to `https://ping.culinola.org` once a day, starting a minute after it has started. The ping contains exactly this and nothing more:

- a random installation id, created on the first start and kept in `data/installation-id`,
- the Culinola version,
- operating system and processor architecture (for example `linux`, `arm64`),
- whether it runs in Docker, and whether it still runs on demo values.

No configuration, no datapoints, no names, no addresses of your devices. The receiving server does not store IP addresses; its code is in [extras/telemetry-worker](../extras/telemetry-worker). If the ping fails, nothing happens.

To switch it off, either set `"telemetry": false` in `config.json`, or set the environment variable `CULINOLA_TELEMETRY=0` – for Docker: `docker run -e CULINOLA_TELEMETRY=0 …`. Both need a restart. In CI runs (environment variable `CI`) it is always off. Deleting `data/installation-id` makes the installation count as a new one.

### Layout

The display is a grid. Each widget sits in it with `at: [column, row, width, height]`, counted from 0.

Several layouts may be listed under `layouts`. A display shows `main`; with the address suffix `?layout=name` it shows another – this gives the hallway its own picture, or lets you view a new draft next to the existing one.

**Editing in the interface:** With the suffix `&edit` – for example `http://localhost:8090/?layout=main&edit` – the layout opens for editing: move tiles with mouse or finger, resize them at the handles, nudge them with the arrow keys (with Shift: size), undo steps. Tiles must not overlap. The layout is shown to scale, like on the screen it is meant for; that screen's size is given by the optional entry `"screen": [1920, 1080]` on the layout (without it, 16:9 applies). The grid and screen size can be changed with the "Grid … ▾" button in the control bar; the tiles are converted to the new grid if you wish. Nothing is written until "Save"; until then the draft lives in the browser. The displays pick up the saved layout without a restart. The sidebar lists all tile types for adding – a new tile lands in its usual size at the first free spot –, copies the selected tile with its settings, and removes it. Tiles whose source is not set up appear greyed out. The settings of the selected tile are shown as a form in the sidebar; datapoints are chosen from a list that searches identifier and label, shows the current value and can be narrowed down by source. Every change affects the tile immediately. What has no form field (such as `map` on the value tile) can be changed as JSON under "Advanced". If access protection is set up, editing asks you to sign in with the setup password.

Via "Layouts ▾" you can create layouts – empty, as a copy of the one shown, or from a bundled template (`templates/`: kitchen, hallway, house only) –, rename them and delete them. Templates bring the arrangement but no datapoints; you enter those in the tiles afterwards. A layout's name appears in the display's address and therefore consists of lowercase letters, digits and hyphens.

When saving, the core rewrites `config.json` and first puts a backup next to it (`config.vor-<timestamp>.json`; the last ten are kept, backups named otherwise are left alone). Editing the file by hand remains possible: the core reads changed layouts in by itself after a few seconds; everything else takes effect as before after a restart.

| Type | Shows | Main settings |
|---|---|---|
| `clock` | Time with seconds and date; tapping sets the egg timer | `timer` (egg timer instance), `ringVolume`, `reminderVolume` |
| `value-tile` | Reading with status dot and history line; one grid row high, it shows everything in one line. With `gauge`, the value in a tall tile sits inside a ring that fills with it – for power, charge level or fuel level, with the secondary value (such as the range) below. Tapping the tile shows a chart across the whole display: by default the history of its own value (states set with `map` as steps), with `chart` one of your own | `datapoint`, `label`, `secondary`, `unit`, `decimals`, `factor`, `warn`, `map`, `gauge` (`{ "max": 100 }`, optionally with `min`), `fresh` (datapoint of a switch: if it is off, the tile appears greyed out – the value is then the last known one), `chart` (like the settings of a `chart` tile, `{ "title": "Temperature", "series": [ … ] }`, so several tiles can show the same chart; each line may also carry `factor` and `step`; `false` makes the tile open nothing) |
| `image` | An image from a web address that refreshes itself, such as the still image of a webcam; tapping shows it large | `url`, `refreshSeconds` (default 300), `label`, `fit` (`cover` or `contain`) |
| `web` | A third-party web page in the tile – rain radar, a chart from Grafana, the page of a device in the house. The tile is a preview; tapping shows the page across the whole display, where it can be operated (see [Embedding other pages](#embedding-other-pages)) | `url`, `label`, `zoom` (0.5 shows twice as much), `refreshMinutes`, `interactive` (can be operated already in the tile) |
| `presence` | Who is at home: one field per person with name and "home" or "away". Counted as present is a switch that is on, a number above zero, or a text such as `home` or `daheim` | `items` (list of `datapoint` and `label`), `home` (custom texts for "home") |
| `switches` | Panel of switches that adapts to the space; an entry with `"type": "cover"` gets three buttons for moving – for awning, roller shutter or blind – and shows the position | `items: [{ datapoint, label }]`; per entry `type` (`cover`), `up` and `down` (labels of the buttons, such as "on" and "off"); `columns` (fixed number of columns – otherwise the switches spread out according to the width; a cover takes two places) |
| `chart` | Time series for today, week, month | `title`, `series: [{ datapoint, label, area, forecast, factor, step }]` |
| `note` | Reserves a spot and labels it | `title`, `text` |
| `radio` | Station buttons, volume, current title – it scrolls through when it is longer than its field | `source` (radio instance) |
| `voice` | Speaking instead of typing: tap, say a sentence; the answer appears at the bottom of the display and is read aloud | `source` (default `voice`), `title`, `speak` (`false` turns off reading aloud), `wakeWord` (activation word, such as `computer`) |
| `video` (with `tv`) | The camera tile can also take over television: with `"tv": "radio"` it shows the picture of a running TV station including sound, and the camera image gives way for as long | additionally `tv` (radio instance) |
| `video` | Live image of a camera or stream; tapping fills the screen. The image fills the tile and is cropped at the edge for that; tapped large, it is shown in full | `source` (video instance), `stream`, `label`, `tv`, `fit` (`cover` as default, `fill` distorts instead of cropping, `contain` shows everything with margins) |
| `media-window` | Television picture for a TV station, logo for a radio station | `source` (radio instance), `video` (video instance), `idle` |
| `news` | One item with image, in turn from all feeds; tapping opens the article | `source` (news instance), `feeds`, `seconds`, `closeAfter` |
| `weather` | Weather conditions with symbol, wind rose, UV index and forecast starting today | `temperature`, `condition`, `code`, `wind`, `uv`, `sunrise`, `sunset`, `days` |
| `calls` | Calls and messages of the answering machine in a list; tapping shows details and plays the message | `source` (FRITZ!Box instance), `title`, `sound` |
| `calendar` | The next appointments, organized by day | `source` (Google instance), `title` |
| `reminders` | Upcoming birthdays and other recurring days; tapping shows the phone numbers | `source` (Google instance), `title` |
| `mail` | E-mails from all configured mailboxes, newest first; tapping shows the message | `source` (mail instance), `title` |
| `checklist` | A shopping or task list to tick off, set tightly in columns; "+" adds new entries | `source` (list instance, default `merkio`), `list` (identifier or name, otherwise the first), `title`, `recentHours` (how long ticked-off items stay visible, default 12) |
| `sun-moon` | Sun and moon: the sun travels along an arc from its rising to its setting, at night the moon in today's shape; plus rise and set times, day length and moon phase | `source` (default `astro`) |
| `recipes` | A randomly chosen recipe with image, changing in turn; tapping opens it, the arrow opens the whole list with its search field, in which new recipes can also be added | `source` (recipe instance), `title`, `seconds` |

`map` translates state values into text, for example `{ "0": "off", "1": "running", "3": "done" }`.

In the chart, "Today" runs from 0 to 24 o'clock. A series with `forecast: true` is drawn dashed and may extend beyond the current moment; readings end at the "now" marker. `factor` converts the values (100 for a share of 0.58), `step: true` draws states as steps.

`warn` takes up to four limits: `lowAlarm`, `lowWarn`, `highWarn`, `highAlarm`. The dot is green within range, yellow for caution, red outside and grey without rating.

`factor` converts a value for display – for example `100` if the source delivers humidity as a fraction (0.58) instead of a percentage.

### Devices via MQTT

The `connector-mqtt` plugin connects Culinola to an MQTT broker – for Tasmota, ESPHome, Zigbee2MQTT, Shelly and everything else that reports values there.

```json
{ "id": "mqtt", "plugin": "connector-mqtt", "config": { "url": "mqtt://192.168.178.10:1883" } }
```

The broker's user and password go in `secrets.json`: `{ "mqtt": { "username": "…", "password": "…" } }`. For a secured connection use `mqtts://`.

**Devices that register themselves.** Many devices register following the Home Assistant pattern (for Tasmota: `SetOption19 1`). They appear without further setup as datapoints, with name and unit; their identifier is the device's, for example `mqtt:4E3812_MHZ19B_CarbonDioxide`. `GET /api/v1/datapoints` shows which ones exist. Sensors, contacts, switches and lights (on and off) are picked up. Anything that computes its value first (templates with formulas) is skipped – such values can be set up by hand. `"discovery": false` turns discovery off, `"discovery": "other/prefix"` names a different topic prefix than `homeassistant`.

**By hand.** Each datapoint is tied to a topic:

```json
"datapoints": [
  { "id": "co2", "topic": "ACLuft/tele/SENSOR", "json": "MHZ19B.CarbonDioxide", "unit": "ppm", "label": "CO₂", "availability": "ACLuft/tele/LWT" },
  { "id": "nachtlicht", "topic": "ledschlafen/stat/POWER", "command": "ledschlafen/cmnd/POWER", "label": "Night light" }
]
```

| Setting | Effect |
|---|---|
| `id`, `topic` | Identifier of the datapoint (`mqtt:co2`) and the topic on which its value arrives |
| `json` | Location in the message if it is JSON: `MHZ19B.CarbonDioxide` |
| `command` | Topic to switch on; this makes the datapoint switchable |
| `on`, `off` | What "on" and "off" are called, sent as received; default `ON` and `OFF` |
| `availability` | Topic on which the device reports its reachability (`Online`/`Offline`, other words as `{ "topic": …, "online": …, "offline": … }`); a device that has gone offline appears as stale |
| `label`, `unit`, `type` | Label, unit and – where it isn't right by itself – the kind of value: `number`, `switch` or `text` |
| `retain` | Switched values remain on the broker |

Which topics a device sends on depends on its configuration – for Tasmota on the "FullTopic": either `device/stat/POWER` or `device/POWER`. When in doubt, listening in at the broker shows it (`mosquitto_sub -v -t "device/#"`). Templates that merely guard the value or name its kind are also picked up (`… if … is defined else …`, `| int`, `| float`).

A datapoint set up by hand takes precedence if a device registers the same identifier. The datapoint `mqtt:state` tells how the connection is doing: `ok`, `offline` or `login` (credentials missing or rejected). A broker keeps no history; charts show what the core has recorded since its start (at most 24 hours).

### Home Assistant

The `connector-homeassistant` plugin fetches devices and values from Home Assistant – and with them everything connected there.

```json
{ "id": "ha", "plugin": "connector-homeassistant", "config": { "url": "http://homeassistant.local:8123" } }
```

The access token goes in `secrets.json`: `{ "ha": { "token": "…" } }`. It is created in Home Assistant, in your own user profile under "Security", as a **long-lived access token**. With it, Culinola may do what that user may do – a dedicated user for the display keeps this manageable.

Each device becomes a datapoint with its identifier from Home Assistant: `ha:sensor.aussen_temperatur`, `ha:light.kueche`, `ha:cover.wohnzimmer`. Name and unit come from there. The state of all devices arrives on connecting, every change afterwards immediately; charts read the history from Home Assistant's recording.

| Kind in Home Assistant | In Culinola |
|---|---|
| `sensor` | Reading or text |
| `binary_sensor`, `person`, `device_tracker`, `sun` | State (on/off or text such as `home`) – suitable for the `presence` tile |
| `switch`, `light`, `input_boolean`, `fan` | Switch, switchable |
| `cover` | Position in percent; in the switch panel with `"type": "cover"`, move and stop |
| `number`, `input_number`, `select`, `input_select`, `input_text` | Value, settable |

Not picked up is whatever has no reading or is too sensitive to switch: locks, alarm systems, cameras, media players, scenes, buttons, heating controllers. With `"entities": ["lock.haustuer", …]` or `"domains": ["sensor", "light"]`, exactly that selection applies instead. For lights, only on and off are switched; brightness and color stay as they are.

What Home Assistant lists as unavailable appears without a value and as stale. `ha:state` tells how the connection is doing: `ok`, `offline` or `login` (token missing or rejected). Culinola establishes the connection itself; nothing needs to be set up in Home Assistant except the token.

### Homematic

The `connector-homematic` plugin connects a Homematic central unit – CCU2, CCU3 or RaspberryMatic, classic devices as well as Homematic IP. No additional software is needed on the central unit.

```json
{ "id": "homematic", "plugin": "connector-homematic", "config": { "host": "192.168.178.9" } }
```

Every value of a device becomes a datapoint, named after address, channel and value: `homematic:NEQ0370539.1.STATE` (a switch), `homematic:00111A0000BBBB.4.LEVEL` (a roller shutter, 0 to 100 %), `…​.1.ACTUAL_TEMPERATURE`. Label and unit come from the central unit; `GET /api/v1/datapoints` shows which datapoints exist. Switches can be switched, positions set and – as an entry with `"type": "cover"` in the switch panel – moved and stopped. A device that the central unit cannot currently reach appears with its last value as stale.

| Setting | Effect |
|---|---|
| `host` | Address of the central unit |
| `interfaces` | Device families: `"rf"` (classic, port 2001), `"ip"` (Homematic IP, 2010), `"wired"` (2000) or `{ "name": …, "port": … }`; default `["rf", "ip"]` |
| `pollSeconds` | Interval between queries, default 5 |
| `regaPort` | Port of the central unit's logic layer (default 8181); `0` does without it |

**How Culinola reads.** All values arrive in a single call to the central unit's logic layer, which keeps track of its devices' state anyway; this takes tenths of a second and is repeated every few seconds. A change at the wall switch therefore appears with a delay of a few seconds, and after switching by itself Culinola reads again immediately. If the logic layer cannot be reached (blocked on the central unit or `regaPort: 0`), Culinola queries channel by channel instead – at most every 30 seconds, because this noticeably keeps the central unit busy – and the datapoints are named after their address.

**Deliberately not:** The central unit could also report changes on its own, as other connections use it. For that it would have to be able to reach Culinola – and if it fails to (wrong address, firewall, container without port forwarding), its device interface hangs until it is restarted; nothing in the whole house can then be switched. The connector therefore establishes all connections itself and does not register anywhere on the central unit.

The central unit must allow the accesses (Settings → Control panel → Firewall: "XML-RPC API" and "Remote HomeMatic-Script API"). If it requires a login, user and password go in `secrets.json`: `{ "homematic": { "username": "…", "password": "…" } }`. `homematic:state` tells how the connection is doing: `ok`, `offline` or `login`. The central unit provides no history; charts show what the core has recorded since its start.

### Embedding other pages

The `web` tile embeds a page from another address:

```json
{ "type": "web", "at": [0, 0, 12, 8], "config": { "url": "https://grafana.example/d/strom?kiosk", "label": "Power", "zoom": 0.75, "refreshMinutes": 15 } }
```

Good to know:

- **Many pages forbid embedding** (headers `X-Frame-Options` or `Content-Security-Policy: frame-ancestors`) – news sites, banks, most large services. The browser then shows only a blank area. The core therefore checks, and the tile says what the cause is. Your own services can usually be reconfigured, Grafana for example with `allow_embedding = true`.
- **Over HTTPS only HTTPS:** If the display runs over a [secure connection](#secure-connection-https), the browser does not allow a page with `http://` in the tile. The tile reports this as well.
- **Sandboxed:** The page may compute and submit forms, but neither redirect the display to another address nor open windows. Without `interactive`, the tile intercepts every touch and opens the large view – so an accidental tap changes nothing.
- The core only fetches addresses that appear in a `web` tile (`GET /api/v1/embed?url=…`), never one that a caller names to it.

### Messages

"Someone is ringing the front door", "The washing machine is done": what a message does on the display is defined in `config.json` under `events` – it is triggered from outside or by a datapoint.

```json
"events": {
  "hausglocke": { "text": "Someone is ringing the front door!", "sound": "bell", "speak": true, "video": "haustuer" },
  "waschen-fertig": { "text": "The washing machine is done.", "when": { "datapoint": "openhab:Waschmaschine_An", "equals": 3 } }
}
```

| Setting | Meaning |
|---|---|
| `text` | What the board says |
| `sound` | `bell` (doorbell), `chime` (default), `beep` or `none` |
| `speak` | `true` reads the text aloud |
| `video` | Identifier of a video stream that fills the display behind the board; `videoSource` names the video source if it isn't called `video` |
| `seconds` | How long the message stays up – 10 seconds if not given, 90 with video |
| `show` | `false` makes the message a pure signal: the displays show nothing, programs on the real-time channel still receive it – `text` may then be omitted |
| `when` | Triggers the message by itself as soon as the datapoint **newly** meets the condition: `equals` (exactly this value), `above` or `below` (number) |

Every open display shows the message, whatever layout it has; tapping clears it away.

**Triggering from outside** – the one channel for everything a rule in the home automation wants to report:

```
POST /api/v1/events/hausglocke
```

A body `{ "text": "Parcel at the door" }` replaces the configured text for that one time. In an openHAB rule: `sendHttpPostRequest("http://<server>:8090/api/v1/events/hausglocke", "application/json", "{}")`; if the API is protected, the token of an access of level `control` is added as the header `Authorization: Bearer …`. `GET /api/v1/events` lists the configured messages; third-party programs listen to them via the real-time channel (`event/*`).

**Monitor on and off.** A browser cannot switch the display computer's screen. For that, [extras/monitor-windows](../extras/monitor-windows/README.md) contains a small script for Windows that switches the monitor off and on: following a switch in openHAB, a Culinola datapoint, or two messages.

### Secure connection (HTTPS)

Browsers only grant the microphone – and with it voice control – to pages loaded via `localhost` or HTTPS. If the display runs on a different computer than the core, HTTPS is therefore needed:

```json
"https": { "port": 8443, "cert": "culinola.pem", "key": "culinola-key.pem" }
```

Certificate and key are files in the data folder. The display is then additionally reachable at `https://<server>:8443`; the unsecured address remains – for the computer itself and for calls from the home automation, which usually doesn't trust a custom certificate.

For your own network, a certificate from a small certificate authority of your own is enough, for example with [mkcert](https://github.com/FiloSottile/mkcert): `mkcert -cert-file culinola.pem -key-file culinola-key.pem <servername> <ip-address> localhost`. For the browser to trust it, the root certificate (`rootCA.pem` from `mkcert -CAROOT`) is added once as trusted on every display device. The certificate authority's key stays where it is and belongs on no other device.

### Color scheme

A color scheme determines the look of the display. It is chosen in `config.json` with `"site": { "theme": "glut" }`; for trying out, the address suffix `?theme=glut` is enough – it only applies to that one display and takes precedence over the configuration.

| Scheme | Effect |
|---|---|
| `klar` (default) | Cool light with petrol; follows the device's light or dark mode |
| `glut` | Warm light: sand-colored ground, tiles with a soft shadow, orange as accent, the clock in orange |
| `schiefer` | Dark ground with light tiles – the strongest separation between tiles |
| `signal` | Cool light with a stronger ground; the clock appears as an orange surface |
| `nacht` | Dark with warm orange, the tiles separated by a fine edge |
| `leinen` | Homely light for the kitchen: oat-colored ground instead of white so nothing glares, cream tiles, terracotta and sage, a rounded font, soft corners, headings in normal case; the grey status dots of the readings are left out |
| `abend` | The night counterpart of `leinen`: warm dark brown instead of black, muted apricot |
| `spiegel` | For the display behind mirror glass: everything bright and bold on black, without tile surfaces |

**Day and night.** With a second scheme for the night, the display switches by itself: half an hour after sunset to the dark one, half an hour before sunrise back – the offset is adjustable (`nightOffsetMinutes` of the `astro` source). In the configuration `"site": { "theme": "glut", "nightTheme": "nacht" }`, for trying out on a display `?theme=glut&night=nacht`. When it is night for the display is told by the `astro` source (see [Sun and moon](#sun-and-moon)); if it is named differently, `site.astro` gives its identifier.

**A scheme of its own for one layout.** A layout can carry `"theme"` and `"nightTheme"` itself – they take precedence over `site` for every display that shows this layout. So the kitchen can look homely while the hallway keeps the common scheme: `"layouts": { "main": { "theme": "leinen", "nightTheme": "abend", "grid": …, "widgets": … } }`. The address suffixes `?theme=` and `?night=` still come first.

A scheme consists only of values – colors, rounding, spacing, shadows, font of the headings, colors of the clock and of the egg timer's surfaces – in [theme.css](packages/ui/src/theme.css); a custom one is another block there.

### Weather

The weather comes from datapoints – for example from openHAB, which gets them from a weather service or a station of your own. Each entry is the identifier of a datapoint; whatever is missing, the tile leaves out:

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

- The symbol is chosen by `code` – a weather code (`800`) or symbol identifier (`01d`) from OpenWeatherMap – and otherwise by the text in `condition`, German or English. With `sunrise` and `sunset`, the tile shows the night symbol at night.
- The wind rose shows where the wind comes from (`direction` in degrees), and in the middle the speed in km/h. If the datapoint delivers another unit without naming it, it is given in `wind.unit` (`m/s`, `mph`, `kn`).
- The UV index carries a dot in the color of its hazard level: green up to 2, yellow up to 5, orange up to 7, red up to 10, violet above.
- `days` is the forecast, starting with today. As many days are shown as fit in the width.

The weather symbols come from the Meteocons set (MIT) and are shown without its animations.

### Google account

Calendar and reminders come from a Google account. For that, the `source-google` plugin needs an access of its own at Google and a one-time sign-in with `npm run google:login`; the steps are in [docs/google-setup.md](google-setup.md). Culinola only receives read access.

```json
{ "id": "google", "plugin": "source-google", "config": { "calendars": ["primary", "Familie"], "days": 14, "leadDays": 3 } }
```

- **Appointments** come from the calendars named under `calendars` (name or identifier; `primary` is the main calendar and also the default), `days` days ahead.
- **Reminders** come from the contacts: a contact's birthday and events (name day, wedding anniversary, baptism, death anniversary, anniversary, or a custom label). They appear `leadDays` days beforehand and stay until the day after. If the year is entered, the display shows the age.
- Days that belong to no contact – a name day that applies to everyone of that name, a couple's wedding anniversary – appear as yearly recurring all-day appointments in a calendar of their own. The default is a calendar named `Erinnerungen`; `reminderCalendars` names others. The title gives kind and name ("Namenstag Andreas", i.e. name day of Andreas); if the description says `Jahr: 1959`, the display calculates the anniversary.
- An event may carry a name after its kind – "Geburtstag Rosa" (birthday of Rosa) on a contact that stands for a whole family. The day then applies to that person.
- Anyone in the contact group (the label) `Verstorben` (deceased) or with a death anniversary counts as deceased; the display then writes "would have turned …". The group's name can be changed with `deceasedGroup`.

### E-mail

The `source-mail` plugin shows the newest messages from one or more IMAP mailboxes, together in one list by arrival:

```json
{ "id": "mail", "plugin": "source-mail", "config": {
    "accounts": [
      { "id": "privat", "name": "Private", "host": "imap.example.org", "user": "ich@example.org" },
      { "id": "verein", "name": "Club", "host": "mail.example.net", "port": 143, "user": "vorstand" }
    ],
    "perAccount": 30, "refreshMinutes": 5 } }
```

The passwords go in `secrets.json` under the identifier of the source and the account: `{ "mail": { "privat": "…", "verein": "…" } }`. Login name and server may also go there instead of in `config.json` – as `"privat.user"` and `"privat.host"`. That way `config.json` contains no personal details and can be passed on. With providers that use two-factor login (Google, for example), this is an app password, not the account's password.

- The plugin only reads. It opens the mailboxes without write permission, marks nothing as read and deletes nothing; unread messages appear in bold in the list.
- Without `port`, 993 applies with encryption from the start; with another port, the connection is encrypted afterwards if the server offers it. `folder` chooses a folder other than the inbox.
- Tapping shows the message: as text or as HTML. A message that brings its text only in Rich Text Format (RTF) appears as plain text with its paragraphs. HTML runs sandboxed – without scripts, without forms and without loading anything from outside, so also without the tracking images with which senders notice the opening. Images embedded in the message itself appear. With `"remoteImages": true` in the source's settings, the display also loads images from the web; the message then looks as intended, but the sender can tell from it that it was opened. Everything else stays blocked even then.
- Culinola does not show attachments. A paperclip in the list says that there are some; the opened message names them.

### Calls

The `source-fritzbox` plugin reads the call list of a FRITZ!Box:

```json
{ "id": "fritzbox", "plugin": "source-fritzbox", "config": { "host": "fritz.box", "max": 60 } }
```

The login goes in `secrets.json`: `{ "fritzbox": { "user": "…", "password": "…" } }`. It is best to create a dedicated user for this in the FRITZ!Box under System → FRITZ!Box Users, who may only use "Voice messages, fax messages, FRITZ!App Fon and call list".

- Answered, missed, outgoing and rejected calls appear together with the answering machine's messages in one list, newest first. Names come from the FRITZ!Box phone book.
- For a caller without a name, it says where the number comes from: the place of the local network area code ("Augsburg"), for numbers from abroad place and country ("Vienna, Austria"), otherwise the kind of number ("mobile"). `country` names your own country (default `DE`), `language` the language of the names (default `de`).
- Tapping shows number, time, duration and device. If the answering machine has recorded a message, the display plays it; the recording comes from the FRITZ!Box via the core.
- With the FRITZ!Box's call monitor, the tile shows immediately when the phone rings and gives a short sound with it (can be turned off with `"sound": false` on the tile), and the list updates right after hanging up. It is switched on once at a connected phone with `#96*5*`; `"monitor": false` does without it.
- The plugin changes nothing on the FRITZ!Box.

### Egg timer

With `{ "id": "timer", "plugin": "timer" }` as a source and `"timer": "timer"` in the clock's settings, the clock becomes an egg timer: tapping opens the choice of duration. As long as the egg timer is running, it appears large in the place of the time, and the time moves to the place of the date; while it counts down, the clock stands as a yellow signal surface. When the time is up, the surface turns red, the display rings and then keeps counting with a minus sign – so you can see how long something has been over-cooking –, accompanied by a short sound every two seconds. Tapping switches it off; otherwise it ends by itself after the overrun time (`overrunSeconds` in the source's settings, default 120). Instead of counting backwards, it can also run forwards as a stopwatch.

The egg timer lives in the core, not in the display: it survives a reload and a restart, all displays show the same one, and it can also be set from outside via the actions `timer.start` (`minutes`, `seconds`), `timer.stopwatch`, `timer.add` (`seconds`) and `timer.stop`. For the remaining time to be right, the clocks of the core and the display computer must be in step – so both should get the time from the network.

How loud it rings is set by the `clock` tile, per display: `ringVolume` for the ringing (percent, default 100) and `reminderVolume` for the short sound afterwards (default 40; `0` mutes it, counting continues). The ringtone is generated by the browser itself. Browsers only play sound after the page has been tapped once; if the egg timer is only set from outside, the visible message is all there is.

### Radio and television

The `media-radio` plugin keeps the station list. Radio stations (`kind: "audio"`) need the address of their audio stream; the sound runs via the core to the display, and the current title is read out of it. `image` is the address of a logo for the media window.

Television stations (`kind: "video"`) appear in the station list without an address. Their picture is supplied by the video plugin via a stream with the same identifier.

### Video

The `media-video` plugin prepares cameras and livestreams for the browser. For that it needs the program [go2rtc](https://github.com/AlexxIT/go2rtc), which is not bundled:

```json
{ "id": "video", "plugin": "media-video", "config": {
    "go2rtc": { "binary": "tools/go2rtc/go2rtc", "ffmpeg": "/usr/bin/ffmpeg" },
    "streams": [
      { "id": "haustuer", "name": "Front door" },
      { "id": "nachrichten", "name": "News", "url": "https://example.org/live/master.m3u8" }
    ] } }
```

- With `binary`, Culinola starts go2rtc itself; without it, it must already be running.
- Addresses with credentials do not belong in `config.json` but in `secrets.json` under the stream's identifier: `{ "video": { "haustuer": "rtsp://…" } }`.
- The browser plays HLS addresses (`.m3u8`) itself. Everything else runs via go2rtc – including its own notations such as `ffmpeg:<address>#video=h264#audio=opus`. `ffmpeg` must be installed for this.
- TV stations, for example from a Tvheadend server, get `"tv": true` and the station's own address: `{ "id": "ntv", "name": "ntv", "url": "http://tvheadend:9981/stream/channelid/…?profile=pass", "tv": true }`. A browser cannot play a broadcast stream as it comes – it is interlaced and often uses formats such as MPEG-2 or AC3 – so it cannot simply be passed through. Culinola has them converted to 1024×576 at 25 frames per second, deinterlaced. At start it checks whether ffmpeg can use the graphics chip (VAAPI, Linux with `/dev/dri`) and otherwise uses the processor; the log says which. On a weak processor, HD stations may stutter without the graphics chip. TV stations reach the display as a continuous MP4 stream through the core instead of WebRTC: the browser buffers it like any other video, which evens out Tvheadend's bursty delivery, while WebRTC would drop late frames. The picture runs about a second behind; cameras stay on WebRTC without delay.
- If a camera delivers only single images instead of a video stream, Culinola detects this on the first connection attempt and shows it as an image sequence.

go2rtc's management interface listens only on its own computer; the display reaches the pictures exclusively via the core. For WebRTC transmission itself, port 8555 (TCP and UDP) must be reachable from the display computer; TV stations need only the core's port.

### News

The `source-rss` plugin reads any number of RSS and Atom feeds:

```json
{ "id": "news", "plugin": "source-rss", "config": {
    "feeds": ["dw-de", "augsburger-allgemeine", { "id": "verein", "name": "Sports club", "url": "https://example.org/feed" }],
    "refreshMinutes": 10 } }
```

A feed is either an identifier from the bundled catalog ([catalog.json](plugins/source-rss/src/catalog.json), also available at `/api/v1/resources/<instance>/catalog`) or an entry of your own with `id`, `name` and `url`.

The tile always shows one item – headline, teaser and the image that the provider supplies in the feed – and moves on to the next after `seconds` seconds (default 20), in turn through the feeds. Tapping opens the article over the display: embedded if the provider allows embedding of its pages, otherwise in a browser window of its own the size of the screen. Whether it allows this, the core checks once a day. Closing leads back to the display; after `closeAfter` seconds (default 600, `0` turns this off) Culinola closes the article by itself. For the window of its own, the browser must allow pop-ups for this page.

### Recipes

The `recipes` plugin shows Markdown files from a folder. Without the `folder` setting, this is the instance's folder in the data folder, so for `{ "id": "recipes", "plugin": "recipes" }` it is `data/recipes`. Subfolders are read as well and serve as categories; changes in the folder appear without a restart.

A recipe is ordinary Markdown, optionally with details at the beginning – an example is in [plugins/recipes/examples](plugins/recipes/examples/pfannkuchen.md):

```markdown
---
title: Pancakes
category: Quick cooking
tags: [vegetarian, basic recipe]
time: 25 min
servings: 4
---

## Ingredients
…
```

All details are optional; German field names (`Titel`, `Kategorie`, `Stichworte`, `Zeit`, `Portionen`) apply as well. A recipe's origin – `source: Family recipe` in the details or a line `Quelle: [Instagram](https://…)` in the text – appears small under the title in the recipe list. If the title is missing, the first heading applies, otherwise the file name. Images sit next to the recipe and are embedded as usual: `![Cake](bilder/kuchen.jpg)`. The first image – or the one named under `image` in the details – is the recipe's image on the tile. Every `seconds` seconds (default 30) the tile shows a different, randomly chosen recipe with image. Embedded HTML is not executed but shown as text.

The list has a search field that filters while you type – by title, category, tags and origin, within the chosen category. Every word must occur; umlauts may be typed, written out (`kaese`) or left off.

In the reading view, the text can be enlarged in steps; as long as a recipe is open, the display keeps the screen awake as far as the browser permits (secure connection or `localhost`). The image from the details sits next to the text there. "Cooking this" holds on to a recipe: it stays on the tile instead of disappearing in the rotation, and a tap opens it again – until "Done cooking" is pressed or six hours are up. The note lives in the core (datapoint `recipes:cooking`, actions `recipes.cook` and `recipes.finish`), so it applies to all displays and survives a reload.

#### Ingredients to the shopping list

Where a shopping list is set up (see [Merkio](#shopping-and-task-lists-from-merkio)), the reading view has "Shopping": the ingredients appear to be selected and deselected, − and + convert to a different amount ("6 servings" instead of 4, "2 trays" instead of 1), and "Add to the list" enters them with quantity and unit. What is already open on the list stays there once. The tables under the heading "Ingredients" are read – as the import tool writes them; identical ingredients from several sections are combined. By voice the same works for all ingredients: "Put the ingredients for the pancakes on the shopping list" (action `recipes.shop` with `recipe` and `amount`; without `recipe`, the recipe currently being cooked). With `"shoppingList": "Einkaufen"` on the `recipes` source, it goes to a specific list, otherwise to the first one shown.

#### Adding new recipes

This applies when the recipes come from the folder. From a web page, a document (PDF, Word, LibreOffice, text) or a photo – for example a photographed cookbook page – Culinola makes a recipe in its own format and puts it, together with a photo of the dish, into the recipe folder as `<category>/<title>.md`. Reading and organizing is done by a language model from Anthropic (Claude Haiku); the work behind it is in the [recipe-import](packages/recipe-import/README.md) package.

For this a Claude API key (<https://platform.claude.com>) is needed, entered in `secrets.json` under the identifier of the recipe instance:

```json
{ "recipes": { "anthropicApiKey": "sk-ant-…" } }
```

In the Docker image, the environment variable `ANTHROPIC_API_KEY` works instead. After a restart there are two ways:

- **In the display:** "+ Recipe" appears in the recipe list. Enter a web address there, choose a file or photo, or paste the text. Because the display is an ordinary web page, this works from any device in the house – most conveniently from the phone, which photographs the cookbook page right away, or from the computer where the file is. The browser shrinks large photos before uploading.
- **For whole folders:** `npm run recipes:import -- <folder or address …> --recipes data/recipes` converts everything at once; an image named like the source (`Apfelkuchen.pdf` and `Apfelkuchen.jpg`) becomes the recipe's photo. Nothing in the recipe folder is overwritten and nothing is deleted.

Without a key the button is missing; everything else runs as usual. If the API is protected by accesses, adding requires level `control`.

Good to know: The source is transmitted to Anthropic for conversion, and each conversion costs a small amount by usage – the core writes the number of tokens to the log. Web addresses in your own network are not read. The result comes from a language model: compare quantities and times with the source before the first cooking. With `importModel` and `importLanguage` (`de`, `en`, `fr`) in the plugin's configuration, the model and the language of the new recipes can be changed.

#### Recipes from Merkio

Instead of the folder, the recipes can come from a recipe list in [Merkio](#shopping-and-task-lists-from-merkio). The `origin` setting chooses one of the two: `folder` (the default) or `merkio`. With `merkio`, the recipes are maintained in Merkio only. Culinola shows them, searches them, puts their ingredients on the shopping list and holds on to the one being cooked. Adding new recipes is not offered there, and the `folder` setting does not apply. Recipes already in the old folder stay on disk, but they are no longer shown. To show them again, switch back to `folder`.

```json
{ "id": "merkio", "plugin": "source-merkio", "config": { "lists": ["Einkauf"], "recipes": "Rezepte" } },
{ "id": "recipes", "plugin": "recipes", "config": { "origin": "merkio" } }
```

`recipes` on the Merkio source names the recipe list, the same way as `lists` (also as `Rezepte (Familie)` or `{ "name": …, "group": … }`). The Merkio source keeps a copy of every recipe in `data/merkio/rezepte`: the file Merkio exports for Culinola and the photo next to it. It fetches only what has changed. A change made on the phone arrives through the real-time channel within seconds, and everything is also compared again every `refreshMinutes`. A recipe deleted in Merkio disappears from Culinola. While Merkio cannot be reached, the copy stays as it was. If the Merkio source has another identifier than `merkio`, name it with `"merkio": "<id>"` on the `recipes` source.

### Sun and moon

The `source-astro` plugin calculates sunrise and sunset, twilight, the sun's position and the moon phase for your own location – in the core, without an outside service:

```json
{ "id": "astro", "plugin": "source-astro", "config": { "latitude": 48.37, "longitude": 10.9, "nightOffsetMinutes": 30 } }
```

The `sun-moon` tile draws the course of the day from it. `nightOffsetMinutes` (default 30) determines how long after sunset the night scheme begins and how long before sunrise it ends; `0` follows the sun exactly, a negative value pulls the change into the daytime. The datapoints include `astro:day` (whether the sun is above the horizon), `astro:night` (night for the display, with the configured offset – the switch to the night scheme depends on this), `astro:sunrise` and `astro:sunset`, `astro:dayLength`, `astro:sunAltitude`, `astro:moonPhase` and `astro:moonIllumination`. They can be shown in tiles like any other value or used for messages.

### Solar forecast

The `source-solar-forecast` plugin fetches from [forecast.solar](https://forecast.solar) the expected output of the solar installation for today and tomorrow – independent of the smart-home system, calculated from the installation's location, tilt, orientation and capacity:

```json
{ "id": "prognose", "plugin": "source-solar-forecast", "config": {
    "latitude": 48.37, "longitude": 10.9, "declination": 30, "azimuth": 0, "kwp": 9.8 } }
```

- `declination` is the modules' tilt (0 lies flat, 90 stands upright), `azimuth` the orientation as the service counts it: **0 is south**, -90 east, 90 west, 180 north – not the compass direction.
- In the power chart, this becomes a dashed line: `{ "datapoint": "prognose:power", "label": "Forecast", "forecast": true }` in `series`. The datapoints are `prognose:power` (expected output now), `prognose:today` and `prognose:tomorrow` (expected yield in kWh).
- It is queried every `refreshMinutes` minutes (default 180, at least 15); the last forecast is kept in `data/prognose/forecast.json` and survives a restart.

forecast.solar offers this access without sign-up and without a key ("Public", permanently free according to the provider): one installation, today and tomorrow, hourly values, at most twelve queries per hour and connection. Anyone who needs more books a plan there and enters their key in `secrets.json`: `{ "prognose": { "apiKey": "…" } }`. The installation's location is transmitted to the service with every query.

### Shopping and task lists from Merkio

Culinola keeps no lists itself. The `source-merkio` plugin shows the lists from [Merkio](https://merkio.de), ticks items off there and adds items there – maintenance carries on at the phone, and via Merkio's real-time channel both sides see the same state immediately.

```json
{ "id": "merkio", "plugin": "source-merkio", "config": { "lists": ["Einkauf"] } }
```

It is best to give the display a Merkio account of its own that is a member of the family group. Its credentials go in `secrets.json`:

```json
{ "merkio": { "email": "kueche@example.org", "password": "…" } }
```

`lists` names the lists that are shown – by their name, or for lists of the same name in several groups with the group in brackets, `Einkauf (Familie)`, or as `{ "name": "Einkauf", "group": "Familie" }`. Without the group, the first list of that name applies, and the log says which groups have one. Without `lists`, all shopping lists of the account are used. Which lists exist is written to the log by the core at start if a named one is missing, and is available at `/api/v1/resources/merkio/available`. Each list gets an identifier from its name (`Einkauf` → `einkauf`); the `checklist` tile chooses its list with `list`.

Tapping ticks an entry off; ticked-off items stay struck through for a few hours so that the tick can be taken back. "+" opens an input field: "2 kg Mehl" is split into quantity, unit and name, and whatever is already on the list ticked off becomes open again instead of doubled. The same works via the actions `lists.add` (`text`, `list`; quantity and unit optionally separately as `quantity` and `unit`) and `lists.check` (`item`, `checked`).

With `"recipes": "Rezepte"`, the plugin also brings the recipes of a recipe list over to the recipe view. They come in one direction only and are maintained in Merkio (see [Recipes from Merkio](#recipes-from-merkio)).

The plugin signs in with account and password, remembers Merkio's renewal token in `data/merkio/token.json` and signs in again by itself when it has expired. The datapoint `merkio:state` tells how things stand: `ok`, `nogroup` (signed in, but the account is not yet in any group – join in Merkio and have it confirmed), `login` (credentials missing or rejected) or `offline`. With `url`, your own Merkio installation can be addressed, with `refreshMinutes` (default 5) the interval at which everything is re-read in addition to the real-time channel. Merkio's hosting ends every connection after a quarter of an hour; the plugin reopens the real-time channel right away and catches up on what happened in between. The log mentions this only when the channel breaks off early or cannot be reopened.

### Voice control

"Egg timer for eight minutes", "Put milk and butter on the shopping list", "Play Bayern 2", "I'm cooking the apple cake": the `voice` tile takes a spoken sentence, the `voice` plugin carries it out.

```json
{ "id": "voice", "plugin": "voice" }
```

This is how it works: tapping starts the browser's speech recognition; the display sends the recognized sentence to the core. There a language model from Anthropic (Claude Haiku) maps it to the **actions** that the other plugins have registered (`GET /api/v1/actions`), triggers them and replies in one sentence, which the display shows and reads aloud. Every new action is thereby also reachable by voice automatically; whatever is registered as sensitive (`sensitive`) is excluded.

**Asking for values.** "How warm is it outside?", "How much power is the PV making?", "Is Uli at home?", "When does the sun set?": you can ask about everything shown on the displays – the values are called what the tiles label them. The language model is only told the names for this; it receives a value's state only when a question needs it. Further values or other names are given by the source:

```json
{ "id": "voice", "plugin": "voice", "config": { "values": [{ "datapoint": "openhab:Mess_TKeller", "name": "Basement" }, "astro:sunset"] } }
```

With `"layoutValues": false`, only this list applies. The answer gives times in the local time of the computer on which the core runs – in a container, so set `TZ`.

Requirements:

- **Claude API key** in `secrets.json`: `{ "voice": { "anthropicApiKey": "sk-ant-…" } }` – the same as for adding recipes; alternatively the environment variable `ANTHROPIC_API_KEY`.
- **A browser with speech recognition** – Chrome or Edge – and a microphone on the display computer. The browser asks once for permission to use the microphone. It grants it only to pages with a secure connection or `localhost`: if the display runs on a different computer than the core, HTTPS is needed in front.
- Where there is no speech recognition, the sentence can be typed into the same field (⌨ button).

#### Wake word

With `"wakeWord": "computer"` in the tile's configuration, the display listens continuously and carries out what is said after the word – "Computer, put milk on the shopping list". If only the word is said, a sound answers, and the next sentence is the one meant. If the display has not understood something or asks a question, it keeps listening right after its answer: repeating or answering then works without the word.

- **The listening happens on the device.** A small speech model ([Vosk](https://alphacephei.com/vosk/), via `vosk-browser`, both Apache-2.0) runs in the display's browser and converts what it hears into text; the microphone signal does not leave the computer. Only the sentence after the wake word goes – as text – to the core and from there to Anthropic for mapping. This route needs no speech recognition from the browser and therefore also works where there is none.
- **The model is not bundled** (around 45 MB per language). Download a small model from <https://alphacephei.com/vosk/models> – for German `vosk-model-small-de-0.15` –, rename the unpacked folder to `model`, pack it as `model.tar.gz` (`tar -czf model.tar.gz model`) and put it in the instance's folder: `data/voice/model.tar.gz`. After a restart, the datapoint `voice:model` reports that it is there.
- **The word** must be an ordinary word that the model knows – "computer" or "hallo küche", not an invented name. Umlauts may be written out (`hallo kueche`). Similar-sounding words do not trigger; if the word comes up on the radio or in conversation, though, the display does take notice.
- **Requirements:** a microphone, the one-time permission in the browser and a secure connection (HTTPS or `localhost`). If any of these is missing, "no microphone" appears under the button; a tap on it tries again. The browser indicates that the microphone is open.
- **Computing load:** The model computes continuously. On an ordinary PC that is about a third of a processor core; try it first on a small computer.

Good to know: On tapping, the recording goes to Google in Chrome for recognition, the recognized sentence to Anthropic for mapping; each sentence costs a fraction of a cent. What goes into the core's log is what was triggered – not what was said. The tile only listens after being tapped, not continuously. If the radio is playing at the time, the microphone hears it too; turning it down helps. `model` and `language` (`de`, `en`, `fr`) in the plugin's configuration change the model and the language of the answers.

## API

The interface uses the same API as any other program. All paths begin with `/api/v1`.

| Call | Purpose |
|---|---|
| `GET /status` | State of the sources |
| `GET /events`, `POST /events/{name}` | Configured messages; trigger a message, body `{ "text": … }` optional |
| `GET /datapoints`, `GET /datapoints/{id}` | Current values |
| `POST /datapoints/{id}/command` | Set a writable datapoint, body `{ "value": … }` |
| `GET /series?ids=&from=&to=&step=&agg=` | History, aggregated if wanted |
| `GET /actions` | Directory of actions |
| `POST /actions/{name}` | Trigger an action, parameters in the body – e.g. `switch.set` with `{ "datapoint": "…", "on": true }` |
| `GET /layouts`, `GET /layouts/{id}` | List of layouts; a layout with its revision `rev` |
| `PUT /layouts/{id}` | Save a layout (level `admin`), body `{ "layout": { … }, "rev": "…" }`. `rev` is the revision on which the change builds; if someone else has saved in the meantime, the core answers with 409. `"force": true` instead of `rev` overwrites |
| `POST /layouts` | Create a layout (level `admin`), body `{ "id": "flur" }` for an empty one; plus `"copy": "main"`, `"template": "kueche"` or `"layout": { … }` |
| `POST /layouts/{id}/rename`, `DELETE /layouts/{id}` | Rename (body `{ "id": "neu" }`) and delete (level `admin`); the last layout stays |
| `GET /templates` | Bundled templates for new layouts |
| `GET /sources`, `GET /plugins` | Configured sources with settings and state – of the credentials only the names of those stored; installed plugins with the description of their settings (level `admin`) |
| `POST /sources`, `PUT /sources/{id}` | Create a source (`{ "id", "plugin", "config", "secrets" }`) or change it (`{ "config", "secrets" }`); it restarts with this. In `secrets`, a text sets the entry, `null` removes it, what is missing stays (level `admin`) |
| `POST /sources/{id}/restart`, `DELETE /sources/{id}` | Restart a source; stop it and remove it together with its credentials (level `admin`) |
| `GET /settings` | Display, messages and accesses for setting up – of the accesses only name and level (level `admin`) |
| `PUT /settings/site`, `PUT /settings/events` | Replace the display's settings or all messages; takes effect immediately (level `admin`) |
| `POST /settings/access`, `PUT /settings/access/{name}`, `DELETE /settings/access/{name}` | Create an access (`{ "name", "role" }` – the response names the token, this one time only), change the level, remove (level `admin`) |
| `GET /access` | Name and level of the presented access; a sign-in with the setup password appears as `kennwort` with level `admin` |
| `GET /setup` | What a page without access needs to know: `{ "protected", "password", "pairing" }` (no access needed) |
| `POST /login` | Sign in with the setup password, body `{ "password" }`; the response is `{ "token", "expires" }`, valid for 30 days and presented like any token (no access needed; after five wrong attempts the core answers with 429 and `Retry-After`) |
| `PUT /settings/password`, `DELETE /settings/password` | Set or change the setup password (`{ "password" }`, at least 8 characters; all earlier sign-ins end, the response is a new one) and remove it (level `admin`) |
| `POST /reset`, `POST /reset/password` | Forgotten password: have a setup code written into the data folder; set a new password with it, body `{ "code", "password" }` (no access needed) |
| `POST /pairing`, `POST /pairing/{id}` | A display asks for access (`{ "label" }` → `{ "id", "code", "secret", "expires" }`) and asks how its request is doing (`{ "secret" }` → `waiting`, `approved` with its token – once –, `rejected` or `expired`) (no access needed) |
| `GET /settings/pairing`, `POST /settings/pairing/{id}`, `DELETE /settings/pairing/{id}` | Waiting requests with code, label and address; allow one (`{ "name", "role" }` – creates the access entry, the token goes to the display only) or reject it (level `admin`) |
| `GET /embed?url=` | Whether a page from a `web` tile allows embedding |
| WebSocket `/stream` | Changes in real time; subscribe with `{ "op": "sub", "topics": ["dp/*"] }`. `layout/{id}` reports that a layout was changed; `site` reaches every display when language or color scheme were changed |

### Access protection

Without setup, Culinola is open: anyone on the network can read, switch and set up. The core points this out at start. Protection is set up in the browser under `?edit=settings` → **Access protection** – the same way whether Culinola runs on a PC, a NAS or a Raspberry Pi. There are three ways in, depending on who or what needs access:

| Who | Way in | How |
|---|---|---|
| You, when setting up | **Setup password** | Sign in on the setup pages; the sign-in lasts 30 days in that browser |
| A display | **Pairing** | The display shows a code; you confirm it in the settings |
| A program without a screen | **Token** | Created in the settings, sent as `Authorization: Bearer …` |

**Setup password.** Set it under "Setup password" (at least 8 characters). From that moment the API is protected: the setup pages (`?edit`, `?edit=sources`, `?edit=settings`) ask for the password, and every display needs an access. The browser in which you set the password stays signed in. The sign-in applies to the setup pages only – a display remains what it was paired as, so a kitchen display does not become able to set up because someone once signed in on it. "Sign out" on the settings page ends the sign-in in that browser; changing the password ends it everywhere. The core stores only a check value of the password in `secrets.json` (section `setup`), never the password itself, and slows down guessing: after five wrong attempts from one address it makes that address wait, longer each time.

**Pairing a display.** Open Culinola on the display as usual, for example `http://<server>:8090/?layout=flur`. Without access it shows a six-digit code and the address of the settings. On a PC or tablet, open the settings: the request appears under "Pair devices" with its code, the browser and layout it comes from, and its address on the network. Compare the code with the one on the display, give the access a name (one per device: `kueche`, `flur`) and a level, and choose "Allow". The display picks up its token within a few seconds and starts; the token is never shown and nobody has to type it. "Reject" turns a request down. A code is valid for ten minutes; a display that is still waiting then shows a new one by itself, so it can also be paired hours later.

**Tokens for programs.** Under "Access entries and tokens", create an entry with a name and a level. The core generates the token and shows it exactly once; afterwards it only exists in `secrets.json`. Programs send it in the header `Authorization: Bearer …` – in an openHAB rule, for instance, to raise a message. A display can also be unlocked with a token instead of pairing: open its address once with `#token=…` at the end; it remembers the access and removes the token from the address bar again.

| Level | May |
|---|---|
| `read` | read – for a display nobody should switch from |
| `control` | read, switch, trigger actions and messages – for ordinary displays and for programs |
| `admin` | additionally set up |

Viewing a camera image counts as reading: even a display with level `read` shows cameras and television. With a setup password, no access entry needs the level `admin`. Without one, the first access entry must have it, and one such entry always remains – otherwise nobody could set up any more. For the same reason the password cannot be removed while there are access entries but none with `admin`.

**Forgot the password?** On the sign-in page, choose "Forgot the password?" → "Request setup code". The core writes the code into its data folder as `einrichtungscode.txt` and into its log. The data folder is the one that contains `config.json`: on a PC the `data` folder of the installation, with Docker the folder handed to the container as `/data` (on a NAS you reach it through the file manager; the log is shown by the container manager or `docker logs`). Enter the code and a new password on the sign-in page. The code is valid for 15 minutes and works once; the file disappears afterwards. Access entries of displays and programs stay as they are. Requesting a code reveals nothing and changes nothing – only someone who can read the files or the log of the installation gets back in. The same works for an installation that has access entries but no password yet and whose `admin` token is not at hand.

**Opening it again.** Remove the access entries and then the password in the settings; Culinola is then open as at the beginning.

#### By hand

Access entries can also be written into the files; this takes effect after a restart.

1. Generate a token for each access:

   ```bash
   npm run token
   ```

2. In `data/config.json`, name the accesses with their level:

   ```json
   "access": { "tokens": [{ "name": "kueche", "role": "control" }, { "name": "flur", "role": "read" }] }
   ```

3. In `data/secrets.json`, enter the matching tokens:

   ```json
   "api": { "kueche": "…", "flur": "…" }
   ```

The setup password cannot be written by hand, because only its check value is stored; set it in the settings or with a setup code. Deleting the section `setup` from `secrets.json` and restarting removes it. Because of these two sections, `api` and `setup` cannot be used as the identifier of a source.

The protection regulates who may do something. It encrypts nothing – outside your own home network, HTTPS belongs in front.

## Developing

```bash
npm run check
```

`npm run check` checks types, runs the tests and verifies the licenses of the shipped dependencies.

How testing is done – automatically, on the test instance (`npm run test:instance`) and with your own devices – is described in [docs/testing.md](testing.md).

When working on the interface, it runs with `npm run dev:ui` on its own port and reloads changes immediately; the core must be running alongside with `npm start`.

## License

PolyForm Noncommercial License 1.0.0, see [LICENSE](../LICENSE): free for non-commercial purposes; commercial use requires a separate license. Notes on contributing are in [CONTRIBUTING.md](CONTRIBUTING.md).
