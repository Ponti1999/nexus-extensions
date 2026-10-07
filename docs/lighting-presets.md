# Lighting preset packs

A pack is an extension with no code: a settings file Nexus Studio reads. The first kind it reads offers **lighting presets**: ready-made looks that show up on the Lighting
page under "From your extensions". Choosing one puts its look into the page's editor like any other edit; a pack never changes anything by itself.

## The file

`pack.json` (the manifest's `entry`), next to a `nexus-plugin.json` with `"type": "pack"` and `"nexusApi": "^1.17"` (the first API that offers presets):

```json
{
  "schemaVersion": 1,
  "kind": "lighting-presets",
  "presets": [
    { "id": "sunset", "name": "Sunset", "lighting": { "mode": "solid", "colour": "#ff8a3d", "brightness": 70, "speed": 50 } }
  ]
}
```

| Field | Rule |
|---|---|
| `kind` | exactly `lighting-presets`. A pack of another kind is not read as this one. |
| `presets` | a list, at most 50. A longer list is cut and the cut is reported to the person. |
| `id` | lower-case letters, digits and dashes (`warm-white`), at most 40 characters, unique in the pack. |
| `name` | 1 to 40 characters. What the person sees. |
| `lighting` | the same object the Lighting page stores: `mode` (an effect id), `colour` (`#rrggbb`), `brightness` (0 to 100), `speed`, and for the `per_key` mode a `perkey` map of key references to colours. |

Every `lighting` goes through **the same checks as one typed into the Lighting page**. A preset that fails is left out and listed for the person, with the reason, under "looks
from extensions were left out": the pack's other presets still work. Nothing here is sent to the keyboard: lighting reaches the keyboard only through the app's own flash step,
which is switched off until it has been tested on a real keyboard.

## Make and try one

```
node catalogue/pack.mjs examples/sunset-lights sunset-lights.nexusext
```

Add the file on Nexus Studio's Extensions page (a sideloaded pack runs on the beta channel; the stable channel only runs reviewed ones), then open Lighting. The pack in
`examples/sunset-lights` is a small one to copy. A pack like it (the same file shape) was installed and used this way against a real core.
