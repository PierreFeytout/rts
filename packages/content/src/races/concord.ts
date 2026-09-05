/**
 * Race #2 -- the Verdant Concord.
 *
 * **This file is the extensibility proof.** It adds a complete second faction
 * and it adds zero engine code: no new system, no new ability flag, no
 * simulation change of any kind. If that ever stops being true, the claim in
 * the README is no longer true either, and `concord.test.ts` is what notices.
 *
 * The Concord plays differently despite reusing the same behaviours, because
 * the interesting choices in an RTS live in the numbers rather than in the
 * verbs:
 *
 *   - Thornlings brawl. Near-melee range and a fast, hard-hitting attack, so
 *     the Concord wants to close, where the Vanguard wants to hold a line.
 *   - Sporecasters out-range everything the Vanguard fields, but fold to
 *     anything that reaches them.
 *   - Sporelings carry larger loads more slowly, so a Concord economy ramps
 *     later and is hurt less by a long walk to a distant patch.
 *   - The Heartwood provides more supply than a Nexus but the Bloom provides
 *     less, so the Concord opens faster and expands its cap more slowly.
 */
export const concord = {
  id: "concord",
  name: "Verdant Concord",
  blurb: "Grown, not built. Brawlers up front, spores behind.",
  startBuilding: "concord.heartwood",
  startUnit: "concord.sporeling",

  units: [
    {
      id: "concord.sporeling",
      name: "Sporeling",
      maxHealth: 70,
      armour: "light",
      radius: 0.32,
      moveSpeed: 2.2,
      turnRate: 1.2,
      costAlloy: 55,
      buildTime: 1.3,
      supplyCost: 1,
      // Bigger loads, slower to fill: fewer trips, each worth more.
      cargoCapacity: 14,
      gatherTime: 1.4,
      behaviours: ["gather", "build", "attack"],
      weapon: { damage: 3, damageType: "kinetic", range: 1.2, cooldown: 1.2 },
      builds: [
        "concord.heartwood",
        "concord.siphon",
        "concord.grove",
        "concord.bloom",
        "concord.barb",
      ],
    },
    {
      id: "concord.thornling",
      name: "Thornling",
      maxHealth: 130,
      armour: "light",
      radius: 0.34,
      moveSpeed: 3,
      turnRate: 1.4,
      costAlloy: 65,
      buildTime: 1.6,
      supplyCost: 2,
      behaviours: ["attack"],
      // Almost melee. Enormous damage for the cost, on the condition that it
      // survives the walk in.
      weapon: { damage: 14, damageType: "kinetic", range: 1.4, cooldown: 0.5 },
    },
    {
      id: "concord.sporecaster",
      name: "Sporecaster",
      maxHealth: 80,
      armour: "light",
      radius: 0.3,
      moveSpeed: 2.2,
      turnRate: 1.1,
      costAlloy: 70,
      costPlasma: 20,
      buildTime: 2,
      supplyCost: 2,
      behaviours: ["attack"],
      // Out-ranges every Vanguard unit, and dies to anything that closes.
      weapon: { damage: 12, damageType: "plasma", range: 6.5, cooldown: 1.1 },
    },
    {
      id: "concord.behemoth",
      name: "Behemoth",
      maxHealth: 340,
      armour: "heavy",
      radius: 0.5,
      moveSpeed: 1.6,
      turnRate: 0.6,
      costAlloy: 140,
      costPlasma: 50,
      buildTime: 4,
      supplyCost: 5,
      behaviours: ["attack"],
      weapon: { damage: 26, damageType: "explosive", range: 5.5, cooldown: 1.5 },
    },
  ],

  buildings: [
    {
      id: "concord.heartwood",
      name: "Heartwood",
      maxHealth: 1600,
      armour: "structure",
      radius: 2,
      footprint: 4,
      costAlloy: 400,
      buildTime: 10.5,
      supplyProvided: 12,
      behaviours: ["produce", "dropoff"],
      produces: ["concord.sporeling"],
    },
    {
      id: "concord.siphon",
      name: "Siphon",
      maxHealth: 480,
      armour: "structure",
      radius: 1,
      footprint: 2,
      costAlloy: 110,
      buildTime: 5,
      plasmaPerSecond: 4,
      behaviours: ["needsVent"],
    },
    {
      id: "concord.grove",
      name: "Grove",
      maxHealth: 950,
      armour: "structure",
      radius: 1.5,
      footprint: 3,
      costAlloy: 200,
      buildTime: 7.5,
      behaviours: ["produce"],
      produces: ["concord.thornling", "concord.sporecaster", "concord.behemoth"],
    },
    {
      id: "concord.bloom",
      name: "Bloom",
      maxHealth: 360,
      armour: "structure",
      radius: 1,
      footprint: 2,
      costAlloy: 70,
      buildTime: 2.5,
      supplyProvided: 7,
    },
    {
      id: "concord.barb",
      name: "Barb",
      maxHealth: 520,
      armour: "structure",
      radius: 1,
      footprint: 2,
      costAlloy: 115,
      costPlasma: 25,
      buildTime: 4,
      behaviours: ["attack"],
      weapon: { damage: 18, damageType: "kinetic", range: 6.5, cooldown: 0.9 },
    },
  ],
};
