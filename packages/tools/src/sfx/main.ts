import { FAMILIES, FAMILY_INFO, soundCatalog, type CatalogEntry } from "@client/audio/sfx-config.js";
import { defaultContent } from "@rts/content";
import { CAN_ATTACK, KIND_BUILDING } from "@rts/sim";

/**
 * The sound effects tool: list the library, listen, and assign sounds to what
 * happens in a match.
 *
 * The actions are the game's own catalogue (sfx-config.ts), built from content,
 * so every unit and building the game has is here with the chain of keys it
 * falls back along -- assigning `shot.kinetic` visibly gives every kinetic
 * weapon without its own sound that one. Nothing is written until Save, which
 * copies the sounds used into the game's folder and writes sfx.json there; see
 * server/sfx-api.ts.
 */

interface Entry {
  files: string[];
  volume: number;
  pitch: number;
  voices: number;
  gap: number;
}

interface Working {
  volume: number;
  voices: number;
  sounds: Record<string, Entry>;
}

interface ServerState {
  library: string[];
  assets: string[];
  config: unknown;
}

/** What a sound newly given to an action starts with. Quieter than full: most sounds in a library are mastered hot. */
const NEW_ENTRY = { volume: 0.6, pitch: 0.05, voices: 4, gap: 0.03 };
/** sfx-config.ts's defaults, for entries sfx.json leaves partly unspecified. */
const PARSED_DEFAULTS = { volume: 1, pitch: 0.05, voices: 4, gap: 0.03 };

const catalog = soundCatalog(defaultContent, CAN_ATTACK, KIND_BUILDING);
const catalogByKey = new Map(catalog.map((entry) => [entry.key, entry]));

let library: string[] = [];
let assets = new Set<string>();
let working: Working = { volume: 1, voices: 32, sounds: {} };
let saved = "";
let selected: string | null = null;
let status: { text: string; tone?: "dirty" | "error" } = { text: "" };

const libraryFilter = { text: "", folder: "" };
const actionFilter = { text: "", show: "all" as "all" | "assigned" | "silent" };

// ---------------------------------------------------------------------------
// Listening
// ---------------------------------------------------------------------------

const ctx = new AudioContext();
const monitor = ctx.createGain();
// The game's default effects volume, so what is heard here is what a player hears.
monitor.gain.value = 0.5;
monitor.connect(ctx.destination);

const decoded = new Map<string, Promise<AudioBuffer>>();
const facts = new Map<string, { duration: number; peakDb: number }>();
const playing = new Set<AudioBufferSourceNode>();
const playingFiles = new Map<string, number>();

function urlFor(path: string): string {
  const from = library.includes(path) ? "library" : "assets";
  return `/api/sfx/file?from=${from}&path=${encodeURIComponent(path)}`;
}

function decode(path: string): Promise<AudioBuffer> {
  let pending = decoded.get(path);
  if (!pending) {
    pending = fetch(urlFor(path))
      .then((r) => {
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buffer) => {
        let peak = 0;
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          for (const sample of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(sample));
        }
        facts.set(path, { duration: buffer.duration, peakDb: 20 * Math.log10(Math.max(peak, 1e-6)) });
        updateFacts(path);
        return buffer;
      });
    decoded.set(path, pending);
  }
  return pending;
}

async function play(path: string, gain = 1, rate = 1, when = 0): Promise<AudioBufferSourceNode> {
  await ctx.resume();
  const source = ctx.createBufferSource();
  source.buffer = await decode(path);
  source.playbackRate.value = rate;
  const level = ctx.createGain();
  level.gain.value = gain;
  source.connect(level).connect(monitor);
  playing.add(source);
  playingFiles.set(path, (playingFiles.get(path) ?? 0) + 1);
  markPlaying(path);
  source.onended = () => {
    playing.delete(source);
    playingFiles.set(path, (playingFiles.get(path) ?? 1) - 1);
    markPlaying(path);
  };
  source.start(ctx.currentTime + when);
  return source;
}

function stopAll(): void {
  for (const source of playing) source.stop();
}

