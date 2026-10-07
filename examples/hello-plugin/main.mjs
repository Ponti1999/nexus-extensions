// The smallest extension that runs code. Nexus Studio starts this file with `node`, with its own token in the environment.
import { connect } from './nexus-extension-sdk.mjs';

const nexus = await connect();
console.log(`hello: connected as ${nexus.welcome.role} to ${nexus.welcome.server.name} ${nexus.welcome.server.version} (API ${nexus.welcome.api})`);

// Needs the device.read permission.
const device = await nexus.call('device.status');
console.log(`hello: keyboard connected = ${device.connected}`);

// Needs settings.write: stored under this extension's own prefix, `ext.com.example.hello-plugin:`.
await nexus.settings.set('greeting', 'hello');

// Needs signals.read. The app sends the current value of each matching signal, and again when it changes.
await nexus.subscribe(['system.layer'], async (signal) => {
  console.log(`hello: layer is ${signal.value}`);
  await nexus.settings.set('last_layer', signal.value);
});

// Nexus Studio closes the connection when it stops or turns this extension off. That is the cue to exit.
await nexus.closed;
console.log('hello: the app closed the connection, leaving');
