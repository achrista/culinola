# Architecture

Culinola has three parts: a **core** that runs on a small server in the house, **plugins** that connect it to everything else, and an **interface** that runs in the browser of each display.

```
 displays (browser)            core (Node.js)                 your house
┌──────────────────┐   HTTP   ┌─────────────────────────┐   ┌──────────────────┐
│ tiles in a grid  │ ───────▶ │ API  /api/v1            │   │ openHAB          │
│ layout editor    │          │ datapoint registry      │   │ Home Assistant   │
│ sources, settings│ ◀─────── │ actions · messages      │◀─▶│ Homematic · MQTT │
└──────────────────┘ WebSocket│ layouts · access        │   │ FRITZ!Box · mail │
                              │ plugin host ── plugins ─┼──▶│ cameras · feeds  │
                              └─────────────────────────┘   └──────────────────┘
                                 data/config.json, secrets.json
```

## Principles

- **Core and plugins.** The core only provides infrastructure. Everything that knows about a particular system or topic is a plugin.
- **Capabilities, not systems.** A tile is bound to a datapoint, not to a smart-home product. Replace openHAB by Home Assistant and the tile stays the same.
- **One API for everything.** The interface uses the same HTTP and WebSocket API as any other program. Nothing the interface can do is private.
- **Raw values out, formatting in the display.** The core delivers value and unit; language, number format and theme belong to the display.
- **Only permissively licensed dependencies**, checked on every build – so that Culinola itself stays free to license.

## Packages

| Folder | Contents |
|---|---|
| `packages/core` | The core: HTTP and WebSocket server, datapoint registry, plugin host, actions, messages, access control, and the stores that write configuration |
| `packages/sdk` | The contract between core and plugins, and what core and interface must compute alike (the layout grid) |
| `packages/ui` | The interface (Vue): tiles, layout editor, sources and settings pages |
| `packages/recipe-import` | Turns text, photos, documents and web pages into recipe files |
| `plugins/*` | One folder per plugin |
| `templates/` | Layout templates offered when creating a layout |
| `testing/` | A test instance with made-up values and stand-ins for external systems |

## Datapoints

The smallest common unit is the **datapoint**: an id with the prefix of its source (`openhab:Temp_Living`), a value, an optional unit and label, a timestamp and a quality. Plugins publish datapoints into the registry; displays subscribe over the WebSocket to exactly the datapoints their layout shows and receive the current state followed by every change. Writable datapoints accept commands, which the core routes to the plugin that owns the prefix.

The registry keeps a short in-memory history of numeric values for trend lines; a plugin may provide real history from its system instead.

## Plugins

A plugin is a package `@culinola/plugin-<name>` that exports a definition: an id, a function that validates its settings, and a `start` function. On start it receives a context with everything it may use: its settings and secrets, a logger, a storage folder, and functions to publish datapoints, register actions, expose lists (`resources`) and add HTTP routes under `/api/v1/p/<instance>/`. A plugin imports nothing but the SDK.

A plugin also describes itself for the interface – name, help text, and its settings and credentials as form fields – so that a third-party plugin brings its own setup form.

Each configured **source** is one running instance of a plugin with its own stop signal. The core records what an instance registered and removes exactly that when the instance stops, so a single source can be reconfigured and restarted while everything else keeps running.

## Actions and messages

An **action** is something that can be triggered – by a tap, the API, a spoken sentence: `switch.set`, `timer.start`, `radio.play`. Plugins register actions with a description and typed parameters; the core validates calls.

A **message** is what appears on every display ("Someone is at the door"), with sound, speech and optionally a camera. Messages are raised through the API or by a datapoint newly meeting a condition.

## Configuration

Everything of the user's lives in one data folder: `config.json` (sources, layouts, display settings, messages, access entries) and `secrets.json` (credentials and tokens). Both can be edited by hand or through the interface. When the core writes them it first keeps a timestamped backup and then replaces the file atomically. Secrets are accepted by the API but never returned.

Layouts carry a revision derived from their content. Saving a layout names the revision it was based on; if someone else saved in between, the core refuses instead of overwriting.

## Access

Without a setup password and without access entries the API is open. Otherwise every call presents a token with one of three levels: `read`, `control` (also switch and trigger) and `admin` (also set up). Tokens come from three places, one for each kind of caller:

- **People** sign in with the setup password. The core keeps only a scrypt check value and a signing key in `secrets.json`; a sign-in is a signed token with an expiry date that the core verifies without keeping a list. Changing the password replaces the key and thereby ends every sign-in. The interface presents it only on the setup pages, so signing in on a display does not raise what that display may do.
- **Displays** are paired. A display without access asks the core for a pairing request and shows its short code; it keeps a secret that never appears anywhere else. Someone who may set up confirms the code and chooses name and level; the core creates the access entry and hands the token to whoever presents the secret – once. Requests live in memory only and expire after ten minutes.
- **Programs** get an access entry whose token is shown once when it is created.

A forgotten password is replaced through the data folder: on request the core writes a short-lived code into a file there. Reading it proves what a browser alone cannot – that the caller can reach the files of the installation. That keeps the whole setup in the browser without a command-line step, whatever the installation runs on.

The few calls needed before any access exists – the display settings, signing in, pairing, requesting and redeeming a setup code – are marked as public on their route; everything else is checked against the level it requires.

## Interface

A display loads its layout – a grid with fixed columns and rows that fills the screen – and renders one component per tile. Tiles size their content from their own dimensions, so the same layout works on any screen. The setup pages are loaded only when requested through the address (`?edit`), so a kitchen display never carries them and nobody changes the setup by accident.