/** One play of an action, the way the game plays it: a random variation, its pitch spread, its level. */
function playAsInGame(entry: Entry, when = 0): void {
  const file = entry.files[Math.floor(Math.random() * entry.files.length)];
  const rate = 1 + (Math.random() * 2 - 1) * entry.pitch;
  void play(file, entry.volume * working.volume, rate, when);
}

/**
 * Eight shots in half a second, through the game's limits -- the gap between
 * starts and the voice cap -- which is what a squad firing sounds like.
 */
async function burst(entry: Entry): Promise<void> {
  await ctx.resume();
  let last = -Infinity;
  const ends: number[] = [];
  for (let k = 0; k < 8; k++) {
    const at = k * 0.065;
    if (at - last < entry.gap) continue;
    if (ends.filter((end) => end > at).length >= entry.voices) continue;
    const file = entry.files[Math.floor(Math.random() * entry.files.length)];
    const duration = (await decode(file)).duration;
    last = at;
    ends.push(at + duration);
    void play(file, entry.volume * working.volume, 1 + (Math.random() * 2 - 1) * entry.pitch, at);
  }
}

// ---------------------------------------------------------------------------
// The configuration
// ---------------------------------------------------------------------------

function fromConfig(raw: unknown): Working {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const sounds: Record<string, Entry> = {};
  const listed = (typeof input.sounds === "object" && input.sounds !== null ? input.sounds : {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(listed)) {
    const entry = (typeof value === "string" || Array.isArray(value) ? { files: value } : value) as Record<string, unknown>;
    const files = typeof entry.files === "string" ? [entry.files] : Array.isArray(entry.files) ? entry.files.filter((f) => typeof f === "string") : [];
    sounds[key] = {
      files,
      volume: typeof entry.volume === "number" ? entry.volume : PARSED_DEFAULTS.volume,
      pitch: typeof entry.pitch === "number" ? entry.pitch : PARSED_DEFAULTS.pitch,
      voices: typeof entry.voices === "number" ? entry.voices : PARSED_DEFAULTS.voices,
      gap: typeof entry.gap === "number" ? entry.gap : PARSED_DEFAULTS.gap,
    };
  }
  return {
    volume: typeof input.volume === "number" ? input.volume : 1,
    voices: typeof input.voices === "number" ? input.voices : 32,
    sounds,
  };
}

/** What sfx.json will say: keys without sounds are left out, and keys are in catalogue order. */
function toConfig(): Working {
  const order = new Map(catalog.map((entry, index) => [entry.key, index]));
  const keys = Object.keys(working.sounds)
    .filter((key) => working.sounds[key].files.length > 0)
    .sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b));
  const sounds: Record<string, Entry> = {};
  for (const key of keys) {
    const { files, volume, pitch, voices, gap } = working.sounds[key];
    sounds[key] = { files, volume: round(volume), pitch: round(pitch), voices, gap: round(gap) };
  }
  return { volume: round(working.volume), voices: working.voices, sounds };
}

function isDirty(): boolean {
  return JSON.stringify(toConfig()) !== saved;
}

/** The first key in `entry`'s chain that has sounds, if any. */
function resolved(entry: CatalogEntry): string | null {
  return entry.chain.find((key) => (working.sounds[key]?.files.length ?? 0) > 0) ?? null;
}

async function load(): Promise<void> {
  const state = (await (await fetch("/api/sfx/state")).json()) as ServerState;
  apply(state);
}

function apply(state: ServerState): void {
  library = state.library;
  assets = new Set(state.assets);
  working = fromConfig(state.config);
  saved = JSON.stringify(toConfig());
  render();
}

async function save(): Promise<void> {
  status = { text: "saving…" };
  renderTop();
  const response = await fetch("/api/sfx/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: toConfig() }),
  });
  const body = (await response.json()) as ServerState & { error?: string };
  if (!response.ok) {
    status = { text: body.error ?? "save failed", tone: "error" };
    renderTop();
    return;
  }
  apply(body);
  status = { text: "saved — the game reloads with it" };
  renderTop();
}

function changed(): void {
  status = isDirty() ? { text: "unsaved changes", tone: "dirty" } : { text: "" };
  render();
}

