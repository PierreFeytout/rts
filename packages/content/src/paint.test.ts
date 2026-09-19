import { describe, expect, it } from "vitest";
import { decodePaint, encodePaint } from "./paint.js";

/**
 * The paint layer's encoding.
 *
 * Every one of these is about a map file that loads without complaint and is
 * wrong -- a paint string one tile short would leave the last row painted in
 * whatever zero happens to mean, and a layer letter past the end of the
 * map's list would index into nothing. Both are silent at the schema level,
 * because as far as the schema can tell a string of letters is a string of
 * letters.
 */

const WHERE = "map 'fixture'";

describe("paint", () => {
  it("round-trips", () => {
    const paint = new Uint8Array([0, 0, 0, 1, 1, 2, 0, 0, 0, 0, 0, 0, 3, 1, 0, 0]);
    expect(decodePaint(encodePaint(paint), paint.length, 4, WHERE)).toEqual(paint);
  });

  it("writes a run of one without a count", () => {
    expect(encodePaint(new Uint8Array([0, 1, 2]))).toBe("abc");
  });

  it("is compact on the flat ground most of a map is", () => {
    // The reason this format exists: a thousand tiles of one surface must
    // not cost a thousand characters, or the largest map's file is tens of
    // megabytes of commas.
    expect(encodePaint(new Uint8Array(1000))).toBe("1000a");
  });

  it("refuses a string that covers too few tiles", () => {
    expect(() => decodePaint("10a", 16, 2, WHERE)).toThrow(/covers 10 tiles, not 16/);
  });

  it("refuses a string that covers too many", () => {
    expect(() => decodePaint("20a", 16, 2, WHERE)).toThrow(/more than its 16 tiles/);
  });

  it("refuses a layer the map does not have", () => {
    // A map with two layers whose paint mentions a third is an editing
    // mistake, not a tile to leave unpainted.
    expect(() => decodePaint("8a8c", 16, 2, WHERE)).toThrow(/names layer 'c' but the map has 2/);
  });

  it("refuses a trailing count", () => {
    expect(() => decodePaint("8a8", 16, 2, WHERE)).toThrow(/ends in a count/);
  });

  it("names the map it is complaining about", () => {
    expect(() => decodePaint("4a", 16, 2, WHERE)).toThrow(/fixture/);
  });
});
