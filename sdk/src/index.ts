/**
 * Nexus Studio extension SDK: a small client for the app's local API (`docs/api/v1.md` in the app).
 *
 * Nexus Studio starts an extension with its own token and the API address in the environment (`NEXUS_API_URL`, `NEXUS_API_TOKEN`,
 * `NEXUS_API_VERSION`, `NEXUS_EXTENSION_ID`, `NEXUS_EXTENSION_PREFIX`), so a plain `connect()` is all an extension needs.
 *
 *     import { connect } from 'nexus-extension-sdk';
 *     const nexus = await connect();
 *     await nexus.subscribe(['system.layer'], (signal) => console.log('layer', signal.value));
 *     await nexus.closed; // the app closes the connection when it stops or turns the extension off: exit then
 *
 * What the SDK does NOT do, on purpose: reconnect (the app restarts a crashed extension itself, with a new token), send anything to the
 * keyboard (the API has no such method), or hide the API's errors (`NexusError.code` is the API's own code).
 * Needs Node 22 or newer (the built-in WebSocket).
 */

/** The API version this SDK was written against. The app accepts the same major version. */
export const SDK_API_VERSION = '1.15';

/** A signal as the API sends it (`signal` event). */
export interface Signal {
  source: string;
  value: unknown;
  unit?: string;
  layer?: number;
  profile?: string;
  quality?: string;
  sequence?: number;
  wall_time?: number;
  metadata?: Record<string, unknown>;
}

/** What the app says about this connection once the handshake is done. */
export interface Welcome {
  api: string;
  role: string;
  scopes: string[];
  methods: string[];
  events: string[];
  server: { name: string; version: string };
}

export interface ConnectOptions {
  /** Default: `NEXUS_API_URL`. */
  url?: string;
  /** Default: `NEXUS_API_TOKEN`. */
  token?: string;
  /** Default: `NEXUS_API_VERSION`, else `SDK_API_VERSION`. */
  apiVersion?: string;
  /** Sent as `client.name`. Default: `NEXUS_EXTENSION_ID`, else `extension`. */
  name?: string;
  /** Sent as `client.version`. Default: empty. */
  version?: string;
  /** The key prefix an extension may use in settings. Default: `NEXUS_EXTENSION_PREFIX`. */
  prefix?: string;
  /** How long to wait for the welcome. The app itself gives up on a silent client after 5 s. Default 5000. */
  timeoutMs?: number;
}

/** An error the app answered with (`code`: `forbidden`, `invalid_params`, `unavailable`, ...) or a connection problem (`code`: `closed`, `bad_token`, ...). */
export class NexusError extends Error {
  constructor(public code: string, message: string, public details: string[] = []) {
    super(message);
    this.name = 'NexusError';
  }
}

/** Close codes the app uses before a connection is accepted (docs/api/v1.md). */
const CLOSE_MEANING: Record<number, [string, string]> = {
  4001: ['bad_token', 'The app refused this extension’s token. It is only valid for one run: let the app start the extension.'],
  4002: ['unsupported_api', 'The app speaks a different API major version than this SDK.'],
  4003: ['protocol_error', 'The app did not understand the first message.'],
};

