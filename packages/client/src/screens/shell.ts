import { pushModal } from "../modal.js";
import { installStyles } from "../ui.js";

/**
 * The frame every screen outside the match is built in, and the controls that
 * go in it.
 *
 * There used to be one builder -- an empty card -- and each screen filled it
 * with its own markup, its own buttons and its own idea of what Back meant.
 * Four screens, four answers. This is the other half of what ui.ts did for the
 * colours: the *shape* of a screen, written once.
 *
 * What it buys, beyond looking like one game rather than four:
 *
 *   - Escape goes back, on every screen, without any of them saying so.
 *   - The keyboard works. Arrow keys walk the entries, Enter takes one, and
 *     the first entry is focused when a menu opens, so a player who never
 *     touches the mouse can start a match.
 *   - A sub-menu is a room in the same building: the game's name stays put,
 *     the card changes, and the way out is always in the same corner.
 *
 * Screens are built and thrown away rather than hidden. There is no state in
 * one worth keeping -- everything they show is read back from the settings,
 * the lobby or the match when they are built again.
 */

/** The game's name, and the line under it. Shown above every menu. */
const BRAND = "THE ASHWORKS";
const TAGLINE = "peer-to-peer · deterministic lockstep";
/** What the footer says when a screen does not say otherwise. */
const KEY_HINTS = "arrows choose · enter selects · esc goes back";

export interface PanelOptions {
  /** Heading on the card. Omitted on the title screen, where the name is it. */
  title?: string;
  sub?: string;
  wide?: boolean;
  /** Over a running match: dim it rather than replace it, and drop the name. */
  overlay?: boolean;
  /** The line under the card. Defaults to the keyboard hints. */
  foot?: string;
  /** Escape. Screens with no way back -- there are none -- may omit it. */
  onEscape?: () => void;
}

/**
 * One screen: the game's name, a card, and a footer.
 *
 * The caller owns `body` and fills it with whatever the screen is; `act` puts
 * buttons along the bottom, always in the same place.
 */
export class Panel {
  readonly root: HTMLDivElement;
  readonly card: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly actions: HTMLDivElement;
  private readonly release: (() => void) | null = null;

  constructor(options: PanelOptions = {}) {
    installStyles();

    this.root = document.createElement("div");
    this.root.className = options.overlay ? "rts-screen overlay" : "rts-screen";

    const stage = document.createElement("div");
    stage.className = "rts-stage";
    this.root.appendChild(stage);

    // The match is behind the in-game menu, and stamping the game's name over
    // it would read as having quit to the title screen.
    if (!options.overlay) {
      const brand = document.createElement("header");
      brand.className = "rts-brand";
      const name = document.createElement("h1");
      name.textContent = BRAND;
      const tagline = document.createElement("p");
      tagline.textContent = TAGLINE;
      brand.append(name, tagline);
      stage.appendChild(brand);
    }

    this.card = document.createElement("div");
    this.card.className = options.wide ? "rts-panel wide" : "rts-panel";
    stage.appendChild(this.card);

    if (options.title !== undefined) {
      const heading = document.createElement("h2");
      heading.textContent = options.title;
      this.card.appendChild(heading);
    }
    if (options.sub !== undefined) {
      const sub = document.createElement("p");
      sub.className = "sub";
      sub.textContent = options.sub;
      this.card.appendChild(sub);
    }

    this.body = document.createElement("div");
    this.card.appendChild(this.body);

    this.actions = document.createElement("div");
    this.actions.className = "rts-actions";

    const foot = document.createElement("p");
    foot.className = "rts-foot";
    foot.textContent = options.foot ?? KEY_HINTS;
    stage.appendChild(foot);

    document.body.appendChild(this.root);
    if (options.onEscape) this.release = pushModal(options.onEscape);
  }

