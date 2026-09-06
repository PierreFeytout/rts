/**
 * A minimal valid map, for tests.
 *
 * Deliberately not shipped and deliberately not one of the real maps. Tests
 * that build an ad-hoc content set need *a* map, because a content set with no
 * maps is not playable and the loader says so -- but they are testing race
 * validation and content hashing, and pointing them at Rift Basin would make
 * every one of them churn the day somebody moves a rock.
 *
 * The same reasoning as packages/sim/src/fixture-types.ts.
 */
export const fixtureMap = {
  format: 1,
  id: "fixture",
  name: "Fixture",
  blurb: "The smallest thing the loader accepts.",
  size: 64,
  starts: [
    { x: 8, y: 8 },
    { x: 48, y: 48 },
  ],
  blocks: [[30, 30, 4, 4]],
  resources: [
    { type: "map.alloy-node", x: 15, y: 8 },
    { type: "map.vent", x: 4, y: 11 },
    { type: "map.alloy-node", x: 55, y: 48 },
    { type: "map.vent", x: 44, y: 51 },
  ],
};
