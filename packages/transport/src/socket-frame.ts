import type { PeerId } from "./transport.js";

/**
 * Framing for the direct-connection transport.
 *
 * Every player -- including the one hosting -- connects to a relay running on
 * the host's machine, over one WebSocket each. A single socket therefore has to
 * carry traffic for several logical peers, so each frame says who it is for or
 * who it came from. Five bytes: a kind and a peer id.
 *
 * Deliberately not JSON. These frames wrap already-encoded game messages, and
 * base64-ing a snapshot into a JSON envelope would inflate the one payload that
 * is actually large.
 *
 * The relay is a byte pipe. It reads the header to route and never looks at the
 * payload, which is what keeps it a few hundred lines and unable to disagree
 * with the simulation about anything.
 */

/** Game payload. `peer` is the destination when sending, the source when receiving. */
export const FRAME_DATA = 0;
/** Relay to client, on connect: "you are peer N". */
export const FRAME_WELCOME = 1;
/** Relay to the host: another player connected. */
export const FRAME_JOIN = 2;
/** Relay to the host: a player disconnected. */
export const FRAME_LEAVE = 3;
/** Relay to client, before closing: why it is refusing or ending the connection. */
export const FRAME_REJECT = 4;

/** Destination meaning "every connected peer". */
export const BROADCAST: PeerId = 0xffff;

export const FRAME_HEADER_BYTES = 5;

export interface Frame {
  kind: number;
  peer: PeerId;
  payload: Uint8Array;
}

/** Build a frame. The payload is copied, so callers may reuse their buffer. */
export function encodeFrame(kind: number, peer: PeerId, payload?: Uint8Array): Uint8Array {
  const out = new Uint8Array(FRAME_HEADER_BYTES + (payload?.byteLength ?? 0));
  out[0] = kind;
  // Little-endian by hand rather than via DataView: it is four bytes on a hot
  // path, and writing them explicitly means the format cannot drift with
  // whatever endianness the machine happens to have.
  out[1] = peer & 0xff;
  out[2] = (peer >>> 8) & 0xff;
  out[3] = (peer >>> 16) & 0xff;
  out[4] = (peer >>> 24) & 0xff;
  if (payload) out.set(payload, FRAME_HEADER_BYTES);
  return out;
}

/**
 * Read a frame, or null if the bytes are too short to be one.
 *
 * Returning null rather than throwing because this parses input from the
 * network: a malformed frame from a modified client must be a dropped message,
 * not a crashed host.
 */
export function decodeFrame(data: Uint8Array): Frame | null {
  if (data.byteLength < FRAME_HEADER_BYTES) return null;
  const peer =
    data[1] | (data[2] << 8) | (data[3] << 16) | ((data[4] << 24) >>> 0);
  return {
    kind: data[0],
    peer: peer >>> 0,
    // A view, not a copy. The receiver hands it straight to a decoder that
    // reads it synchronously, and copying every frame would double the cost of
    // the largest message in the protocol.
    payload: data.subarray(FRAME_HEADER_BYTES),
  };
}

/**
 * Text payloads, used only for rejection reasons.
 *
 * Reached through `globalThis` rather than the bare globals, so this package
 * still needs neither the DOM lib nor Node's types -- it has to compile for the
 * browser, for Electron's renderer and for Node alike. Both runtimes have had
 * these since 2018; the cast is about keeping the package platform-free at the
 * type level, not about doubt that they exist.
 */
interface TextCodecs {
  TextEncoder: new () => { encode(input: string): Uint8Array };
  TextDecoder: new () => { decode(input: Uint8Array): string };
}

export function encodeText(text: string): Uint8Array {
  return new (globalThis as unknown as TextCodecs).TextEncoder().encode(text);
}

export function decodeText(data: Uint8Array): string {
  return new (globalThis as unknown as TextCodecs).TextDecoder().decode(data);
}
