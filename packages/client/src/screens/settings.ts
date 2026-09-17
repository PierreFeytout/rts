import { music } from "../audio/music.js";
import { sfx } from "../audio/sfx.js";
import { MAX_NAME, playerName, setPlayerName } from "../identity.js";
import { RANGES, settings } from "../settings.js";
import {
  Panel,
  choiceSetting,
  chooseFrom,
  quiet,
  sliderSetting,
  textSetting,
  toggleSetting,
} from "./shell.js";

/**
 * Settings: one menu, four pages.
 *
 * Pages rather than one long list, because the four groups are asked about at
 * different times -- a name once, the volumes when something is too loud, the
 * camera in the first five minutes, the render scale when the frame rate is
 * wrong -- and a player looking for one of them should not have to read the
 * other three.
 *
 * The same screens open from the main menu and from the middle of a match;
 * `overlay` is the only difference, and it only changes what is behind them.
 * There is nothing to apply and nothing to confirm: every row writes its
 * setting as it is moved, and whatever is running is listening (see
 * settings.ts). A player dragging the render scale sees the match behind the
 * menu change under their hand, which is the only honest way to choose it.
 *
 * Volumes are not in the settings store: music and effects each own their own
 * level and remember it themselves. This is a view of them, not a second copy.
 */

type Page = "player" | "audio" | "camera" | "display" | "back";

/** Walk the settings pages until the player leaves. */
export async function showSettings(overlay = false): Promise<void> {
  for (;;) {
    const page = await chooseFrom<Page>({
      title: "Settings",
      sub: "kept between matches, and between sessions",
      overlay,
      back: "back",
      entries: [
        { value: "player", label: "Player", note: "The name friends see in the lobby." },
        { value: "audio", label: "Audio", note: "Music and effects." },
        { value: "camera", label: "Camera", note: "How the view moves and zooms." },
        { value: "display", label: "Display", note: "Render scale, and what is drawn over the match." },
      ],
    });
    if (page === "back") return;
    await PAGES[page](overlay);
  }
}

const PAGES: Record<Exclude<Page, "back">, (overlay: boolean) => Promise<void>> = {
  player: (overlay) =>
    page("Player", "who you are, to everyone else", overlay, [
      textSetting(
        "Name",
        "Shown in the lobby and to whoever you play against.",
        MAX_NAME,
        playerName,
        setPlayerName,
      ),
    ]),

  audio: (overlay) =>
    page("Audio", "the soundtrack, and everything the match makes", overlay, [
      sliderSetting("Music", "", percent, () => music.volume, (v) => music.setVolume(v)),
      toggleSetting(
        "Play music",
        "Off silences the soundtrack without forgetting the level.",
        () => !music.isMuted,
        () => music.toggleMute(),
      ),
      sliderSetting(
        "Effects",
        "",
        {
          ...percent,
          // Let go of the slider and hear the level it is at -- which is the
          // only way to set an effects level, and why this one settles.
          onSettle: () => sfx.play(["ui.click", "ui"]),
        },
        () => sfx.volume,
        (v) => sfx.setVolume(v),
      ),
      toggleSetting(
        "Play effects",
        "Weapons, impacts, buildings and the interface.",
        () => !sfx.isMuted,
        () => sfx.toggleMute(),
      ),
    ]),

  camera: (overlay) =>
    page("Camera", "how the view follows you around the map", overlay, [
      toggleSetting(
        "Edge scrolling",
        "Pan when the pointer rests against the edge of the screen.",
        () => settings.current.edgeScroll,
        (edgeScroll) => settings.set({ edgeScroll }),
      ),
      sliderSetting(
        "Pan speed",
        "Keys, edges and the minimap drag.",
        { min: RANGES.panSpeed[0], max: RANGES.panSpeed[1], step: 0.05, format: times },
        () => settings.current.panSpeed,
        (panSpeed) => settings.set({ panSpeed }),
      ),
      sliderSetting(
        "Zoom speed",
        "How far one notch of the wheel goes.",
        { min: RANGES.zoomSpeed[0], max: RANGES.zoomSpeed[1], step: 0.05, format: times },
        () => settings.current.zoomSpeed,
        (zoomSpeed) => settings.set({ zoomSpeed }),
      ),
      toggleSetting(
        "Invert zoom",
        "Wheel up pulls back, for anyone who reads the map as a map.",
        () => settings.current.invertZoom,
        (invertZoom) => settings.set({ invertZoom }),
      ),
    ]),

  display: (overlay) =>
    page("Display", "what is drawn, and how much of it", overlay, [
      choiceSetting(
        "Render scale",
        "Below 100% the match renders smaller and is scaled up. Frames, for sharpness.",
        [
          { value: 0.5, label: "50% — fastest" },
          { value: 0.75, label: "75%" },
          { value: 1, label: "100% — as the screen is" },
          { value: 1.5, label: "150%" },
          { value: 2, label: "200% — sharpest" },
        ],
        () => settings.current.renderScale,
        (renderScale) => settings.set({ renderScale }),
      ),
      toggleSetting(
        "Performance readout",
        "Frames, tick, entities and the state hash. Also toggled in a match with the key above Tab.",
        () => settings.current.showStats,
        (showStats) => settings.set({ showStats }),
      ),
      toggleSetting(
        "Control reminders",
        "The line of hints under the console.",
        () => settings.current.showHints,
        (showHints) => settings.set({ showHints }),
      ),
    ]),
};

const percent = { min: 0, max: 1, step: 0.01, format: (v: number) => `${Math.round(v * 100)}%` };
const times = (v: number): string => `${v.toFixed(2)}×`;

/** One page of settings rows, until the player goes back. */
function page(title: string, sub: string, overlay: boolean, rows: HTMLElement[]): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      panel.close();
      resolve();
    };
    const panel = new Panel({ title, sub, overlay, onEscape: finish, foot: "changes apply at once" });
    for (const row of rows) panel.body.appendChild(row);
    panel.act(quiet("Back", finish));
  });
}
