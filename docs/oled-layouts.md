# OLED layout packs

A pack is an extension with no code: a settings file Nexus Studio reads. This kind offers **layouts for the keyboard's OLED status page**. They show up on the OLED page under
"From your extensions". Choosing one puts it into the page's editor like any other edit; a pack never changes anything by itself. It works exactly like
[lighting preset packs](lighting-presets.md), with a different `kind` and a `layout` instead of a `lighting`.

## The file

`pack.json` (the manifest's `entry`), next to a `nexus-plugin.json` with `"type": "pack"` and `"nexusApi": "^1.18"` (the first API that offers layouts):

```json
{
  "schemaVersion": 1,
  "kind": "oled-layouts",
  "presets": [
    {
      "id": "minimal",
      "name": "Layer and fader",
      "layout": { "widgets": [
        { "kind": 1, "row": 0, "col": 0, "scale": 1, "param": 0, "text": "LAYER " },
        { "kind": 3, "row": 1, "col": 0, "scale": 1, "param": 0, "text": "FADER " }
      ] }
    }
  ]
}
```

| Field | Rule |
|---|---|
| `kind` | exactly `oled-layouts`. |
| `presets` | a list, at most 50 (a longer list is cut and the cut is reported). |
| `id`, `name` | as for lighting presets: `id` is lower-case letters, digits and dashes, unique in the pack; `name` is 1 to 40 characters. |
| `layout` | the same object the OLED page stores: `{"widgets": [...]}`. Each widget has `kind` (0 text, 1 layer number, 2 layer name, 3 fader, 4 module slot, 5 firmware build, 6 icon), `row`, `col`, `scale` (1 normal or 2 double), `param` and `text`. An empty list `{"widgets": []}` is a real layout: it blanks the page. |

Every `layout` goes through **the same checks as one made on the OLED page, for the firmware the keyboard is running now** (how wide a value may be depends on the build). A
layout that fails is left out and listed for the person, with the reason ("Widget 1 (Layer number): its size is 3; use 1 (normal) or 2 (double)"); the pack's other layouts
still work. So a layout can be offered with one keyboard and left out with an older one. Nothing is sent to the keyboard: the OLED reaches the keyboard only through the app's
own flash step, which is switched off until it has been tested on a real keyboard.

## Make and try one

```
node catalogue/pack.mjs examples/screen-layouts screen-layouts.nexusext
```

Add the file on Nexus Studio's Extensions page (a sideloaded pack runs on the beta channel; the stable channel only runs reviewed ones), then open Modules, OLED. The three
layouts in `examples/screen-layouts` were checked with the app's own validator; a pack with the same file shape was installed and used this way against a real core.
