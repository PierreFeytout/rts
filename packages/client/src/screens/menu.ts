import { music } from "../audio/music.js";
import { sfx } from "../audio/sfx.js";
import { MAX_NAME, playerName, setPlayerName } from "../identity.js";
import { desktop } from "../desktop.js";
import { escapeHtml, screen } from "../ui.js";

/**
 * The landing screen, and the multiplayer sub-menu behind it.
 *
 * Both are the same shape -- a title and a column of choices -- so they are one
 * builder rather than two files that would drift apart.
 *
 * The player's name lives here rather than on the setup screens, because it is
 * a property of the person and not of the match. Asking for it once, on the
 * screen everything starts from, is what stops it being asked for again on the
 * host screen and the join screen.
 */

export type MenuChoice = "skirmish" | "multiplayer" | "replay" | "quit";
export type MultiplayerChoice = "host" | "join" | "back";

interface Entry<T> {
  value: T;
  label: string;
  /** One line under the button. Absent for entries that explain themselves. */
  note?: string;
  primary?: boolean;
  disabled?: string;
}

export function showMenu(): Promise<MenuChoice> {
  return choose<MenuChoice>({
    title: "RTS",
    sub: "peer-to-peer · deterministic lockstep",
    name: true,
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
      { value: "replay", label: "Watch a replay" },
      ...(desktop ? [{ value: "quit" as const, label: "Quit" }] : []),
    ],
  });
}

export function showMultiplayerMenu(): Promise<MultiplayerChoice> {
  return choose<MultiplayerChoice>({
    title: "Multiplayer",
    sub: "no server, no accounts — one of you runs the match",
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
      { value: "back", label: "Back" },
    ],
  });
}

interface ChooseOptions<T> {
  title: string;
  sub: string;
  entries: Array<Entry<T>>;
  /** Show the name field. Only the landing screen does. */
  name?: boolean;
}

function choose<T extends string>(options: ChooseOptions<T>): Promise<T> {
  return new Promise((resolve) => {
    const { root, panel } = screen();

    panel.innerHTML =
      `<h1>${escapeHtml(options.title)}</h1>` +
      `<p class="sub">${escapeHtml(options.sub)}</p>` +
      (options.name
        ? `<label class="rts-field"><span>your name</span>` +
          `<input id="menu-name" maxlength="${MAX_NAME}" autocomplete="off" spellcheck="false" ` +
          `value="${escapeHtml(playerName())}" /></label>` +
          // On the landing screen only. It is a property of the person, like
          // their name, rather than of any one match -- and this is the screen
          // everything starts from, so it is always one step away.
          `<label class="rts-field"><span>music</span>` +
          `<div class="rts-row"><input id="menu-volume" type="range" min="0" max="100" ` +
          `step="1" value="${Math.round(music.volume * 100)}" style="flex:1" />` +
          `<button class="quiet" id="menu-mute" style="padding:6px 12px;min-width:74px">` +
          `${music.isMuted ? "unmute" : "mute"}</button></div></label>` +
          `<label class="rts-field"><span>effects</span>` +
          `<div class="rts-row"><input id="menu-sfx-volume" type="range" min="0" max="100" ` +
          `step="1" value="${Math.round(sfx.volume * 100)}" style="flex:1" />` +
          `<button class="quiet" id="menu-sfx-mute" style="padding:6px 12px;min-width:74px">` +
          `${sfx.isMuted ? "unmute" : "mute"}</button></div></label><hr />`
        : "") +
      options.entries
        .map(
          (entry, i) =>
            `<button class="block ${entry.primary ? "primary" : ""}" data-i="${i}"` +
            `${entry.disabled ? ` disabled title="${escapeHtml(entry.disabled)}"` : ""}>` +
            `${escapeHtml(entry.label)}</button>` +
            (entry.note ? `<p class="rts-note" style="margin:-4px 0 12px">${escapeHtml(entry.note)}</p>` : ""),
        )
        .join("");

    const volume = panel.querySelector<HTMLInputElement>("#menu-volume");
    const mute = panel.querySelector<HTMLButtonElement>("#menu-mute");
    if (volume) {
      // `input`, not `change`: the player is listening while they drag, and the
      // whole point of a volume slider is that it moves the volume.
      volume.oninput = () => music.setVolume(Number(volume.value) / 100);
    }
    if (mute) {
      mute.onclick = () => {
        mute.textContent = music.toggleMute() ? "unmute" : "mute";
      };
    }
    const sfxVolume = panel.querySelector<HTMLInputElement>("#menu-sfx-volume");
    const sfxMute = panel.querySelector<HTMLButtonElement>("#menu-sfx-mute");
    if (sfxVolume) {
      sfxVolume.oninput = () => sfx.setVolume(Number(sfxVolume.value) / 100);
      // Let go of the slider and hear the level it is at.
      sfxVolume.onchange = () => sfx.play(["ui.click"]);
    }
    if (sfxMute) {
      sfxMute.onclick = () => {
        sfxMute.textContent = sfx.toggleMute() ? "unmute" : "mute";
      };
    }

    const nameInput = panel.querySelector<HTMLInputElement>("#menu-name");
    // Saved on the way out rather than on every keystroke, and before the
    // choice resolves, so the setup screen that follows already sees it.
    const finish = (value: T): void => {
      if (nameInput) setPlayerName(nameInput.value);
      root.remove();
      resolve(value);
    };

    for (const button of panel.querySelectorAll<HTMLButtonElement>("button[data-i]")) {
      button.onclick = () => finish(options.entries[Number(button.dataset.i)].value);
    }
  });
}
