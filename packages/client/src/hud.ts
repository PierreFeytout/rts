import {
  BLOCKED_QUEUE_FULL,
  BLOCKED_RESOURCES,
  BLOCKED_SPACE,
  BLOCKED_SUPPLY,
  CAN_BUILD,
  CAN_PRODUCE,
  CMD_CANCEL_TRAIN,
  CMD_HOLD,
  CMD_STOP,
  CMD_TRAIN,
  EV_BLOCKED,
  type Command,
  type EntityId,
  type EntityType,
  type World,
} from "@rts/sim";
import { css, teamColour } from "./palette.js";
import { iconFor, portraitFor } from "./portrait.js";
import type { Selection } from "./selection.js";
import { escapeHtml, installStyles } from "./ui.js";

/**
 * The match console: resources, portrait, and the command card.
 *
 * Laid out the way a StarCraft console is -- minimap on the left, who is
 * selected in the middle, what they can do on the right -- but overlaid on the
 * rendered world rather than cutting into it, so the map keeps its full height.
 * The bar between the three bays is transparent and ignores the mouse, which is
 * what lets a drag-select cross it.
 *
 * Plain DOM rather than anything drawn in WebGL. Text, buttons and hover states
 * are what the browser is already extremely good at, and keeping the console
 * out of the scene graph means it costs nothing per frame that is not changing.
 *
 * The card is rebuilt only when the *shape* of the selection changes -- a
 * different set of unit types, or a different queue length. Rebuilding it every
 * frame would destroy the button the player is mid-click on.
 */

const BLOCK_MESSAGES: Record<number, string> = {
  [BLOCKED_RESOURCES]: "not enough resources",
  [BLOCKED_SUPPLY]: "not enough supply — build a Habstack",
  [BLOCKED_SPACE]: "no room to place that",
  [BLOCKED_QUEUE_FULL]: "production queue is full",
};

/** Columns in the command card. Three, as the genre has had since 1998. */
const COLUMNS = 3;
/** Never fewer rows than this, so the card does not change size as you click. */
const MIN_ROWS = 3;

/** One thing a command slot can do. */
interface Action {
  /** Rendered as the slot's icon. Absent for orders that have no unit to show. */
  type?: EntityType;
  label: string;
  hotkey?: string;
  cost?: string;
  affordable: boolean;
  active: boolean;
  run: () => void;
}

export class Hud {
  private readonly world: World;
  private readonly localPlayer: number;
  private readonly emit: (command: Command) => void;
  private readonly selection: Selection;

  private readonly console: HTMLDivElement;
  private readonly resources: HTMLDivElement;
  /** Where the minimap mounts. Owned here so the console lays it out. */
  readonly minimapBay: HTMLDivElement;
  private readonly selected: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly banner: HTMLDivElement;

  /** Signature of the last card built, so it is only rebuilt when it changes. */
  private cardKey = "";
  private toastUntil = 0;

  constructor(world: World, localPlayer: number, selection: Selection, emit: (c: Command) => void) {
    installStyles();
    this.world = world;
    this.localPlayer = localPlayer;
    this.selection = selection;
    this.emit = emit;

    this.console = document.createElement("div");
    this.console.className = "rts-console";
    document.body.appendChild(this.console);

    this.minimapBay = document.createElement("div");
    this.minimapBay.className = "rts-bay";
    this.minimapBay.style.cssText = "padding:4px;line-height:0";
    this.console.appendChild(this.minimapBay);

    this.selected = document.createElement("div");
    this.selected.className = "rts-bay rts-selected";
    this.console.appendChild(this.selected);

    this.card = document.createElement("div");
    this.card.className = "rts-bay";
    this.console.appendChild(this.card);

    this.resources = document.createElement("div");
    this.resources.className = "rts-bay rts-resources";
    document.body.appendChild(this.resources);

    this.toast = document.createElement("div");
    this.toast.className = "rts-bay rts-toast";
    this.toast.style.display = "none";
    document.body.appendChild(this.toast);

    this.banner = document.createElement("div");
    this.banner.className = "rts-bay rts-outcome";
    this.banner.style.display = "none";
    document.body.appendChild(this.banner);

    selection.onChange = () => this.rebuildCard();
    this.rebuildCard();
  }

  dispose(): void {
    this.console.remove();
    this.resources.remove();
    this.toast.remove();
    this.banner.remove();
  }

