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
import type { Selection } from "./selection.js";

/**
 * Resource readout, command card, and match-state banners.
 *
 * Plain DOM rather than anything drawn in WebGL. Text, buttons and hover states
 * are what the browser is already extremely good at, and keeping the HUD out of
 * the scene graph means it costs nothing per frame that it is not changing.
 *
 * The card is rebuilt only when the *shape* of the selection changes -- a
 * different set of unit types, or a different queue length. Rebuilding it every
 * frame would destroy the button the player is mid-click on.
 */

const BLOCK_MESSAGES: Record<number, string> = {
  [BLOCKED_RESOURCES]: "not enough resources",
  [BLOCKED_SUPPLY]: "not enough supply — build a Supply Pylon",
  [BLOCKED_SPACE]: "no room to place that",
  [BLOCKED_QUEUE_FULL]: "production queue is full",
};

export class Hud {
  private readonly world: World;
  private readonly localPlayer: number;
  private readonly emit: (command: Command) => void;
  private readonly selection: Selection;

  private readonly resources: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly banner: HTMLDivElement;

  /** Signature of the last card built, so it is only rebuilt when it changes. */
  private cardKey = "";
  private toastUntil = 0;

  constructor(world: World, localPlayer: number, selection: Selection, emit: (c: Command) => void) {
    this.world = world;
    this.localPlayer = localPlayer;
    this.selection = selection;
    this.emit = emit;

    this.resources = panel(
      "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:12;" +
        "padding:8px 18px;display:flex;gap:22px;align-items:center;font-size:15px",
    );
    this.card = panel(
      "position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:12;" +
        "padding:10px 12px;display:flex;flex-direction:column;gap:8px;align-items:center;" +
        "max-width:min(900px,92vw)",
    );
    this.toast = panel(
      "position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:13;" +
        "padding:8px 16px;color:#ffb4a0;border-color:#5a2f2a;display:none",
    );
    this.banner = panel(
      "position:fixed;top:38%;left:50%;transform:translateX(-50%);z-index:14;" +
        "padding:20px 40px;font-size:26px;letter-spacing:0.12em;text-align:center;display:none",
    );

    selection.onChange = () => this.rebuildCard();
    this.rebuildCard();
  }

