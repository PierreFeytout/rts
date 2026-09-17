# Tools

Development tools for the game's content, served beside the game rather than
inside it:

```bash
npm run tools        # http://localhost:5174
```

Each tool is a page, and reads and writes the project's files through a small
API on the tools' own dev server. Nothing here ships with the game. Run the
game's dev server (`npm run dev`) at the same time and it reloads with whatever
a tool saves.

| Tool | Page | Writes |
|---|---|---|
| Sound effects | `/sfx.html` | `packages/client/assets/sfx` -- the sounds used, and `sfx.json` |

## Sound effects

Three columns:

- **Library** -- every sound in `art/sfx-library`, by folder, searchable. Click a
  name to listen; its length and peak level appear once heard. `+` adds it to
  the selected action; `×N` is how many actions use it.
- **Actions** -- everything the game can ask a sound for, from the game's own
  catalogue (`soundCatalog` in packages/client/src/audio/sfx-config.ts), so
  every unit and building is listed with no list to maintain. Each shows its own
  sounds, the more general action it falls back to (`↳ shot.kinetic`), or
  silence.
- **Selected action** -- its fallback chain, its variations, and its settings:
  volume, random pitch spread, voices at once, and the minimum gap between two
  plays. *Test as in game* plays it the way the game does; *Burst of 8* plays
  eight in half a second through the voice and gap limits, which is what a squad
  firing sounds like.

The header holds the overall effects level and voice cap, which are saved, and
a listening level, which is not -- it starts at 50%, the game's default effects
volume, so what is heard here is what a player hears.

**Save** copies each sound used from the library into the game's folder, writes
`sfx.json`, and deletes any sound in the game's folder nothing uses. Sounds put
in the game's folder by hand, not in the library, are listed under their own
heading and kept while used.

## Adding a tool

A page (`<name>.html`, with its script under `src/<name>/`), a link on
`index.html`, and -- if it touches disk -- a plugin under `server/` registered in
`vite.config.ts`. Share the game's own logic by importing it through `@client`,
`@rts/content` and `@rts/sim` rather than copying it, so a tool can never
disagree with the game about what it is editing. Any path a server plugin
writes must be checked to stay inside its folder.