  /** Read one tick's events. Call from the session's after-tick hook. */
  ingest(world: World): void {
    for (const event of world.events.all) {
      if (event.kind !== EV_BLOCKED || event.player !== this.localPlayer) continue;
      const name = world.types.has(event.typeId) ? world.types.get(event.typeId).name : "";
      const reason = BLOCK_MESSAGES[event.reason] ?? "order refused";
      this.toast.textContent = name ? `${name}: ${reason}` : reason;
      this.toast.style.display = "block";
      this.toastUntil = performance.now() + 2200;
    }
  }

  /** Per-frame refresh of the cheap, always-changing parts. */
  update(): void {
    const players = this.world.players;
    const p = this.localPlayer;
    const capped = players.supplyUsed[p] >= players.supplyCap[p];

    this.resources.innerHTML =
      stat("alloy", players.alloy[p], "var(--alloy)") +
      stat("plasma", players.plasma[p], "var(--plasma)") +
      stat(
        "supply",
        `${players.supplyUsed[p]} / ${players.supplyCap[p]}`,
        capped ? "var(--bad)" : "var(--text)",
      );

    if (performance.now() > this.toastUntil) this.toast.style.display = "none";

    // The selection's health and any production queue change every tick, so
    // they are patched here rather than triggering a full rebuild 20 times a
    // second. Anything that changes the card's *shape* goes through the
    // signature check instead.
    this.refreshSelected();
    this.refreshOutcome();
  }

  // -------------------------------------------------------------------------

  /** The one selected building, if the selection is exactly one producer. */
  private singleProducer(): number {
    if (this.selection.selected.size !== 1) return -1;
    for (const id of this.selection.selected) {
      const i = this.world.entities.indexOfLive(id);
      if (i < 0) return -1;
      if (!this.world.types.can(this.world.entities.typeId[i], CAN_PRODUCE)) return -1;
      if (this.world.entities.buildRemaining[i] > 0) return -1;
      return i;
    }
    return -1;
  }

  private selectionSignature(): string {
    const e = this.world.entities;
    const types = new Set<number>();
    let count = 0;
    for (const id of this.selection.selected) {
      const i = e.indexOfLive(id);
      if (i < 0) continue;
      types.add(e.typeId[i]);
      count++;
    }
    const bi = this.singleProducer();
    return [
      [...types].sort((a, b) => a - b).join(","),
      count,
      bi >= 0 ? e.queueLen[bi] : -1,
      this.selection.buildType,
      this.selection.attackMovePending ? 1 : 0,
    ].join("|");
  }

  /** Everything the console needs to know about what is selected, in one pass. */
  private survey(): {
    counts: Map<number, number>;
    primary: number;
    owner: number;
    mobile: number;
    builder: number;
    health: number;
    maxHealth: number;
    total: number;
  } {
    const e = this.world.entities;
    const counts = new Map<number, number>();
    let mobile = 0;
    let builder = -1;
    let owner = this.localPlayer;
    let health = 0;
    let maxHealth = 0;
    let total = 0;

    for (const id of this.selection.selected) {
      const i = e.indexOfLive(id);
      if (i < 0) continue;
      counts.set(e.typeId[i], (counts.get(e.typeId[i]) ?? 0) + 1);
      if (e.moveSpeed[i] > 0) mobile++;
      if (builder < 0 && this.world.types.can(e.typeId[i], CAN_BUILD)) builder = i;
      owner = e.owner[i];
      health += e.health[i];
      maxHealth += this.world.types.get(e.typeId[i]).maxHealth;
      total++;
    }

    // The portrait shows whichever type there is most of. With a tie, the lower
    // type id, so the answer does not flicker as units die.
    let primary = -1;
    let best = -1;
    for (const [typeId, n] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
      if (n > best) {
        best = n;
        primary = typeId;
      }
    }

    return { counts, primary, owner, mobile, builder, health, maxHealth, total };
  }

  // -------------------------------------------------------------------------