type Closed = { code: number; reason: string };
type Handler = (data: unknown) => void;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class Nexus {
  /** Resolves when the connection ends (the app stopped, turned this extension off, or revoked its token). Never rejects. */
  readonly closed: Promise<Closed>;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, Set<Handler>>();
  private done = false;

  /** @internal Use `connect()`. */
  constructor(private readonly ws: WebSocket, readonly welcome: Welcome, readonly prefix: string, closed: Promise<Closed>) {
    this.closed = closed.then((c) => {
      this.done = true;
      for (const p of this.pending.values()) p.reject(new NexusError('closed', 'The connection to Nexus Studio closed.'));
      this.pending.clear();
      return c;
    });
  }

  /** @internal Route one message from the app. */
  dispatch(msg: Record<string, unknown>): void {
    if (msg.type === 'event' && typeof msg.event === 'string') {
      for (const h of this.handlers.get(msg.event) ?? []) h(msg.data);
      return;
    }
    if ((msg.type !== 'response' && msg.type !== 'error') || typeof msg.id !== 'number') return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.type === 'response') {
      p.resolve(msg.result);
      return;
    }
    const e = (msg.error ?? {}) as { code?: string; message?: string; details?: unknown };
    p.reject(new NexusError(e.code ?? 'internal', e.message ?? 'The request failed.', Array.isArray(e.details) ? e.details.filter((d): d is string => typeof d === 'string') : []));
  }

  /** One request. Rejects with `NexusError` (the API's code) when the app refuses it, or with code `closed` when the connection ends first. */
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.done) return Promise.reject(new NexusError('closed', 'The connection to Nexus Studio closed.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.ws.send(JSON.stringify(params ? { type: 'request', id, method, params } : { type: 'request', id, method }));
    });
  }

  /** Listen to an API event (`signal`, `device`, `context`, `settings`, `action`, `profiles`). Returns the function that stops listening. */
  on(event: string, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  /**
   * Ask for signals matching `patterns` (`fader.*`, `system.layer`) and call `handler` for each. The app keeps only the latest value of each source for a slow
   * reader, so a handler sees the current value, not every sample. Needs the `signals.read` permission.
   */
  async subscribe(patterns: string[], handler: (signal: Signal) => void): Promise<() => void> {
    const off = this.on('signal', handler as Handler);
    try {
      await this.call('signals.subscribe', { patterns });
    } catch (e) {
      off();
      throw e;
    }
    return off;
  }

  /** This extension's own settings: keys are stored as `<prefix><name>`; the app refuses any other key. */
  readonly settings = {
    get: (name: string): Promise<unknown> => this.call('settings.get', { key: this.prefix + name }),
    set: (name: string, value: unknown): Promise<unknown> => this.call('settings.set', { key: this.prefix + name, value }),
  };

  /** Close the connection (the app sees the extension leave). */
  close(): void {
    this.ws.close(1000);
  }
}

/** A binary signal value (`{"$bytes": "<hex>"}`, e.g. a slot descriptor) as bytes, or null when `value` is not one. */
export function bytesOf(value: unknown): Uint8Array | null {
  if (!value || typeof value !== 'object' || !('$bytes' in value)) return null;
  const hex = String((value as { $bytes: unknown }).$bytes);
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Connect to Nexus Studio and finish the handshake. Rejects with `NexusError` when the address or token is missing, or the app refuses. */
export function connect(options: ConnectOptions = {}): Promise<Nexus> {
  const env = process.env;
  const url = options.url ?? env.NEXUS_API_URL;
  const token = options.token ?? env.NEXUS_API_TOKEN;
  if (!url || !token) {
    return Promise.reject(new NexusError('not_started_by_app', 'NEXUS_API_URL and NEXUS_API_TOKEN are not set: Nexus Studio starts an extension with them. Turn the extension on in the app instead of running it by hand.'));
  }
  const apiVersion = options.apiVersion ?? env.NEXUS_API_VERSION ?? SDK_API_VERSION;
  const name = options.name ?? env.NEXUS_EXTENSION_ID ?? 'extension';
  const prefix = options.prefix ?? env.NEXUS_EXTENSION_PREFIX ?? '';
  const timeoutMs = options.timeoutMs ?? 5000;

  return new Promise<Nexus>((resolve, reject) => {
    const ws = new WebSocket(url);
    let nexus: Nexus | null = null;
    let settle: (c: Closed) => void = () => undefined;
    const closed = new Promise<Closed>((r) => { settle = r; });
    const timer = setTimeout(() => { reject(new NexusError('timeout', 'Nexus Studio did not answer the handshake.')); ws.close(); }, timeoutMs);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', api: apiVersion, token, client: { name, version: options.version ?? '' } }));
    ws.onmessage = (m) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (nexus) { nexus.dispatch(msg); return; }
      if (msg.type !== 'welcome') return;
      clearTimeout(timer);
      nexus = new Nexus(ws, msg as unknown as Welcome, prefix, closed);
      resolve(nexus);
    };
    ws.onerror = () => undefined; // the close event that follows says why
    ws.onclose = (ev) => {
      clearTimeout(timer);
      settle({ code: ev.code, reason: ev.reason });
      if (!nexus) {
        const [code, message] = CLOSE_MEANING[ev.code] ?? ['connection_failed', `Could not connect to Nexus Studio (${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`];
        reject(new NexusError(code, message));
      }
    };
  });
}
