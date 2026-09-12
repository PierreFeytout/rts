import { defaultContent } from "@rts/content";
import type { HostInfo } from "../desktop.js";
import { MAP_IDS, RACE_IDS, type MatchConfig, type SlotKind } from "../match.js";
import { TEAM_COLOURS, escapeHtml, screen } from "../ui.js";

/**
 * Match setup: map, player slots, races.
 *
 * One screen in three modes, because that is the requirement -- someone joining
 * a friend's game should see the game they are joining, not a different screen
 * that happens to lead to the same place. What changes between the modes is
 * only which controls are live:
 *
 *   skirmish  everything, and nobody can join
 *   host      everything, and the empty slots are open to friends
 *   guest     nothing but your own race
 *
 * The guest's read-only view is the point rather than a limitation. A lobby
 * where two people can both change the map is a lobby where they disagree about
 * which map they are on, and find out at the loading screen.
 */

export type SetupMode = "skirmish" | "host" | "guest";

export interface SetupOptions {
  mode: SetupMode;
  config: MatchConfig;
  /** Which row is the local player's. Always 0 outside guest mode. */
  localSlot: number;
  /** Host only: how friends reach this machine. Arrives after the screen does. */
  hostInfo?: HostInfo | undefined;
  /** The local player changed something the host owns. Not called in guest mode. */
  onConfigChange?: (config: MatchConfig) => void;
  /** The local player chose a race for themselves. */
  onPickRace: (raceId: string) => void;
  /** Host and skirmish only. */
  onStart?: () => void;
  onBack: () => void;
}

const TITLES: Record<SetupMode, { title: string; sub: string }> = {
  skirmish: { title: "Skirmish", sub: "one match, against the computer" },
  host: { title: "Host a game", sub: "friends join with the address below" },
  guest: { title: "Lobby", sub: "the host chooses the map — you choose your race" },
};

export class SetupScreen {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly options: SetupOptions;
  private config: MatchConfig;
  private localSlot: number;

  constructor(options: SetupOptions) {
    this.options = options;
    this.config = options.config;
    this.localSlot = options.localSlot;

    const built = screen(true);
    this.root = built.root;
    this.panel = built.panel;
    this.render();
  }

  /**
   * Fill in the address panel once the port is actually open.
   *
   * The screen is shown first and the address arrives a moment later, because
   * opening a port and asking a router to forward it can take seconds -- and a
   * blank screen for those seconds looks like the game has hung.
   */
  setHostInfo(info: HostInfo): void {
    this.options.hostInfo = info;
    this.render();
  }

  /** Replace what is shown, e.g. because the host changed the map. */
  update(config: MatchConfig, localSlot: number): void {
    this.config = config;
    this.localSlot = localSlot;
    this.render();
  }

  say(message: string, tone: "info" | "error" = "info"): void {
    const status = this.panel.querySelector<HTMLDivElement>("#setup-status");
    if (!status) return;
    status.textContent = message;
    status.className = tone === "error" ? "rts-status error" : "rts-status";
  }

  busy(on: boolean): void {
    this.panel.classList.toggle("busy", on);
  }

  close(): void {
    this.root.remove();
  }

  // -- rendering -------------------------------------------------------------