  /**
   * Buttons along the bottom of the card.
   *
   * Anything passed before `null` is pushed to the left -- which is where Back
   * belongs, away from the button that commits.
   */
  act(...nodes: Array<HTMLElement | null>): void {
    let left = true;
    for (const node of nodes) {
      if (node === null) {
        left = false;
        continue;
      }
      if (left) node.classList.add("left");
      this.actions.appendChild(node);
    }
    this.card.appendChild(this.actions);
  }

  close(): void {
    this.release?.();
    this.root.remove();
  }
}

/**
 * A card with no heading of its own, for the screens that are a form rather
 * than a menu: match setup and the join screen.
 *
 * They keep their own markup -- both are a page of fields with a Back and a
 * commit button, which is not what `Panel.act` and the entry list are for --
 * but they are mounted in the same stage, so walking from a menu into one does
 * not move the game's name or change the background under it.
 */
export function screen(
  wide = false,
  onEscape?: () => void,
): { root: HTMLDivElement; panel: HTMLDivElement; close: () => void } {
  const panel = new Panel({ wide, foot: onEscape ? "esc goes back" : "", ...(onEscape ? { onEscape } : {}) });
  return { root: panel.root, panel: panel.card, close: () => panel.close() };
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export interface Entry<T> {
  value: T;
  label: string;
  /** One line under the label, for a choice that needs explaining. */
  note?: string;
  primary?: boolean;
  /** Why it cannot be chosen. Shown as the button's tooltip. */
  disabled?: string;
}

export interface MenuOptions<T> extends PanelOptions {
  entries: Array<Entry<T>>;
  /** What Escape and the Back button resolve with. No Back button without it. */
  back?: T;
  backLabel?: string;
  /**
   * Set false when the way out is already one of the entries -- Resume on the
   * in-game menu, Stay on the one that asks before leaving. Escape still works;
   * the same word twice on one screen does not read as two ways out, it reads
   * as a mistake.
   */
  backButton?: boolean;
}

/**
 * Show a list of choices, and resolve with the one taken.
 *
 * Every menu in the game is this function. A sub-menu is another call with
 * another list, which is what keeps "what is on the main menu" a question about
 * one array rather than about the markup of a screen.
 */
export function chooseFrom<T>(options: MenuOptions<T>): Promise<T> {
  return new Promise((resolve) => {
    const back = options.back;
    const finish = (value: T): void => {
      panel.close();
      resolve(value);
    };

    const panel = new Panel({
      ...options,
      ...(back === undefined ? {} : { onEscape: () => finish(back) }),
    });

    const list = document.createElement("div");
    list.className = "rts-entries";
    panel.body.appendChild(list);

    for (const entry of options.entries) {
      const button = document.createElement("button");
      button.className = entry.primary ? "rts-entry primary" : "rts-entry";
      button.disabled = entry.disabled !== undefined;
      if (entry.disabled !== undefined) button.title = entry.disabled;

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = entry.label;
      button.appendChild(label);

      if (entry.note !== undefined) {
        const note = document.createElement("span");
        note.className = "note";
        note.textContent = entry.note;
        button.appendChild(note);
      }

      button.onclick = () => finish(entry.value);
      list.appendChild(button);
    }

    if (back !== undefined && options.backButton !== false) {
      panel.act(quiet(options.backLabel ?? "Back", () => finish(back)));
    }

    walkWithArrows(list);
  });
}

/**
 * Arrow keys move between the entries of a menu.
 *
 * Bound to the list rather than to the window, so it is the focused menu that
 * moves and not every menu that happens to be open behind it. Enter and Space
 * need no help: the entries are buttons.
 */
function walkWithArrows(list: HTMLDivElement): void {
  const live = (): HTMLButtonElement[] => [
    ...list.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
  ];

  list.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const buttons = live();
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    // Wraps, because a menu is a ring: down from the last entry is the first.
    buttons[(at + step + buttons.length) % buttons.length].focus();
  });

  // Opening a menu with the first choice already under the finger is the
  // difference between a menu that can be used from the keyboard and one that
  // cannot.
  live()[0]?.focus();
}