  private rebuildCard(): void {
    this.cardKey = this.selectionSignature();

    if (this.selection.selected.size === 0) {
      this.selected.style.display = "none";
      this.card.style.display = "none";
      return;
    }
    this.selected.style.display = "flex";
    this.card.style.display = "block";

    const { primary, owner, mobile, builder } = this.survey();
    const e = this.world.entities;

    // -- middle bay: the portrait ------------------------------------------
    this.selected.replaceChildren();
    if (primary >= 0) {
      const type = this.world.types.get(primary);
      const bust = document.createElement("div");
      bust.className = "rts-bust";
      bust.style.backgroundImage = `url(${portraitFor(type, teamColour(owner))})`;
      this.selected.appendChild(bust);
    }

    const body = document.createElement("div");
    body.className = "body";
    body.innerHTML =
      `<div class="name" data-role="name"></div>` +
      `<div class="rts-meter"><i data-role="health"></i></div>` +
      `<div class="sub" data-role="sub"></div>` +
      `<div class="sub" data-role="queue"></div>`;
    this.selected.appendChild(body);

    // -- right bay: the command card ---------------------------------------
    const actions: Action[] = [];

    // Production, when exactly one factory is selected. Requiring exactly one
    // avoids the ambiguity of "train a Conscript" against three Foundries.
    const bi = this.singleProducer();
    if (bi >= 0) {
      const building = e.idAt(bi);
      for (const unitType of this.world.types.get(e.typeId[bi]).produces) {
        actions.push(this.costed(unitType, () =>
          this.emit({ kind: CMD_TRAIN, playerId: this.localPlayer, building, unitType }),
        ));
      }
    }

    // Construction, when the selection includes something that can build.
    if (builder >= 0) {
      for (const buildingType of this.world.types.get(e.typeId[builder]).builds) {
        actions.push(
          this.costed(
            buildingType,
            () => this.selection.beginBuild(buildingType),
            this.selection.buildType === buildingType,
          ),
        );
      }
    }

    const orders: Action[] = [];
    if (mobile > 0) {
      orders.push({
        label: "Stop",
        hotkey: "S",
        affordable: true,
        active: false,
        run: () => this.command(CMD_STOP),
      });
      orders.push({
        label: "Hold",
        hotkey: "H",
        affordable: true,
        active: false,
        run: () => this.command(CMD_HOLD),
      });
      orders.push({
        label: "Attack",
        hotkey: "A",
        affordable: true,
        active: this.selection.attackMovePending,
        run: () => {
          this.selection.attackMovePending = true;
          this.rebuildCard();
        },
      });
    }

    this.card.replaceChildren(this.grid(actions, orders));
    this.refreshSelected();
  }

  /**
   * Lay the card out, with the standing orders always on the bottom row.
   *
   * Fixed positions are the whole reason a command card is fast to use: Stop is
   * where Stop always is, and the hand learns it. Letting the orders reflow as
   * the number of buildable things changes would throw that away for the sake
   * of a tidier grid.
   */
  private grid(actions: Action[], orders: Action[]): HTMLDivElement {
    const grid = document.createElement("div");
    grid.className = "rts-grid";

    const usedRows = Math.ceil(actions.length / COLUMNS);
    const rows = Math.max(MIN_ROWS, usedRows + (orders.length > 0 ? 1 : 0));
    const cells: Array<Action | null> = new Array<Action | null>(rows * COLUMNS).fill(null);

    actions.forEach((action, i) => (cells[i] = action));
    orders.forEach((order, i) => (cells[(rows - 1) * COLUMNS + i] = order));

    for (const cell of cells) grid.appendChild(cell ? this.slot(cell) : blank());
    return grid;
  }

  private slot(action: Action): HTMLButtonElement {
    const button = document.createElement("button");
    button.className =
      "rts-slot" + (action.affordable ? "" : " poor") + (action.active ? " active" : "");
    button.title = action.label + (action.cost ? ` — ${action.cost}` : "");

    if (action.type) {
      button.style.backgroundImage = `url(${iconFor(action.type, teamColour(this.localPlayer))})`;
    }
    // Name on every slot, not just the ones without an icon. The silhouettes
    // are procedural and several buildings read almost identically at 40px, so
    // until there are modelled assets the label is what makes the card usable.
    button.innerHTML =
      (action.hotkey ? `<span class="key">${escapeHtml(action.hotkey)}</span>` : "") +
      (action.cost ? `<span class="cost">${escapeHtml(action.cost)}</span>` : "") +
      `<span class="label">${escapeHtml(action.label)}</span>`;

    // Never disabled outright: a dimmed slot that still reports "not enough
    // alloy" teaches the player why, where a dead one teaches nothing.
    button.onclick = action.run;
    return button;
  }

  /** A slot for a thing that costs resources, with its price and affordability. */
  private costed(typeId: number, run: () => void, active = false): Action {
    const type = this.world.types.get(typeId);
    const parts: string[] = [];
    if (type.costAlloy > 0) parts.push(`${type.costAlloy}a`);
    if (type.costPlasma > 0) parts.push(`${type.costPlasma}p`);
    return {
      type,
      label: type.name,
      cost: parts.join(" "),
      affordable: this.world.players.canAfford(
        this.localPlayer,
        type.costAlloy,
        type.costPlasma,
      ),
      active,
      run,
    };
  }