  /**
   * Rebuilt wholesale on every change rather than patched in place.
   *
   * The screen is a few dozen elements and changes only when a person clicks
   * something or a lobby message arrives. Diffing it would be machinery for its
   * own sake, and the failure mode of a half-patched lobby -- one row showing
   * the previous player's race -- is exactly the kind of thing this screen
   * exists to prevent.
   */
  private render(): void {
    const { mode } = this.options;
    const map = defaultContent.map(this.config.mapId);
    const editable = mode !== "guest";
    const heading = TITLES[mode];

    this.panel.innerHTML =
      `<h2>${escapeHtml(heading.title)}</h2>` +
      `<p class="sub">${escapeHtml(heading.sub)}</p>` +
      (mode === "host" ? this.addressPanel() : "") +
      `<label class="rts-field"><span>map</span>` +
      `<select id="setup-map" ${editable ? "" : "disabled"}>` +
      MAP_IDS.map((id) => {
        const m = defaultContent.map(id);
        return (
          `<option value="${escapeHtml(id)}" ${id === this.config.mapId ? "selected" : ""}>` +
          `${escapeHtml(m.name)} — ${m.size}×${m.size}, ${m.maxPlayers} players</option>`
        );
      }).join("") +
      `</select></label>` +
      `<p class="rts-note" style="margin:-8px 0 20px">${escapeHtml(map.blurb)}</p>` +
      `<div class="rts-field"><span>players</span>${this.slotRows()}</div>` +
      `<div id="setup-status" class="rts-status"></div>` +
      `<hr />` +
      `<div class="rts-row" style="justify-content:flex-end">` +
      `<button class="quiet" id="setup-back">Back</button>` +
      (mode === "guest"
        ? `<button disabled>Waiting for the host…</button>`
        : `<button class="primary" id="setup-start">Start</button>`) +
      `</div>`;

    this.wire();
  }

  private slotRows(): string {
    const map = defaultContent.map(this.config.mapId);
    let html = `<div style="display:grid;gap:6px">`;

    for (let player = 0; player < this.config.slots.length; player++) {
      // A map seats what it seats. Hiding the extra rows is clearer than
      // showing four and disabling two of them.
      if (player >= map.maxPlayers) continue;
      const slot = this.config.slots[player];
      const you = player === this.localSlot;

      html +=
        `<div class="rts-row" data-slot="${player}">` +
        `<span style="width:10px;height:10px;border-radius:2px;flex:none;` +
        `background:${TEAM_COLOURS[player]}"></span>` +
        `<select data-kind="${player}" style="width:120px" ${this.kindDisabled(player)}>` +
        this.kindOptions(slot.kind, you) +
        `</select>` +
        `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;` +
        `color:${you ? "var(--accent)" : "var(--muted)"}">${escapeHtml(this.slotLabel(player))}</span>` +
        `<select data-race="${player}" style="width:214px" ${this.raceDisabled(player)}>` +
        RACE_IDS.map((id) => {
          const race = defaultContent.race(id);
          return (
            `<option value="${escapeHtml(id)}" ${id === slot.raceId ? "selected" : ""}` +
            ` title="${escapeHtml(race.blurb)}">${escapeHtml(race.name)}</option>`
          );
        }).join("") +
        `</select></div>`;
    }

    return `${html}</div>`;
  }

  /** What the row says about who is in it. */
  private slotLabel(player: number): string {
    const slot = this.config.slots[player];
    if (player === this.localSlot) return `${slot.name} (you)`;
    if (slot.kind === "human") return slot.name;
    if (slot.kind === "computer") return "—";
    return this.options.mode === "host" ? "waiting for a player" : "—";
  }

  private kindOptions(kind: SlotKind, you: boolean): string {
    // The local player's own row is not a choice: you are playing, which is why
    // you are looking at this screen.
    if (you) return `<option value="human" selected>You</option>`;

    const empty = this.options.mode === "host" ? "Open" : "None";
    return (
      (kind === "human" ? `<option value="human" selected>Player</option>` : "") +
      `<option value="computer" ${kind === "computer" ? "selected" : ""}>Computer</option>` +
      `<option value="empty" ${kind === "empty" ? "selected" : ""}>${empty}</option>`
    );
  }

  private kindDisabled(player: number): string {
    if (this.options.mode === "guest") return "disabled";
    if (player === this.localSlot) return "disabled";
    // Somebody is sitting in it. Changing it out from under them is a kick,
    // which is a feature with its own consequences and is not one of these.
    if (this.config.slots[player].kind === "human") return "disabled";
    return "";
  }

