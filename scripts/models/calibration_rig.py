"""
A rigged calibration figure, for the animation pipeline's tests.

    blender -b --factory-startup --python scripts/models/calibration_rig.py

Writes packages/client/src/__fixtures__/blender-rig.glb. Not a unit: a test
fixture, which skinned-parts.test.ts builds by hand and blender-rig.test.ts
checks against what Blender's exporter really writes. Each piece answers one
question about that exporter:

  - a leg on each side, swung in opposite directions  -> are bone axes and
                                                         mirroring preserved
  - an arm pointing along +X that recoils in "fire"    -> is forward still
                                                         forward once skinned
  - a painted chest plate                              -> does the team mask
                                                         survive skinning
  - three clips, "idle", "walk", "fire"                -> do several actions on
                                                         one armature all export
  - `rts_squad` on the armature                        -> do custom properties
                                                         arrive as extras
  - a bevel on the chest                               -> are modifiers other
                                                         than the armature kept
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402

OUT = os.path.join(kit.REPO, "packages", "client", "src", "__fixtures__")

kit.fresh_scene()
col = kit.collection("CalibrationRig")
m = kit.directorate_palette()

rig = kit.armature("rig", col, [
    ("pelvis", (0, 0, 0.16), (0, 0, 0.22), None),
    ("chest", (0, 0, 0.22), (0, 0, 0.34), "pelvis"),
    ("arm", (0.02, -0.06, 0.3), (0.2, -0.06, 0.3), "chest"),
    ("leg.L", (0, 0.035, 0.16), (0, 0.035, 0.0), "pelvis"),
    ("leg.R", (0, -0.035, 0.16), (0, -0.035, 0.0), "pelvis"),
])

parts = [
    kit.rigid_part("hips", kit.box((0.07, 0.11, 0.05), (0, 0, 0.18)), m["iron"], col, "pelvis"),
    kit.rigid_part("chest", kit.box((0.08, 0.12, 0.12), (0, 0, 0.27)), m["iron"], col, "chest"),
    kit.rigid_part("plate", kit.box((0.012, 0.09, 0.07), (0.045, 0, 0.28)), m["paint"], col, "chest", painted=True),
    kit.rigid_part("arm", kit.beam((0.02, -0.06, 0.3), (0.2, -0.06, 0.3), 0.03), m["dark"], col, "arm"),
    kit.rigid_part("leg.L", kit.box((0.03, 0.03, 0.16), (0, 0.035, 0.08)), m["dark"], col, "leg.L"),
    kit.rigid_part("leg.R", kit.box((0.03, 0.03, 0.16), (0, -0.035, 0.08)), m["dark"], col, "leg.R"),
]
kit.bevel(parts[1], width=0.006)
body = kit.join(parts, "body")
kit.bind(body, rig)

# Forward, left, phase. A wedge with its point forward, so a squad that turns
# with its unit is visibly different from one that does not.
rig["rts_squad"] = [0.2, 0.0, 0.0, -0.1, 0.15, 0.33, -0.1, -0.15, 0.66]

kit.clip(rig, "idle", 30, {
    0: {},
    15: {"chest": [("X", 4)]},
    30: {},
})
kit.clip(rig, "walk", 20, {
    0: {"leg.L": [("Y", 25)], "leg.R": [("Y", -25)]},
    10: {"leg.L": [("Y", -25)], "leg.R": [("Y", 25)]},
    20: {"leg.L": [("Y", 25)], "leg.R": [("Y", -25)]},
})
kit.clip(rig, "fire", 9, {
    0: {},
    2: {"arm": [("Z", 20)], "chest": [("Y", -8)]},
    9: {},
})

print("calibration rig:", kit.report(col))
print("wrote", kit.export_rigged(col, "blender-rig", directory=OUT))
