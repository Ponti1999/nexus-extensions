# The catalogue: `index.json`

The list of extensions Nexus Studio's Store offers. It is a plain JSON file in this repo. Nothing runs on a server.

## What is in it

```json
{
  "schemaVersion": 1,
  "extensions": [
    {
      "id": "com.example.night-pack",
      "repo": "https://github.com/someone/night-pack",
      "name": "Night pack",
      "author": "Someone",
      "description": "Dark lighting presets.",
      "versions": [
        {
          "version": "1.0.0",
          "nexusApi": "^1.2",
          "type": "pack",
          "permissions": [],
          "url": "https://github.com/someone/night-pack/releases/download/v1.0.0/night-pack.nexusext",
          "sha256": "<64 lower-case hex characters>",
          "size": 12345
        }
      ]
    }
  ]
}
```

An entry is an **id**, the author's **repo**, the card the Store shows (**name**, **author**, **description**) and every **version** that has been approved.
The Store has to draw its card before anything is downloaded, so the card is here, but it is **copied from the manifest and checked against it**: the check
downloads the zip and refuses an entry whose name, author, description, `type`, `permissions`, `minAppVersion` or `minFirmwareBuild` differ from the
`nexus-plugin.json` inside. The catalogue is signed, so the app believes it; the manifest remains what the person installs.

| Field | Rule |
|---|---|
| `id` | lower-case reverse-domain, like `com.example.night-pack`. Never changes. The same rule as the manifest's `id`. |
| `repo` | `https://github.com/<owner>/<name>`. Where the author keeps the code and releases. |
| `name`, `author` | 1 to 60 characters. Must equal the manifest's. |
| `description` | optional, at most 300 characters. Must equal the manifest's (absent = empty). |
| `version` | SemVer (`1.2.3`, `1.2.3-beta.1`). Must equal the manifest's `version`. |
| `nexusApi` | `^MAJOR.MINOR`. Must equal the manifest's `nexusApi`. |
| `type` | `pack` (settings, no code) or `plugin` (runs code). Must equal the manifest's. |
| `permissions` | the permissions the manifest asks for, as a list (`[]` for none). Must be the same set as the manifest's. |
| `minAppVersion`, `minFirmwareBuild` | optional, as in the manifest. Must equal the manifest's. |
| `url` | a release asset of `repo`, ending `.nexusext`: `<repo>/releases/download/<tag>/<file>.nexusext`. No other host, no query. |
| `sha256` | the SHA-256 of the file, lower-case hex. The app checks it before it unpacks anything. |
| `size` | the file's size in bytes, at most 20 MB (the app's limit). |
| `testedWith` | **written by this repo's compatibility job, never by an author**: `[{"app": "5.0.0", "result": "pass"}]`. A pull request that adds it is refused. |

## Rules that never bend

1. **A published version never changes.** Its `url`, `sha256`, `size` and `nexusApi` stay as they are. To fix something, publish a new version.
2. **A version is never removed.** People on an older app keep installing the newest version their app can run, so an old one must stay.
3. **The file is checked, not trusted.** The check downloads the zip and compares its size and SHA-256, and checks that the manifest agrees with the entry (`id`,
   `version`, `nexusApi` and every card and compatibility field above).
4. **Approval is a human merging the pull request.** The checks only find mistakes; they do not decide what is safe to run. A code extension runs as the
   person's own Windows user and is not sandboxed, so read what an extension does before merging it.

## Signing

Nexus Studio only trusts a catalogue the Founder signed, because the file decides which code people run. `index.json.sig` sits beside `index.json`:

```json
{ "alg": "ed25519", "keyId": "<first 16 hex characters of the SHA-256 of the public key>", "signature": "<base64>" }
```

It covers the exact bytes of `index.json`, so any edit, even a space, needs signing again. The app has the public keys it trusts built in (`catalogue/trusted-keys.json`
here is the same list); with none, **no catalogue verifies and the Store offers nothing**. The private key lives only with the Founder, never in this repo.

```
node catalogue/sign.mjs keygen <private-key-file>        once: make the key, then add the printed public key to trusted-keys.json AND to the app
node catalogue/sign.mjs sign --key <private-key-file>     after merging a catalogue change: write index.json.sig, commit it
node catalogue/sign.mjs verify                            check index.json.sig against trusted-keys.json
```

Between a merge and the signing commit the signature does not match, and the app keeps the last catalogue it verified. Keys can be added and old ones dropped
(the signature names its key), so a lost or leaked key is replaced by shipping an app version with a new public key. Back the private key up: losing it means
nothing new can be signed until that happens.

## Adding a version (a pull request)

1. Publish a GitHub release in your repo with the `.nexusext` attached.
2. Work out its SHA-256 and size (PowerShell: `Get-FileHash .\night-pack.nexusext -Algorithm SHA256`).
3. Add one object to the `versions` list of your entry (or a whole entry for a new extension) in `index.json`, and open a pull request.

## Checking locally

```
npm test                                                         # the validator's own tests
node catalogue/validate.mjs index.json                            # the shape only
node catalogue/validate.mjs index.json --base <the main copy> --remote   # what a pull request would change, and download the new zips
```

Needs Node 22 or newer. The validator has no dependencies.

## Not built yet

The Store page in the app that reads this file, the compatibility job that fills in `testedWith`, and the submit-from-the-app flow. The app has the signature check
(`extensions/catalogue_signature.py`) but no signing key in it yet. Until the app reads the catalogue, this file and its checks are the whole of it.
