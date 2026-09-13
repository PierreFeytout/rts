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

## Buildings

**The Bastion (`scripts/models/bastion.py`) is the reference for every
structure**, on top of the Conscript's bar. Read the Structures section of
packages/client/assets/models/README.md before starting one.

- **Every building is animated**: a `build` clip scrubbed by construction
  progress, `idle`, and `produce` plus `release` for anything that trains
  units. When the simulation gains research, buildings get a research clip
  driven the same way `produce` is.
- **Construction says what the race is** (UNIVERSE.md): Directorate buildings
  are dropped and unfold; Verdigris structures grow through what was there.
- Built in tiles at the real footprint, `structure_surfaces(scale=6.0)`,
  detail and paint on the faces the camera sees (+X and -Y in Blender).
- "Verified in the game" includes the animations: construction at several
  stages, production, and a unit coming out, captured with `window.__rts` as
  the README describes.
- Design each building from UNIVERSE.md -- what it was, what it is now, what
  it does in the match -- and write that into the script's docstring before
  modelling, as bastion.py does.