// ---------------------------------------------------------------------------
// Buttons and settings rows
// ---------------------------------------------------------------------------

export function button(label: string, onClick: () => void, kind = ""): HTMLButtonElement {
  const element = document.createElement("button");
  element.className = kind;
  element.textContent = label;
  element.onclick = onClick;
  return element;
}

export const quiet = (label: string, onClick: () => void): HTMLButtonElement =>
  button(label, onClick, "quiet");
export const primary = (label: string, onClick: () => void): HTMLButtonElement =>
  button(label, onClick, "primary");

/**
 * One setting: what it is on the left, the control that changes it in the
 * middle, and its current value at the end of the row.
 *
 * Every setting is this shape, so a page of them is a column rather than a
 * layout problem, and the values line up to be read down.
 */
export function settingRow(
  name: string,
  note: string,
  control: HTMLElement,
  value?: HTMLElement,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "rts-setting";

  const text = document.createElement("div");
  const title = document.createElement("div");
  title.className = "name";
  title.textContent = name;
  text.appendChild(title);
  if (note) {
    const hint = document.createElement("div");
    hint.className = "note";
    hint.textContent = note;
    text.appendChild(hint);
  }

  row.append(text, control, value ?? document.createElement("span"));
  return row;
}

/** A setting that is on or off, as a button that says which it is. */
export function toggleSetting(
  name: string,
  note: string,
  get: () => boolean,
  set: (on: boolean) => void,
): HTMLDivElement {
  const control = document.createElement("button");
  const paint = (): void => {
    const on = get();
    control.textContent = on ? "on" : "off";
    control.setAttribute("aria-pressed", String(on));
  };
  control.onclick = () => {
    set(!get());
    paint();
  };
  paint();
  return settingRow(name, note, control);
}

export interface SliderOptions {
  min: number;
  max: number;
  step: number;
  /** How the number is read back to the player. */
  format?: (value: number) => string;
  /** Called when the player lets go, for a setting worth hearing or seeing. */
  onSettle?: (value: number) => void;
}

/** A setting that is a number, changing as it is dragged. */
export function sliderSetting(
  name: string,
  note: string,
  options: SliderOptions,
  get: () => number,
  set: (value: number) => void,
): HTMLDivElement {
  const control = document.createElement("input");
  control.type = "range";
  control.min = String(options.min);
  control.max = String(options.max);
  control.step = String(options.step);
  control.value = String(get());

  const readout = document.createElement("span");
  readout.className = "value";
  const show = (value: number): void => {
    readout.textContent = options.format ? options.format(value) : String(value);
  };
  show(get());

  // `input`, not `change`: the player is watching -- or listening -- while they
  // drag, and a setting that only lands on release cannot be aimed.
  control.oninput = () => {
    const value = Number(control.value);
    set(value);
    show(value);
  };
  if (options.onSettle) control.onchange = () => options.onSettle?.(Number(control.value));

  return settingRow(name, note, control, readout);
}

/** A setting with a handful of named values. */
export function choiceSetting<T extends string | number>(
  name: string,
  note: string,
  choices: ReadonlyArray<{ value: T; label: string }>,
  get: () => T,
  set: (value: T) => void,
): HTMLDivElement {
  const control = document.createElement("select");
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = String(choice.value);
    option.textContent = choice.label;
    option.selected = choice.value === get();
    control.appendChild(option);
  }
  control.onchange = () => {
    const picked = choices.find((choice) => String(choice.value) === control.value);
    if (picked) set(picked.value);
  };
  return settingRow(name, note, control);
}

/** A setting that is typed. Saved as it is typed, like every other row here. */
export function textSetting(
  name: string,
  note: string,
  maxLength: number,
  get: () => string,
  set: (value: string) => void,
): HTMLDivElement {
  const control = document.createElement("input");
  control.type = "text";
  control.maxLength = maxLength;
  control.autocomplete = "off";
  control.spellcheck = false;
  control.value = get();
  control.oninput = () => set(control.value);
  return settingRow(name, note, control);
}
