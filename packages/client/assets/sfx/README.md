# Sound effects

**Use the sound effects tool** rather than editing this folder by hand:

```bash
npm run tools
```

then open http://localhost:5174/sfx.html. It lists every sound in the library
(`art/sfx-library`), plays them, and assigns them to what happens in a match;
Save copies the sounds used into this folder, writes `sfx.json`, and removes any
sound here nothing uses any more. Add sounds to the project by putting them in
`art/sfx-library` -- in a folder per pack, with its licence.

By hand works too: sounds go in this folder -- `.ogg`, `.wav`, `.mp3`, `.m4a`
or `.flac`, in sub-folders if you like -- and `sfx.json` says what each one is
for. The game decodes every sound `sfx.json` uses at startup.

A mistake in `sfx.json` costs the entry it is in: the game prints what is wrong,
naming the entry, in the browser console (or the terminal with `RTS_VERBOSE=1`),
and plays everything else.

## sfx.json

```json
{
  "volume": 1,
  "voices": 32,
  "sounds": {
    "shot": ["weapons/generic-1.ogg", "weapons/generic-2.ogg"],
    "shot.kinetic": { "files": ["weapons/rivet-1.ogg", "weapons/rivet-2.ogg"], "volume": 0.6, "pitch": 0.08, "voices": 6 },
    "shot.vanguard.turret": { "files": "weapons/plasma-projector.ogg", "voices": 3 },
    "impact.explosive": "impacts/blast.ogg",
    "death.unit": ["deaths/crumple-1.ogg", "deaths/crumple-2.ogg"],
    "death.building": { "files": "deaths/collapse.ogg", "volume": 1.4, "voices": 2 },
    "built": "structures/clamps-lock.ogg",
    "trained": "structures/door.ogg",
    "deposit": { "files": "economy/scrap-drop.ogg", "gap": 0.2 },
    "blocked.resources": "ui/denied.ogg",
    "order": "ui/acknowledge.ogg",
    "select.unit": "ui/select.ogg",
    "ui.click": "ui/click.ogg"
  }
}
```

| Setting | Default | Meaning |
|---|---|---|
| `volume` | `1` | Level of every effect, `0` to `2`. The player's own effects volume in the menu applies on top. |
| `voices` | `32` | At most this many effects at once, of all kinds. |
| `sounds` | | Sounds by key -- see below. |

A sound is a file, a list of files, or an object:

| Field | Default | Meaning |
|---|---|---|
| `files` | | A file, or a list of variations; one is picked at random each time. Paths are relative to this folder. |
| `volume` | `1` | `0` to `2`. |
| `pitch` | `0.05` | How far the playback rate is varied at random, either way: `0.08` is up to 8% higher or lower. Stops a repeated sound sounding like a loop. |
| `voices` | `4` | At most this many of this sound at once; further ones are dropped. |
| `gap` | `0.03` | Seconds that must pass between two starts of this sound. |

## Keys

The game asks for a sound by a list of keys, most specific first, and plays the
first that `sfx.json` has. So `"shot"` alone gives every weapon in the game a
sound, and `"shot.vanguard.turret"` gives the Gun Nest its own without changing
anything else.

| Family | Asked for, in order | When | Where |
|---|---|---|---|
| `shot` | `shot.<unit id>`, `shot.<race>`, `shot.kinetic` / `shot.plasma` / `shot.explosive`, `shot` | anything fires | at the shooter |
| `impact` | `impact.kinetic` / `.plasma` / `.explosive`, `impact` | a shot lands | at the target |
| `death` | `death.<unit id>`, `death.<race>`, `death.unit` / `death.building`, `death` | anything is destroyed | where it was |
| `built` | `built.<building id>`, `built.<race>`, `built` | a building is finished | at the building |
| `trained` | `trained.<unit id>`, `trained.<race>`, `trained` | a unit comes out of a building | at the building |
| `deposit` | `deposit` | one of your workers drops off alloy | at the drop-off |
| `blocked` | `blocked.resources` / `.supply` / `.space` / `.queue`, `blocked` | an order of yours is refused | interface |
| `order` | `order.move` / `.attack` / `.gather` / `.build` / `.train` / `.cancel` / `.rally` / `.stop` / `.hold`, `order` | you give an order | interface |
| `select` | `select.<unit id>`, `select.<race>`, `select.unit` / `select.building`, `select` | your selection changes | interface |
| `ui` | `ui.click` | a button is pressed | interface |

Unit and building ids are content ids -- `vanguard.trooper` is the Conscript,
`vanguard.turret` the Gun Nest; see packages/content/src/races/. Races are
`vanguard` (the Ashen Directorate) and `concord` (the Verdigris).

**Where** is how it is heard. A sound at a place on the map is at full volume
anywhere on screen, fades out past the edge of the screen, and is panned left to
right; an interface sound is centred and always heard.

**Nothing is heard that the player cannot see.** A shot, a death or a finished
building in the fog of war plays nothing, or the sound would tell the player
what the fog is hiding.
