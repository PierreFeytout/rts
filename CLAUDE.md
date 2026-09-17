# CLAUDE.md

A grim-dark 2.5D isometric RTS, "the Ashworks": deterministic lockstep, peer-hosted
multiplayer, shipped as an Electron desktop app. The setting and art direction are
in UNIVERSE.md; the model pipeline and its rules are in
packages/client/assets/models/README.md.

## Tools

`npm run tools` serves the project's content tools at http://localhost:5174
(packages/tools; its README says how to add one). Sound effects are assigned
with the sound effects tool there, from the library in art/sfx-library -- not
generated, and not chosen for the user.

## Interface

Every screen outside a match is built from `screens/shell.ts` -- the game's
name, one card, a footer -- and every menu is `chooseFrom`. Adding a screen
means adding a list of entries, never new markup or new colours.

- **A menu is a room, not a page.** Escape goes back from everywhere, the arrow
  keys and Enter work, and the first entry is focused when a menu opens.
- Settings are pages under one menu (player, audio, camera, display), the same
  ones from the title screen and from the in-game menu. They apply as they are
  moved -- nothing to confirm -- and live in `settings.ts`, which whatever is
  running subscribes to.
- **Nothing is added to a match screen in a corner.** What is not playing is
  behind Escape, in `screens/match-menu.ts`.
- Anything drawn over the match is built and removed with the match, never left
  in `index.html`, which holds the canvas and nothing else.
- Colours, type and spacing come from `ui.ts`. No hex codes anywhere else.

## Music

The soundtrack is the project's own recordings, never generated: files in
packages/client/assets/music, assigned to menus, match moods and races by
`music.json` there -- its README documents the format.

## 3D models: the quality bar

**Every unit and building model must be at least as detailed as the Conscript**
(`scripts/models/conscript.py`). Never deliver anything simpler â€” new models,
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
