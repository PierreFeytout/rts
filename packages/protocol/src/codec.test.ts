import { CMD_MOVE, CMD_STOP } from "@rts/sim";
import { describe, expect, it } from "vitest";
import { decodeMessage, encodeMessage, tryDecodeMessage } from "./codec.js";
import {
  MSG_HASH,
  MSG_HELLO,
  MSG_SCHEDULE,
  MSG_SNAPSHOT,
  MSG_SUBMIT,
  MSG_WELCOME,
  PROTOCOL_VERSION,
  type Message,
} from "./messages.js";

function roundTrip(message: Message): Message {
  return decodeMessage(encodeMessage(message));
}

describe("codec", () => {
  it("round-trips a hello", () => {
    const m: Message = {
      t: MSG_HELLO,
      protocol: PROTOCOL_VERSION,
      contentHash: 0xdeadbeef,
      name: "pierre",
    };
    expect(roundTrip(m)).toEqual(m);
  });

  it("round-trips commands exactly", () => {
    // Commands are simulation input. A codec that widened an integer or
    // dropped a field would desync peers silently, with no error anywhere.
    const m: Message = {
      t: MSG_SUBMIT,
      requestedTick: 1234,
      commands: [
        {
          kind: CMD_MOVE,
          playerId: 3,
          entities: [0, 65537, 131074],
          targetX: 1234567,
          targetY: -987654,
        },
        { kind: CMD_STOP, playerId: 3, entities: [42] },
      ],
    };
    expect(roundTrip(m)).toEqual(m);
  });

  it("preserves negative and large fixed-point values", () => {
    // Positions are Q16.16 and routinely large; the map bound is 2^24 and the
    // arithmetic bound 2^26. Anything that clamped to 16 bits would corrupt
    // orders near the far edge of a 256-tile map.
    const values = [0, -1, 1, -65536, 65536, 1 << 24, -(1 << 24), (1 << 26) - 1];
    for (const v of values) {
      const m: Message = {
        t: MSG_SUBMIT,
        requestedTick: 0,
        commands: [{ kind: CMD_MOVE, playerId: 0, entities: [1], targetX: v, targetY: -v || 0 }],
      };
      const back = roundTrip(m) as typeof m;
      expect(back.commands[0]).toMatchObject({ targetX: v, targetY: -v || 0 });
    }
  });

  it("normalises negative zero to positive zero", () => {
    // Not a defect to work around -- this is the behaviour we want. -0 and +0
    // are distinct bit patterns, and a -0 reaching a state hash makes two peers
    // holding identical gameplay state report different hashes. The codec
    // collapsing it is one more place that hazard cannot enter from.
    const m: Message = {
      t: MSG_SUBMIT,
      requestedTick: 0,
      commands: [{ kind: CMD_MOVE, playerId: 0, entities: [1], targetX: -0, targetY: -0 }],
    };
    const back = roundTrip(m) as typeof m;
    expect(Object.is(back.commands[0].kind === CMD_MOVE && back.commands[0].targetX, -0)).toBe(
      false,
    );
  });

  it("round-trips an empty schedule", () => {
    // The overwhelmingly common case: most ticks carry no commands at all.
    const m: Message = { t: MSG_SCHEDULE, tick: 900, commands: [] };
    expect(roundTrip(m)).toEqual(m);
    expect(encodeMessage(m).byteLength).toBeLessThan(32);
  });

  it("round-trips binary snapshots without inflating them", () => {
    const payload = new Uint8Array(4096);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) & 0xff;

    const m: Message = { t: MSG_SNAPSHOT, tick: 77, snapshot: payload };
    const encoded = encodeMessage(m);
    const back = decodeMessage(encoded) as typeof m;

    expect(Array.from(back.snapshot)).toEqual(Array.from(payload));
    // Base64 in JSON would add roughly a third. Binary must not.
    expect(encoded.byteLength).toBeLessThan(payload.byteLength + 64);
  });

  it("round-trips a welcome carrying a snapshot", () => {
    const m: Message = {
      t: MSG_WELCOME,
      protocol: PROTOCOL_VERSION,
      playerId: 2,
      mapTiles: 128,
      seed: -12345,
      inputDelay: 3,
      tick: 0,
      snapshot: new Uint8Array([1, 2, 3, 250, 251]),
    };
    const back = roundTrip(m) as typeof m;
    expect(back.playerId).toBe(2);
    expect(back.seed).toBe(-12345);
    expect(Array.from(back.snapshot)).toEqual([1, 2, 3, 250, 251]);
  });

  it("round-trips unsigned hashes above 2^31", () => {
    // Hashes are unsigned 32-bit. Anything that treated them as signed would
    // report a mismatch between peers that actually agree.
    for (const hash of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
      const m: Message = { t: MSG_HASH, tick: 10, hash };
      expect((roundTrip(m) as typeof m).hash).toBe(hash);
    }
  });

  it("returns independent buffers for successive encodes", () => {
    // The transport queues messages, so it holds every buffer it was given. A
    // codec returning a view into a shared scratch buffer would make every
    // queued message mutate into the most recently encoded one.
    const a = encodeMessage({ t: MSG_SCHEDULE, tick: 1, commands: [] });
    const b = encodeMessage({ t: MSG_SCHEDULE, tick: 2, commands: [] });
    expect(decodeMessage(a)).toMatchObject({ tick: 1 });
    expect(decodeMessage(b)).toMatchObject({ tick: 2 });
    expect(a.buffer).not.toBe(b.buffer);
  });

  it("rejects malformed input", () => {
    expect(() => decodeMessage(new Uint8Array([0xc1, 0xff, 0x00]))).toThrow();
    expect(tryDecodeMessage(new Uint8Array([0xc1, 0xff, 0x00]))).toBeNull();
    // A peer is untrusted input; garbage must never take the process down.
    expect(tryDecodeMessage(new Uint8Array(0))).toBeNull();
  });

  it("keeps a realistic command batch small", () => {
    // The bandwidth claim: ordering 200 units costs about the same as ordering
    // one, because only intent travels.
    const entities = Array.from({ length: 200 }, (_, i) => i * 65536 + 1);
    const m: Message = {
      t: MSG_SCHEDULE,
      tick: 5000,
      commands: [{ kind: CMD_MOVE, playerId: 1, entities, targetX: 1 << 22, targetY: 1 << 22 }],
    };
    const size = encodeMessage(m).byteLength;
    expect(size, `${size} bytes for a 200-unit order`).toBeLessThan(1200);
  });
});
