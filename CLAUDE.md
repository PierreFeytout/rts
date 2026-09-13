# CLAUDE.md

A grim-dark 2.5D isometric RTS, "the Ashworks": deterministic lockstep, peer-hosted
multiplayer, shipped as an Electron desktop app. The setting and art direction are
in UNIVERSE.md; the model pipeline and its rules are in
packages/client/assets/models/README.md.

## 3D models: the quality bar

**Every unit and building model must be at least as detailed as the Conscript**
(`scripts/models/conscript.py`). Never deliver anything simpler — new models,
reworked models, both races.

- Dozens of modelled pieces, using the whole triangle budget. Not a dozen boxes.
- Textures baked from the procedural surfaces in `scripts/models/surfaces.py`
  (colour, roughness, normal, with wear, grime and relief). Never flat colours.
- One baked material plus one emissive; team mask as a vertex attribute.
- Verified in the running game at playing zoom and close up before calling it done.

The Servitor (`vanguard.drone`, flat colours) and the procedural silhouettes are
below the bar and due to be rebuilt. They are not a reference.
