/**
 * Race #1 -- the Vanguard Directive.
 *
 * Human corporate-military: hovertanks, mechs and drones. Kinetic infantry that
 * shreds light targets, explosive armour that cracks buildings, and a plasma
 * turret to hold ground.
 *
 * This file is *data*, not code. It is deliberately not annotated with a
 * TypeScript type: it goes through `parseRace` like anything else, so the
 * schema is genuinely validating rather than re-checking something the compiler
 * already proved. A misspelled field here fails at load with the field named,
 * exactly as it would if this content arrived from a file or a mod folder.
 *
 * Authoring units: distances and sizes in TILES, durations in SECONDS, speed in
 * tiles per second, turn rate in full turns per second. The loader converts to
 * Q16.16 and ticks.
 */
export const vanguard = {
  id: "vanguard",
  name: "The Ashen Directorate",
  blurb: "The combine that owns the paperwork. Conscripts, contracts, and kinetic lines.",
  startBuilding: "vanguard.nexus",
  startUnit: "vanguard.drone",

  units: [
    {
      id: "vanguard.drone",
      name: "Servitor",
      maxHealth: 60,
      armour: "light",
      radius: 0.32,
      moveSpeed: 2.6,
      turnRate: 1.1,
      costAlloy: 50,
      buildTime: 1.2,
      supplyCost: 1,
      cargoCapacity: 10,
      gatherTime: 1,
      behaviours: ["gather", "build", "attack"],
      // Armed, but barely. A drone that trades shots with a trooper is a drone
      // that stopped mining, so it is deliberately not worth doing.
      weapon: { damage: 4, damageType: "kinetic", range: 1.2, cooldown: 1.1 },
      builds: [
        "vanguard.nexus",
        "vanguard.extractor",
        "vanguard.foundry",
        "vanguard.pylon",
        "vanguard.turret",
      ],
    },
    {
      id: "vanguard.trooper",
      name: "Conscript",
      maxHealth: 90,
      armour: "light",
      radius: 0.32,
      moveSpeed: 2.4,
      turnRate: 1.1,
      costAlloy: 60,
      buildTime: 1.5,
      supplyCost: 2,
      behaviours: ["attack"],
      weapon: { damage: 9, damageType: "kinetic", range: 5, cooldown: 0.6 },
    },
    {
      id: "vanguard.scout",
      name: "Outrider",
      maxHealth: 70,
      armour: "light",
      radius: 0.28,
      moveSpeed: 4,
      turnRate: 1.6,
      costAlloy: 45,
      costPlasma: 10,
      buildTime: 1.2,
      supplyCost: 1,
      behaviours: ["attack"],
      weapon: { damage: 5, damageType: "kinetic", range: 4, cooldown: 0.7 },
    },
    {
      id: "vanguard.hovertank",
      name: "Breaker",
      maxHealth: 260,
      armour: "heavy",
      radius: 0.45,
      moveSpeed: 1.9,
      turnRate: 0.73,
      costAlloy: 120,
      costPlasma: 40,
      buildTime: 3.5,
      supplyCost: 4,
      behaviours: ["attack"],
      weapon: { damage: 22, damageType: "explosive", range: 6, cooldown: 1.3 },
    },
  ],

  buildings: [
    {
      id: "vanguard.nexus",
      name: "Bastion",
      maxHealth: 1500,
      armour: "structure",
      radius: 2,
      footprint: 4,
      costAlloy: 400,
      buildTime: 10,
      supplyProvided: 10,
      behaviours: ["produce", "dropoff"],
      produces: ["vanguard.drone"],
    },
    {
      id: "vanguard.extractor",
      name: "Vent Tap",
      maxHealth: 500,
      armour: "structure",
      radius: 1,
      footprint: 2,
      costAlloy: 100,
      buildTime: 5,
      plasmaPerSecond: 3,
      behaviours: ["needsVent"],
    },
    {
      id: "vanguard.foundry",
      name: "Foundry",
      maxHealth: 900,
      armour: "structure",
      radius: 1.5,
      footprint: 3,
      costAlloy: 200,
      buildTime: 7,
      behaviours: ["produce"],
      produces: ["vanguard.trooper", "vanguard.scout", "vanguard.hovertank"],
    },
    {
      id: "vanguard.pylon",
      name: "Habstack",
      maxHealth: 400,
      armour: "structure",
      radius: 1,
      footprint: 2,
      costAlloy: 80,
      buildTime: 3,
      supplyProvided: 8,
    },
    {
      id: "vanguard.turret",
      name: "Gun Nest",
      maxHealth: 550,
      armour: "structure",
      radius: 1,
      footprint: 2,
      costAlloy: 120,
      costPlasma: 25,
      buildTime: 4,
      behaviours: ["attack"],
      weapon: { damage: 16, damageType: "plasma", range: 7, cooldown: 0.8 },
    },
  ],
};
