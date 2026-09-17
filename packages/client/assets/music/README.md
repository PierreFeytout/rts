# Music

Put tracks in this folder -- `.mp3`, `.ogg`, `.wav`, `.m4a` or `.flac` -- and say
where each one plays in `music.json`, beside this file. Nothing else to register:
the game finds the files at build time and reads the configuration at startup.

A track not listed in `music.json` never plays. A mistake in `music.json` costs
the entry it is in, not the music: the game prints what is wrong, naming the
entry, in the browser console (or in the terminal when the desktop build runs
with `RTS_VERBOSE=1`), and plays everything else.

## music.json

```json
{
  "crossfade": 3,
  "shuffle": true,
  "moods": { "tension": 0.15, "combat": 0.45, "peril": 0.35, "calmAfter": 20 },
  "tracks": [
    { "file": "main-theme.mp3", "play": ["menu.main"] },
    { "file": "lobby.mp3", "play": ["menu.lobby", "menu.skirmish"], "volume": 0.8 },
    { "file": "ashfall.mp3", "play": ["match.calm"], "races": ["vanguard"] },
    { "file": "the-long-dig.mp3", "play": ["match.calm", "match.tension"] },
    { "file": "breach.mp3", "play": ["match.combat"] },
    { "file": "last-shift.mp3", "play": ["match.peril"] },
    { "file": "holds-the-works.mp3", "play": ["match.victory"] },
    { "file": "written-off.mp3", "play": ["match.defeat"] }
  ]
}
```

Every setting is optional except `tracks`.

| Setting | Default | Meaning |
|---|---|---|
| `crossfade` | `3` | Seconds one track takes to fade into the next, whenever the music changes. |
| `shuffle` | `true` | When a slot has several tracks, play them in a random order rather than as listed. |
| `moods` | see below | When a match counts as tense, a battle, or going badly. |
| `tracks` | | The list of tracks. |

### A track

| Field | Required | Meaning |
|---|---|---|
| `file` | yes | The file's name in this folder. |
| `play` | yes | The slots it plays in: one name, or a list. |
| `races` | no | Only for these races: a list of race ids. Leave it out for music any race hears. |
| `volume` | no | `0` to `2`, default `1`. Evens out tracks mastered at different levels. |

When a slot has several tracks they play one after another, reshuffled each time
round if `shuffle` is on; a slot with one track plays it again, which is a loop.

### Slots

| Slot | Plays | When it has no tracks, plays |
|---|---|---|
| `menu` | any menu with nothing more specific | nothing |
| `menu.main` | the title screen | `menu` |
| `menu.skirmish` | setting up a match against the computer | `menu.main` |
| `menu.multiplayer` | choosing to host or join | `menu.main` |
| `menu.join` | typing an address to join | `menu.multiplayer` |
| `menu.lobby` | a multiplayer lobby, hosting or joined | `menu.multiplayer` |
| `menu.replays` | picking a replay | `menu.main` |
| `menu.settings` | the settings pages, from the main menu | `menu.main` |
| `match` | any match with nothing more specific | nothing |
| `match.calm` | a match with no fighting near you | `match` |
| `match.tension` | shots being exchanged | `match.calm` |
| `match.combat` | a real battle | `match.tension` |
| `match.peril` | losing units and buildings | `match.combat` |
| `match.victory` | you won | `match.calm` |
| `match.defeat` | you lost | `match.calm` |

The fallbacks mean a soundtrack can start with two entries -- one for `menu`, one
for `match` -- and be refined one slot at a time. Moving between two slots that
share the track already playing does not restart it.

### Races

`races` takes race ids: `vanguard` is the Ashen Directorate, `concord` the
Verdigris. In a match, a track for the player's race is preferred over one for
everyone in the same slot, and a track for another race is never played. Menus
have no race, so a race-only track does not play in them.

### Moods

A match's mood comes from what is happening to the player's own units: shots
fired by them or at them raise **tension**, which fades by half every six
seconds; units lost raise **peril**, which fades by half every twenty-five.

| Setting | Default | Meaning |
|---|---|---|
| `tension` | `0.15` | Tension, 0 to 1, above which a match is no longer calm. |
| `combat` | `0.45` | Tension above which it is a battle. About a sustained exchange of a dozen shots. |
| `peril` | `0.35` | Peril above which it is going badly. About three units lost in quick succession. |
| `calmAfter` | `20` | Seconds of lull before the music follows the fighting back down. |

The music moves up to a more intense mood at once, and back down only once the
lull has lasted `calmAfter`, so it does not drop out between two volleys of the
same fight.