  // -------------------------------------------------------------------------

  private refreshSelected(): void {
    // Cheap guard: if the selection's shape moved on, rebuild rather than patch.
    if (this.selectionSignature() !== this.cardKey) {
      this.rebuildCard();
      return;
    }
    if (this.selection.selected.size === 0) return;

    const { counts, primary, health, maxHealth, total } = this.survey();
    if (primary < 0) return;

    const name = this.selected.querySelector<HTMLDivElement>('[data-role="name"]');
    const sub = this.selected.querySelector<HTMLDivElement>('[data-role="sub"]');
    const bar = this.selected.querySelector<HTMLElement>('[data-role="health"]');
    const queue = this.selected.querySelector<HTMLDivElement>('[data-role="queue"]');
    if (!name || !sub || !bar || !queue) return;

    const type = this.world.types.get(primary);
    name.textContent = total > 1 ? `${total} selected` : type.name;

    if (total > 1) {
      sub.textContent = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .map(([typeId, n]) => `${n}× ${this.world.types.get(typeId).name}`)
        .join("   ");
    } else {
      sub.textContent = `${health} / ${maxHealth}`;
    }

    const fraction = maxHealth > 0 ? health / maxHealth : 0;
    bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    bar.style.background =
      fraction > 0.6 ? "var(--good)" : fraction > 0.3 ? "var(--warn)" : "var(--bad)";

    this.refreshQueue(queue);
  }

  private refreshQueue(slot: HTMLDivElement): void {
    const bi = this.singleProducer();
    const e = this.world.entities;
    if (bi < 0 || e.queueLen[bi] === 0) {
      slot.replaceChildren();
      return;
    }

    const head = this.world.types.get(e.queueAt(bi, 0));
    const remaining = Math.max(0, e.produceRemaining[bi]);
    const pct = Math.round(100 * (1 - remaining / Math.max(1, head.buildTime)));
    const rest: string[] = [];
    for (let k = 1; k < e.queueLen[bi]; k++) {
      rest.push(this.world.types.get(e.queueAt(bi, k)).name);
    }

    slot.replaceChildren();
    const line = document.createElement("span");
    line.style.color = "var(--accent-2)";
    line.textContent =
      `${head.name} ${pct}%` + (rest.length > 0 ? `   next: ${rest.join(", ")}` : "");
    slot.appendChild(line);

    const cancel = document.createElement("button");
    cancel.textContent = "×";
    cancel.title = "cancel";
    cancel.style.cssText =
      "margin-left:8px;border:1px solid var(--line-2);border-radius:3px;background:var(--raised);" +
      "color:var(--muted);font:inherit;padding:0 6px;cursor:pointer";
    const building = e.idAt(bi);
    cancel.onclick = () =>
      this.emit({ kind: CMD_CANCEL_TRAIN, playerId: this.localPlayer, building, position: -1 });
    slot.appendChild(cancel);
  }

  private refreshOutcome(): void {
    const players = this.world.players;
    if (players.winner === this.localPlayer) {
      this.show("THE WORKS ARE YOURS", "var(--accent)");
    } else if (players.winner >= 0) {
      this.show(`PLAYER ${players.winner} HOLDS THE WORKS`, css(teamColour(players.winner)));
    } else if (players.defeated[this.localPlayer] === 1) {
      this.show("STRIPPED", "var(--bad)");
    } else {
      this.banner.style.display = "none";
    }
  }

  private show(text: string, colour: string): void {
    this.banner.textContent = text;
    this.banner.style.color = colour;
    this.banner.style.display = "block";
  }

  private command(kind: typeof CMD_STOP | typeof CMD_HOLD): void {
    const entities: EntityId[] = [];
    for (const id of this.selection.selected) {
      const i = this.world.entities.indexOfLive(id);
      if (i >= 0 && this.world.entities.moveSpeed[i] > 0) entities.push(id);
    }
    if (entities.length > 0) this.emit({ kind, playerId: this.localPlayer, entities });
  }
}

function blank(): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "rts-slot blank";
  return cell;
}

function stat(label: string, value: string | number, colour: string): string {
  return (
    `<span><span class="tag">${label}</span> ` +
    `<b style="color:${colour}">${value}</b></span>`
  );
}