  private raceDisabled(player: number): string {
    if (player === this.localSlot) return "";
    // Every other human picks their own; the host picks for the computers.
    if (this.config.slots[player].kind === "human") return "disabled";
    return this.options.mode === "guest" ? "disabled" : "";
  }

  /**
   * Where to be reached, shown before Start rather than after.
   *
   * This is the number the host reads out to a friend, and the moment they need
   * it is while they are waiting in the lobby -- not once the match has already
   * begun, which is where the old version put it.
   */
  private addressPanel(): string {
    const info = this.options.hostInfo;
    if (!info) return "";

    const row = (label: string, address: string): string =>
      `<div style="margin-bottom:8px">` +
      `<div style="color:var(--dim);font-size:11px;letter-spacing:0.08em;text-transform:uppercase">` +
      `${escapeHtml(label)}</div>` +
      `<div class="rts-row"><span style="font-size:16px;letter-spacing:0.06em">` +
      `${escapeHtml(address)}</span>` +
      `<button class="quiet" style="padding:2px 10px" data-copy="${escapeHtml(address)}">copy</button>` +
      `</div></div>`;

    // Both addresses, because they answer different questions: the LAN one
    // always works for someone in the same room, and the public one only works
    // if the router cooperated. Showing only the public address strands people
    // on a LAN whose router refused; showing only the LAN one looks like
    // internet play is unsupported.
    return (
      `<div style="padding:14px 16px;margin-bottom:20px;border:1px solid var(--line-2);` +
      `border-radius:var(--radius);background:var(--panel-2)">` +
      (info.publicAddress ? row("over the internet", info.publicAddress) : "") +
      (info.lanAddress ? row("on this network", info.lanAddress) : "") +
      (info.forwarding.ok
        ? ""
        : `<div style="color:var(--warn);font-size:12px;line-height:1.5">` +
          `${escapeHtml(info.forwarding.detail)}</div>`) +
      `</div>`
    );
  }

  // -- events ----------------------------------------------------------------

  private wire(): void {
    const q = <T extends HTMLElement>(selector: string): T | null =>
      this.panel.querySelector<T>(selector);

    q<HTMLButtonElement>("#setup-back")!.onclick = () => this.options.onBack();
    const start = q<HTMLButtonElement>("#setup-start");
    if (start) start.onclick = () => this.options.onStart?.();

    const mapSelect = q<HTMLSelectElement>("#setup-map");
    if (mapSelect) {
      mapSelect.onchange = () => {
        this.change({ ...this.config, mapId: mapSelect.value });
      };
    }

    for (const select of this.panel.querySelectorAll<HTMLSelectElement>("select[data-kind]")) {
      select.onchange = () => {
        const player = Number(select.dataset.kind);
        const slots = [...this.config.slots];
        slots[player] = { ...slots[player], kind: select.value as SlotKind };
        this.change({ ...this.config, slots });
      };
    }

    for (const select of this.panel.querySelectorAll<HTMLSelectElement>("select[data-race]")) {
      select.onchange = () => {
        const player = Number(select.dataset.race);
        if (player === this.localSlot) {
          // Goes through the same door in every mode. In a lobby it is a
          // request the host answers with new state; locally it is applied
          // immediately. The screen does not need to know which.
          this.options.onPickRace(select.value);
          if (this.options.mode === "guest") return;
        }
        const slots = [...this.config.slots];
        slots[player] = { ...slots[player], raceId: select.value };
        this.change({ ...this.config, slots });
      };
    }

    for (const button of this.panel.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
      button.onclick = async () => {
        const value = button.dataset.copy ?? "";
        try {
          await navigator.clipboard.writeText(value);
          button.textContent = "copied";
        } catch {
          // Clipboard access needs a secure context and can be refused
          // outright. Showing the value is worse but always available.
          button.textContent = value;
        }
        setTimeout(() => (button.textContent = "copy"), 1600);
      };
    }
  }

  private change(config: MatchConfig): void {
    this.config = config;
    this.options.onConfigChange?.(config);
    this.render();
  }
}
