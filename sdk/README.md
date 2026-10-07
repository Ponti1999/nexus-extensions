# nexus-extension-sdk

A small TypeScript client for Nexus Studio's local API, for extensions that run code.

Needs **Node 22 or newer** (it uses the built-in `WebSocket`). No runtime dependencies.

```ts
import { connect } from 'nexus-extension-sdk';

const nexus = await connect();

// Signals the keyboard publishes (needs the signals.read permission)
await nexus.subscribe(['system.layer'], (signal) => console.log('layer is now', signal.value));

// Your own settings (stored under your extension's prefix; any other key is refused)
await nexus.settings.set('mode', 'party');

// Stay alive until Nexus Studio stops or turns off the extension
await nexus.closed;
```

## How an extension runs

Nexus Studio starts the extension itself, with its own token and the API address in the environment (`NEXUS_API_URL`, `NEXUS_API_TOKEN`,
`NEXUS_API_VERSION`, `NEXUS_EXTENSION_ID`, `NEXUS_EXTENSION_PREFIX`). `connect()` reads them, so it only works inside a run the app started: run by hand it
rejects with code `not_started_by_app`. The token is valid for one run.

When the app stops or turns the extension off, the connection closes. `nexus.closed` resolves, and that is the cue to exit. If the extension crashes, the app
restarts it (a few times, then it leaves it off until the person turns it on again), so the SDK does not reconnect.

## What you can do

- `nexus.call(method, params?)`: one API request. Rejects with a `NexusError` whose `code` is the API's own (`forbidden`, `invalid_params`, `unavailable`, ...).
  What a call may do depends on the permissions in the extension's manifest: the app gives the token only those scopes.
- `nexus.subscribe(patterns, handler)`: signals matching the patterns (`fader.*`). A slow handler sees the latest value of each source, not every sample.
- `nexus.on(event, handler)`: other events (`device`, `context`, `settings`, `action`, `profiles`).
- `nexus.settings.get(name)` / `.set(name, value)`: your own settings.
- `bytesOf(value)`: turns a binary signal value (`{"$bytes": "<hex>"}`) into bytes.
- `nexus.welcome`: the role, scopes, methods and events the app granted this connection.

## What you cannot do, on purpose

The API has no way to send raw reports to the keyboard, write its memory or flash it, so an extension can't either. An extension runs as the person's own
Windows user and is **not sandboxed**: the app shows its permissions before install, and the stable channel only runs reviewed extensions.

## Try it: an example you can copy

`examples/hello-plugin` is the smallest extension that runs code. It was run for real by Nexus Studio's plugin host: installed from its `.nexusext` and started with its own
token, it connected, used the permissions its manifest asked for, saved a setting, and left cleanly when it was turned off.

```
cd sdk && npm install && npm run build        once
node examples/hello-plugin/build.mjs          copies the built SDK in beside main.mjs and packs hello-plugin.nexusext
```

Add the file in Nexus Studio's Extensions page (a sideloaded extension runs on the beta channel; the stable channel only runs reviewed ones). An extension carries its own
files, including the SDK: the app does not install packages for it. `node catalogue/pack.mjs <folder>` packs any folder that has a `nexus-plugin.json`.

## Develop

```
npm install
npm test        # builds, then runs the tests against a stand-in for the app's API
```
