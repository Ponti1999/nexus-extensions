# nexus-extensions

The extension catalogue and SDK for **Nexus Studio**, the companion app for the Nexus Split keyboard.

- [`sdk/`](sdk/README.md): the TypeScript SDK for extensions that run code (`nexus-extension-sdk`).

- [`examples/hello-plugin`](examples/hello-plugin/main.mjs): the smallest extension that runs code, run for real by the app's plugin host.
- [`docs/lighting-presets.md`](docs/lighting-presets.md) and [`examples/sunset-lights`](examples/sunset-lights/pack.json): a pack (no code) that offers lighting presets.
- [`index.json`](docs/catalogue.md): the catalogue of approved extensions, and `catalogue/`, the validator that checks a pull request that changes it.

The Store page in the app and the rest of the author docs arrive in later WP-11 steps.