function addToSelected(path: string): void {
  if (!selected) return;
  const entry = (working.sounds[selected] ??= { files: [], ...NEW_ENTRY });
  if (!entry.files.includes(path)) entry.files.push(path);
  changed();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const top = document.querySelector<HTMLElement>("#top")!;
const libraryPanel = document.querySelector<HTMLElement>("#library")!;
const actionsPanel = document.querySelector<HTMLElement>("#actions")!;
const editorPanel = document.querySelector<HTMLElement>("#editor")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function render(): void {
  renderTop();
  renderLibrary();
  renderActions();
  renderEditor();
}

function renderTop(): void {
  const saveButton = el("button", { className: "primary", textContent: "Save", disabled: !isDirty(), onclick: () => void save() });
  const revert = el("button", { textContent: "Revert", disabled: !isDirty(), onclick: () => void load().then(() => changed()) });
  top.replaceChildren(
    el("a", { href: "/", textContent: "tools" }),
    el("h1", { textContent: "Sound effects" }),
    slider("all effects", 0, 2, 0.05, working.volume, (v) => {
      working.volume = v;
      changed();
    }),
    slider("max voices", 1, 64, 1, working.voices, (v) => {
      working.voices = v;
      changed();
    }),
    slider("listening level", 0, 1, 0.05, monitor.gain.value, (v) => {
      monitor.gain.value = v;
    }, "Only here, not saved. 50% is the game's default effects volume."),
    el("button", { textContent: "Stop sounds", onclick: stopAll }),
    el("span", { className: `status ${status.tone ?? ""}`, textContent: status.text }),
    revert,
    saveButton,
  );
}

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (value: number) => void,
  title = "",
): HTMLLabelElement {
  const output = el("output", { textContent: format(value, step) });
  const input = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) });
  // Update the number while dragging; commit the change when released, so the
  // page is not re-rendered under the pointer.
  input.oninput = () => {
    output.textContent = format(Number(input.value), step);
  };
  input.onchange = () => onInput(Number(input.value));
  return el("label", { title }, label, input, output);
}

function renderLibrary(): void {
  const folders = [...new Set(library.map((path) => path.split("/")[0]))];
  if ([...assets].some((path) => !library.includes(path))) folders.push("in the game's folder only");
  const search = el("input", { type: "search", placeholder: "search sounds", value: libraryFilter.text });
  search.oninput = () => {
    libraryFilter.text = search.value;
    renderLibraryList(list);
  };
  const folder = el("select", {}, el("option", { value: "", textContent: "every folder" }));
  for (const name of folders) folder.append(el("option", { value: name, textContent: name, selected: name === libraryFilter.folder }));
  folder.onchange = () => {
    libraryFilter.folder = folder.value;
    renderLibraryList(list);
  };
  const list = el("div", { className: "scroll" });
  libraryPanel.replaceChildren(
    el("div", { className: "panel-head" },
      el("h2", { textContent: `Library · ${library.length} sounds` }),
      el("div", { className: "muted", textContent: "art/sfx-library — click a name to listen, + to add it to the selected action" }),
      el("div", { className: "row" }, search, folder)),
    list,
  );
  renderLibraryList(list);
}

function renderLibraryList(list: HTMLElement): void {
  const text = libraryFilter.text.toLowerCase();
  const usage = new Map<string, number>();
  for (const entry of Object.values(working.sounds)) for (const file of entry.files) usage.set(file, (usage.get(file) ?? 0) + 1);

  const rows: Node[] = [];
  let lastFolder = "";
  // Sounds put straight into the game's folder, not the library, are listed too.
  const gameOnly = [...assets].filter((path) => !library.includes(path));
  for (const path of [...library, ...gameOnly]) {
    const folderName = library.includes(path) ? path.split("/")[0] : "in the game's folder only";
    if (libraryFilter.folder && folderName !== libraryFilter.folder) continue;
    if (text && !path.toLowerCase().includes(text)) continue;
    if (folderName !== lastFolder) {
      rows.push(el("div", { className: "folder", textContent: folderName }));
      lastFolder = folderName;
    }
    rows.push(soundRow(path, usage.get(path) ?? 0, [
      el("button", {
        className: "icon",
        textContent: "+",
        title: selected ? `add to ${selected}` : "select an action first",
        disabled: !selected,
        onclick: () => addToSelected(path),
      }),
    ]));
  }
  if (rows.length === 0) rows.push(el("div", { className: "hint", textContent: "no sound matches" }));
  list.replaceChildren(...rows);
}