  dispose(): void {
    this.resources.remove();
    this.card.remove();
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
    const supplyOver = players.supplyUsed[p] >= players.supplyCap[p];

    this.resources.innerHTML =
      stat("alloy", players.alloy[p], "#e8d08a") +
      stat("plasma", players.plasma[p], "#8ef0d8") +
      stat(
        "supply",
        `${players.supplyUsed[p]} / ${players.supplyCap[p]}`,
        supplyOver ? "#ff9a8a" : "#bcd4ee",
      );

    if (performance.now() > this.toastUntil) this.toast.style.display = "none";

    // The queue changes every tick, so its progress is refreshed here rather
    // than triggering a full card rebuild twenty times a second.
    this.refreshQueue();
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

  private rebuildCard(): void {
    this.cardKey = this.selectionSignature();
    this.card.replaceChildren();

    const e = this.world.entities;
    if (this.selection.selected.size === 0) {
      this.card.style.display = "none";
      return;
    }
    this.card.style.display = "flex";

    // Header: what is selected.
    const counts = new Map<number, number>();
    let mobile = 0;
    let builder = -1;
    for (const id of this.selection.selected) {
      const i = e.indexOfLive(id);
      if (i < 0) continue;
      counts.set(e.typeId[i], (counts.get(e.typeId[i]) ?? 0) + 1);
      if (e.moveSpeed[i] > 0) mobile++;
      if (builder < 0 && this.world.types.can(e.typeId[i], CAN_BUILD)) builder = i;
    }

    const header = document.createElement("div");
    header.style.cssText = "color:#8fb4d8;font-size:12px;letter-spacing:0.06em";
    header.textContent = [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([typeId, n]) => `${n}x ${this.world.types.get(typeId).name}`)
      .join("   ");
    this.card.appendChild(header);

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;justify-content:center";
    this.card.appendChild(row);

    // Production, when exactly one factory is selected. Requiring exactly one
    // avoids the ambiguity of "train a Trooper" against three Foundries.
    const bi = this.singleProducer();
    if (bi >= 0) {
      for (const unitType of this.world.types.get(e.typeId[bi]).produces) {
        const type = this.world.types.get(unitType);
        const building = e.idAt(bi);
        row.appendChild(
          this.button(type, `train`, () =>
            this.emit({
              kind: CMD_TRAIN,
              playerId: this.localPlayer,
              building,
              unitType,
            }),
          ),
        );
      }
    }

    // Construction, when the selection includes something that can build.
    if (builder >= 0) {
      for (const buildingType of this.world.types.get(e.typeId[builder]).builds) {
        const type = this.world.types.get(buildingType);
        row.appendChild(
          this.button(type, "build", () => this.selection.beginBuild(buildingType), () =>
            this.selection.buildType === buildingType,
          ),
        );
      }
    }

    if (mobile > 0) {
      row.appendChild(this.plainButton("Stop (S)", () => this.command(CMD_STOP)));
      row.appendChild(this.plainButton("Hold (H)", () => this.command(CMD_HOLD)));
      row.appendChild(
        this.plainButton(
          "Attack-move (A)",
          () => {
            this.selection.attackMovePending = true;
            this.rebuildCard();
          },
          () => this.selection.attackMovePending,
        ),
      );
    }

    const queue = document.createElement("div");
    queue.dataset.role = "queue";
    queue.style.cssText = "color:#7fa8cc;font-size:12px;min-height:14px";
    this.card.appendChild(queue);

    this.refreshQueue();
  }

  private refreshQueue(): void {
    // Cheap guard: if the selection shape moved on, rebuild rather than patch.
    if (this.selectionSignature() !== this.cardKey) {
      this.rebuildCard();
      return;
    }

    const slot = this.card.querySelector<HTMLDivElement>('[data-role="queue"]');
    if (!slot) return;

    const bi = this.singleProducer();
    const e = this.world.entities;
    if (bi < 0 || e.queueLen[bi] === 0) {
      slot.textContent = "";
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
    line.textContent =
      `${head.name} ${pct}%` + (rest.length > 0 ? `   next: ${rest.join(", ")}` : "");
    slot.appendChild(line);

    const cancel = document.createElement("button");
    cancel.textContent = "cancel";
    cancel.style.cssText = buttonCss + ";margin-left:10px;padding:1px 8px;font-size:11px";
    const building = e.idAt(bi);
    cancel.onclick = () =>
      this.emit({ kind: CMD_CANCEL_TRAIN, playerId: this.localPlayer, building, position: -1 });
    slot.appendChild(cancel);
  }

  private refreshOutcome(): void {
    const players = this.world.players;
    if (players.winner === this.localPlayer) {
      this.show(this.banner, "VICTORY", "#8ef0b0");
    } else if (players.winner >= 0) {
      this.show(this.banner, `PLAYER ${players.winner} WINS`, "#ffd27a");
    } else if (players.defeated[this.localPlayer] === 1) {
      this.show(this.banner, "DEFEATED", "#ff9a8a");
    } else {
      this.banner.style.display = "none";
    }
  }

  private show(element: HTMLDivElement, text: string, colour: string): void {
    element.textContent = text;
    element.style.color = colour;
    element.style.display = "block";
  }

  private command(kind: typeof CMD_STOP | typeof CMD_HOLD): void {
    const entities: EntityId[] = [];
    for (const id of this.selection.selected) {
      const i = this.world.entities.indexOfLive(id);
      if (i >= 0 && this.world.entities.moveSpeed[i] > 0) entities.push(id);
    }
    if (entities.length > 0) this.emit({ kind, playerId: this.localPlayer, entities });
  }

  /** A costed button: shows price, and dims when the player cannot pay. */
  private button(
    type: EntityType,
    verb: string,
    onClick: () => void,
    active?: () => boolean,
  ): HTMLButtonElement {
    const players = this.world.players;
    const affordable = players.canAfford(this.localPlayer, type.costAlloy, type.costPlasma);
    const button = document.createElement("button");
    button.style.cssText =
      buttonCss +
      (active?.() ? ";border-color:#7dffb0;background:#1c3a2c" : "") +
      (affordable ? "" : ";opacity:0.45");
    button.title = `${verb} ${type.name}`;

    const cost: string[] = [];
    if (type.costAlloy > 0) cost.push(`${type.costAlloy}a`);
    if (type.costPlasma > 0) cost.push(`${type.costPlasma}p`);
    if (type.supplyCost > 0) cost.push(`${type.supplyCost}s`);

    button.innerHTML =
      `<div style="font-size:12px">${type.name}</div>` +
      `<div style="font-size:10px;color:#7fa8cc">${cost.join("  ")}</div>`;
    // Never disabled outright: a dimmed button that still reports "not enough
    // alloy" teaches the player why, where a dead button teaches nothing.
    button.onclick = onClick;
    return button;
  }

  private plainButton(
    label: string,
    onClick: () => void,
    active?: () => boolean,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.style.cssText =
      buttonCss + ";font-size:12px" + (active?.() ? ";border-color:#7dffb0;background:#1c3a2c" : "");
    button.textContent = label;
    button.onclick = onClick;
    return button;
  }
}

const buttonCss =
  "border:1px solid #2f6f8f;border-radius:5px;background:#14283a;color:#cfe4ff;" +
  "font:inherit;padding:5px 10px;cursor:pointer;line-height:1.35;text-align:center";

function panel(extra: string): HTMLDivElement {
  const element = document.createElement("div");
  element.style.cssText =
    "border:1px solid #234;border-radius:6px;background:rgba(8,12,20,0.78);color:#cfe4ff;" +
    "backdrop-filter:blur(4px);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
    extra;
  document.body.appendChild(element);
  return element;
}

function stat(label: string, value: string | number, colour: string): string {
  return (
    `<span><span style="color:#62809f;font-size:11px">${label}</span> ` +
    `<span style="color:${colour}">${value}</span></span>`
  );
}
