import { desktop } from "../desktop.js";
import { playerName } from "../identity.js";
import { chooseFrom } from "./shell.js";

/**
 * The menu tree: the title screen, and the rooms off it.
 *
 * Both of these used to carry their own markup, the player's name and two
 * volume sliders, because there was nowhere else to put any of it. There is
 * now: the shape of a screen is in shell.ts and the settings are a menu of
 * their own, so what is left here is the tree itself -- which choices there
 * are, and which lead where. That is the only thing this file should be, and
 * it is now short enough to read in one go.
 *
 *   title ─┬─ Skirmish        ─ setup ─ match
 *          ├─ Multiplayer ─┬─ Host     ─ lobby ─ match
 *          │               └─ Join     ─ lobby ─ match
 *          ├─ Watch a replay
 *          ├─ Settings ─ player · audio · camera · display
 *          └─ Quit                        (desktop only)
 */

export type MenuChoice = "skirmish" | "multiplayer" | "replay" | "settings" | "quit";
export type MultiplayerChoice = "host" | "join" | "back";

export function showMenu(): Promise<MenuChoice> {
  return chooseFrom<MenuChoice>({
    // No heading: the game's name is above the card, and a second title under
    // it would be the same screen saying its own name twice.
    sub: `playing as ${playerName()}`,
    entries: [
      {
        value: "skirmish",
        label: "Skirmish",
        note: "One match against the computer.",
        primary: true,
      },
      {
        value: "multiplayer",
        label: "Multiplayer",
        note: "Host a game for friends, or join one.",
      },
      { value: "replay", label: "Watch a replay", note: "Open a match somebody recorded." },
      { value: "settings", label: "Settings", note: "Your name, the sound, the camera, the display." },
      ...(desktop ? [{ value: "quit" as const, label: "Quit" }] : []),
    ],
  });
}

export function showMultiplayerMenu(): Promise<MultiplayerChoice> {
  return chooseFrom<MultiplayerChoice>({
    title: "Multiplayer",
    sub: "no server, no accounts — one of you runs the match",
    back: "back",
    entries: [
      {
        value: "host",
        label: "Host a game",
        note: desktop
          ? "Your machine runs the match. It ends when you close the game."
          : "Only the desktop app can accept connections.",
        primary: true,
        // A browser cannot open a listening socket. That is the entire reason
        // this is a desktop application, and saying so is better than a button
        // that fails in a way nobody can act on.
        ...(desktop ? {} : { disabled: "hosting needs the desktop app" }),
      },
      { value: "join", label: "Join a game", note: "You will need your friend's address." },
    ],
  });
}
