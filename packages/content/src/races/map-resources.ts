/**
 * Shared map scenery.
 *
 * Resource nodes belong to the *map*, not to a race: an ore patch is the same
 * ore patch whoever mines it. Keeping them in their own top-level list rather
 * than inside a race is what stops a faction from defining an economy only it
 * can use -- which would look like content but would really be a balance
 * decision nobody else could see.
 */
export const mapResources = [
  {
    id: "map.alloy-node",
    name: "Alloy Node",
    footprint: 2,
    radius: 1,
    resourceAmount: 1500,
  },
  {
    id: "map.vent",
    name: "Geothermal Vent",
    footprint: 2,
    radius: 1,
    // Zero ore marks a *marker* node: nothing to mine, but something can be
    // built on top of it. Extractors and Siphons both consume one.
    resourceAmount: 0,
  },
];
