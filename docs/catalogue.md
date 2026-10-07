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
      "versions": [
        {
          "version": "1.0.0",
          "nexusApi": "^1.2",
          "url": "https://github.com/someone/night-pack/releases/download/v1.0.0/night-pack.nexusext",
          "sha256": "<64 lower-case hex characters>",
          "size": 12345
        }
      ]
    }
  ]
}
```

An entry is an **id**, the author's **repo**, and every **version** that has been approved. Everything the Store shows about an extension (its name, author,
description, whether it runs code, the permissions it asks for) is read from the `nexus-plugin.json` **inside the zip**, not copied here, so it cannot
disagree with what the person installs.

| Field | Rule |
|---|---|
| `id` | lower-case reverse-domain, like `com.example.night-pack`. Never changes. The same rule as the manifest's `id`. |
| `repo` | `https://github.com/<owner>/<name>`. Where the author keeps the code and releases. |
| `version` | SemVer (`1.2.3`, `1.2.3-beta.1`). Must equal the manifest's `version`. |
| `nexusApi` | `^MAJOR.MINOR`. Must equal the manifest's `nexusApi`. |
| `url` | a release asset of `repo`, ending `.nexusext`: `<repo>/releases/download/<tag>/<file>.nexusext`. No other host, no query. |
| `sha256` | the SHA-256 of the file, lower-case hex. The app checks it before it unpacks anything. |
| `size` | the file's size in bytes, at most 20 MB (the app's limit). |
| `testedWith` | **written by this repo's compatibility job, never by an author**: `[{"app": "5.0.0", "result": "pass"}]`. A pull request that adds it is refused. |

## Rules that never bend

1. **A published version never changes.** Its `url`, `sha256`, `size` and `nexusApi` stay as they are. To fix something, publish a new version.
2. **A version is never removed.** People on an older app keep installing the newest version their app can run, so an old one must stay.
3. **The file is checked, not trusted.** The check downloads the zip and compares its size and SHA-256, and checks that the manifest's `id`, `version` and
   `nexusApi` match the entry.
4. **Approval is a human merging the pull request.** The checks only find mistakes; they do not decide what is safe to run. A code extension runs as the
   person's own Windows user and is not sandboxed, so read what an extension does before merging it.

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

The Store page in the app that reads this file, the signature on the catalogue (so the app can tell this file is the real one), the compatibility job that fills
in `testedWith`, and the submit-from-the-app flow. Until the app reads the catalogue, this file and its checks are the whole of it.
