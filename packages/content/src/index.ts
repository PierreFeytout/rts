import { buildContent, type ContentSet } from "./intern.js";
import { concord } from "./races/concord.js";
import { mapResources } from "./races/map-resources.js";
import { vanguard } from "./races/vanguard.js";

export * from "./intern.js";
export * from "./schema.js";
export { concord, mapResources, vanguard };

/**
 * The shipped content set.
 *
 * Built once at module load and shared. Loading is pure -- validation, id
 * interning and unit conversion, no I/O and no randomness -- so every peer
 * running the same build produces an identical table without exchanging
 * anything. `defaultContent.hash` is what the lobby compares to prove that.
 *
 * Adding a race means adding one file and one entry in this array. Nothing else
 * in the codebase changes; that is the claim `concord.test.ts` verifies rather
 * than asserts.
 */
export const defaultContent: ContentSet = buildContent([vanguard, concord], mapResources);

/**
 * Convenience: the shipped type table, which is what `World` wants.
 *
 * A note on bundle size -- zod costs the client roughly 26 kB gzipped, and the
 * shipped races are validated by tests long before they reach a browser. It is
 * kept in the production build anyway, because the moment content comes from a
 * file or a mod folder -- which is the point of having a schema at all -- that
 * validation has to run where the content is actually loaded.
 */
export const defaultTypes = defaultContent.types;
