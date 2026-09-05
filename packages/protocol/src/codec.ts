import { Packr } from "msgpackr";
import type { Message } from "./messages.js";

/**
 * Binary encoding for wire messages.
 *
 * MessagePack rather than JSON: the payload is mostly integers, which JSON
 * would inflate to decimal text and force the receiver to re-parse one at a
 * time. It also carries binary buffers natively, which matters for snapshots --
 * base64 in JSON would add a third again on a payload already going to a peer
 * who is struggling.
 *
 * IMPORTANT: encoding must round-trip exactly. Commands are simulation input,
 * so a codec that quietly widened an integer or dropped a field would desync
 * peers with no error anywhere. `encode(decode(x)) === x` is asserted in the
 * tests for every message type.
 */

const packr = new Packr({
  // Reuse a single output buffer for speed. Callers therefore must not retain
  // the returned view past the next encode -- see `encodeMessage`.
  useRecords: false,
  // Structured clone support brings TypedArray handling, which snapshots need.
  structuredClone: false,
  bundleStrings: false,
});

/**
 * Encode a message.
 *
 * Returns a COPY rather than a view into the shared buffer. Handing out the
 * internal buffer would be faster, but every caller then has to remember not to
 * hold it -- and the transport queues messages, so it holds all of them. The
 * bug that produces is every queued message mutating into the most recent one,
 * which is deeply confusing to diagnose.
 */
export function encodeMessage(message: Message): Uint8Array {
  const packed = packr.pack(message);
  return new Uint8Array(packed);
}

/** Decode a message. Throws on malformed input. */
export function decodeMessage(data: Uint8Array): Message {
  const decoded = packr.unpack(data) as unknown;
  if (typeof decoded !== "object" || decoded === null || !("t" in decoded)) {
    throw new Error("protocol: payload is not a message");
  }
  return decoded as Message;
}

/** Decode, returning null instead of throwing. For untrusted peer input. */
export function tryDecodeMessage(data: Uint8Array): Message | null {
  try {
    return decodeMessage(data);
  } catch {
    return null;
  }
}

/**
 * Encode an arbitrary structure with the same codec the wire uses.
 *
 * Exists for replays, which are files rather than messages but have exactly
 * the same shape problem: mostly integers, with embedded binary. Reusing the
 * codec means a replay cannot round-trip differently from the commands it was
 * recorded from -- and those commands are simulation input, so a codec that
 * quietly widened an integer would make a replay diverge from the match it
 * recorded.
 */
export function encodeBinary(value: unknown): Uint8Array {
  return new Uint8Array(packr.pack(value));
}

/** Decode a structure written by `encodeBinary`. Throws on malformed input. */
export function decodeBinary(data: Uint8Array): unknown {
  return packr.unpack(data);
}