function soundRow(path: string, used: number, extra: Node[], label = basename(path)): HTMLElement {
  const known = facts.get(path);
  const row = el("div", { className: "sound" },
    el("button", { className: "icon", textContent: "▶", title: "listen", onclick: () => void play(path) }),
    el("span", { className: "name", textContent: label, title: path, onclick: () => void play(path) }),
    el("span", { className: "facts", textContent: known ? describe(known) : "" }),
    el("span", { className: "used", textContent: used ? `×${used}` : "", title: used ? `used by ${used} action(s)` : "" }),
    ...extra,
  );
  row.dataset.path = path;
  if ((playingFiles.get(path) ?? 0) > 0) row.classList.add("playing");
  return row;
}

function renderActions(): void {
  const search = el("input", { type: "search", placeholder: "search actions", value: actionFilter.text });
  search.oninput = () => {
    actionFilter.text = search.value;
    renderActionList(list);
  };
  const show = el("select", {},
    ...(["all", "assigned", "silent"] as const).map((value) =>
      el("option", { value, textContent: value === "all" ? "every action" : value === "assigned" ? "with their own sounds" : "silent", selected: value === actionFilter.show })));
  show.onchange = () => {
    actionFilter.show = show.value as typeof actionFilter.show;
    renderActionList(list);
  };
  const list = el("div", { className: "scroll" });
  actionsPanel.replaceChildren(
    el("div", { className: "panel-head" },
      el("h2", { textContent: "Actions" }),
      el("div", { className: "muted", textContent: "What the game can ask a sound for. Specific actions fall back to general ones." }),
      el("div", { className: "row" }, search, show)),
    list,
  );
  renderActionList(list);
}

function renderActionList(list: HTMLElement): void {
  const text = actionFilter.text.toLowerCase();
  const groups: Node[] = [];
  for (const family of FAMILIES) {
    const rows: Node[] = [];
    for (const entry of catalog) {
      if (entry.family !== family) continue;
      const own = (working.sounds[entry.key]?.files.length ?? 0) > 0;
      const from = resolved(entry);
      if (actionFilter.show === "assigned" && !own) continue;
      if (actionFilter.show === "silent" && from) continue;
      if (text && !`${entry.key} ${entry.label}`.toLowerCase().includes(text)) continue;

      const state = own
        ? el("span", { className: "state own", textContent: `${working.sounds[entry.key].files.length} sound${working.sounds[entry.key].files.length > 1 ? "s" : ""}` })
        : from
          ? el("span", { className: "state inherits", textContent: `↳ ${from}` })
          : el("span", { className: "state silent", textContent: "silent" });
      rows.push(el("div", {
        className: `action ${entry.key === selected ? "selected" : ""}`,
        onclick: () => {
          selected = entry.key;
          render();
        },
      }, el("span", { className: "label" }, entry.label, el("small", { textContent: entry.key })), state));
    }
    if (rows.length === 0) continue;
    const info = FAMILY_INFO[family];
    groups.push(el("details", { className: "family", open: true },
      el("summary", {}, el("h3", { textContent: info.label }), el("span", { className: "when", textContent: info.when })),
      ...rows));
  }
  if (groups.length === 0) groups.push(el("div", { className: "hint", textContent: "no action matches" }));
  list.replaceChildren(...groups);
}

function renderEditor(): void {
  const entry = selected ? catalogByKey.get(selected) : undefined;
  if (!selected || !entry) {
    editorPanel.replaceChildren(el("div", { className: "hint", textContent: "Select an action to give it sounds." }));
    return;
  }
  const sound = working.sounds[selected];
  const own = (sound?.files.length ?? 0) > 0;
  const from = resolved(entry);
  const body = el("div", { className: "body" });

  body.append(el("div", {},
    el("h2", { textContent: `${FAMILY_INFO[entry.family].label} · ${entry.label}` }),
    el("div", { className: "key", textContent: selected }),
    el("p", { className: "muted", textContent: `When ${FAMILY_INFO[entry.family].when}.` })));

  // The chain: which key actually answers, and a way to jump to each.
  body.append(el("div", {},
    el("p", { className: "muted", textContent: "The game asks for these in order and plays the first with sounds:" }),
    el("div", { className: "chain" }, ...entry.chain.flatMap((key, index) => [
      ...(index > 0 ? [el("span", { className: "muted", textContent: "→" })] : []),
      el("button", {
        className: key === from ? "active" : "",
        textContent: key,
        disabled: !catalogByKey.has(key),
        title: key === from ? "this is what plays" : "",
        onclick: () => {
          selected = key;
          render();
        },
      }),
    ])),
    el("p", { className: "muted", textContent: own ? "It has sounds of its own." : from ? `It plays ${from}'s sounds. Add sounds here to give it its own.` : "Nothing plays. Add sounds from the library." })));

  if (own && sound) {
    body.append(el("div", { className: "files" },
      el("h3", { textContent: `Variations · one is picked at random` }),
      ...sound.files.map((path) => soundRow(path, 0, [
        el("button", {
          className: "icon",
          textContent: "✕",
          title: "remove from this action",
          onclick: () => {
            sound.files = sound.files.filter((f) => f !== path);
            if (sound.files.length === 0) delete working.sounds[selected!];
            changed();
          },
        }),
      ], path))));

    body.append(el("div", {},
      setting("volume", 0, 2, 0.05, sound.volume, (v) => (sound.volume = v)),
      setting("pitch ±", 0, 0.5, 0.01, sound.pitch, (v) => (sound.pitch = v)),
      setting("voices", 1, 16, 1, sound.voices, (v) => (sound.voices = v)),
      setting("gap (s)", 0, 1, 0.01, sound.gap, (v) => (sound.gap = v))));

    body.append(el("div", { className: "buttons" },
      el("button", { className: "primary", textContent: "Test as in game", onclick: () => playAsInGame(sound) }),
      el("button", { textContent: "Burst of 8", title: "eight in half a second, through the gap and voice limits", onclick: () => void burst(sound) }),
      el("button", { textContent: "Stop", onclick: stopAll }),
      el("button", {
        textContent: "Remove all sounds",
        onclick: () => {
          delete working.sounds[selected!];
          changed();
        },
      })));
  } else if (from) {
    const inherited = working.sounds[from];
    body.append(el("div", { className: "buttons" },
      el("button", { textContent: `Test (${from})`, onclick: () => playAsInGame(inherited) })));
  }

  editorPanel.replaceChildren(el("div", { className: "panel-head" }, el("h2", { textContent: "Selected action" })), body);
}

function setting(label: string, min: number, max: number, step: number, value: number, set: (v: number) => void): HTMLElement {
  const output = el("output", { textContent: format(value, step) });
  const input = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) });
  input.oninput = () => {
    output.textContent = format(Number(input.value), step);
    set(Number(input.value));
    status = isDirty() ? { text: "unsaved changes", tone: "dirty" } : { text: "" };
    renderTop();
  };
  return el("div", { className: "setting" }, el("span", { textContent: label }), input, output);
}

function updateFacts(path: string): void {
  const known = facts.get(path);
  if (!known) return;
  for (const row of document.querySelectorAll<HTMLElement>(".sound")) {
    if (row.dataset.path === path) row.querySelector(".facts")!.textContent = describe(known);
  }
}

function markPlaying(path: string): void {
  const on = (playingFiles.get(path) ?? 0) > 0;
  for (const row of document.querySelectorAll<HTMLElement>(".sound")) {
    if (row.dataset.path === path) row.classList.toggle("playing", on);
  }
}

function describe(known: { duration: number; peakDb: number }): string {
  return `${known.duration.toFixed(2)}s · peak ${known.peakDb.toFixed(0)} dB`;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
}

function format(value: number, step: number): string {
  return step >= 1 ? String(Math.round(value)) : value.toFixed(2);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

window.addEventListener("beforeunload", (event) => {
  if (isDirty()) event.preventDefault();
});

void load().catch((error: unknown) => {
  status = { text: `could not load: ${error instanceof Error ? error.message : String(error)}`, tone: "error" };
  renderTop();
});
