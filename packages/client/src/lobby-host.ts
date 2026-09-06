import { defaultContent } from "@rts/content";
import type { RosterEntry } from "@rts/netcode";
import {
  MSG_LOBBY_CLOSED,
  MSG_LOBBY_HELLO,
  MSG_LOBBY_PICK,
  MSG_LOBBY_START,
  MSG_LOBBY_STATE,
  PROTOCOL_VERSION,
  encodeMessage,
  tryDecodeMessage,
  type LobbyStateMessage,
} from "@rts/protocol";
import { HOST_PEER, type PeerId, type Transport } from "@rts/transport";
import { RACE_IDS, type MatchConfig } from "./match.js";

/**
 * The host's side of the pre-match lobby.
 *
 * Runs over the same socket the match will use, and stops the moment the match
 * begins. Keeping it on one connection is what lets a guest go from the lobby
 * to playing without a second handshake, and what makes "the host left" mean
 * the same thing in both places.
 *
 * The host is the sole authority on the configuration. A guest sends a
 * *request* -- "I would like to play the Concord" -- and waits to be told what
 * the lobby now looks like. That is the same rule the arbiter follows for
 * commands, for the same reason: two people who both edited their own copy see
 * two different lobbies and find out at the loading screen.
 *
 * The one thing a guest is allowed to change is its own race. Everything else
 * is the host's, because everything else is a property of the match rather than
 * of a player.
 */

export interface LobbyHostOptions {
  transport: Transport;
  /** The host's own identity, which occupies slot 0. */
  token: string;
  name: string;
  config: MatchConfig;
  /** Called whenever the lobby changes, so the screen can redraw. */
  onChange: (config: MatchConfig) => void;
}

export class LobbyHost {
  private readonly transport: Transport;
  private readonly onChange: LobbyHostOptions["onChange"];
  config: MatchConfig;

  /** Which player slot each connected socket holds. */
  private readonly peers = new Map<PeerId, number>();
  /** Stable identity per occupied slot, for the roster handed to the match. */
  private readonly tokens = new Map<number, string>();

  private closed = false;

  constructor(options: LobbyHostOptions) {
    this.transport = options.transport;
    this.onChange = options.onChange;
    this.config = options.config;

    this.config.slots[0] = {
      ...this.config.slots[0],
      kind: "human",
      name: options.name,
    };
    this.tokens.set(0, options.token);
    this.clampToMap();

    this.transport.on("message", this.handleMessage);
    this.transport.on("peerLeave", this.handleLeave);
  }

  /** Replace the configuration from the host's own controls. */
  update(next: MatchConfig): void {
    this.config = next;
    this.clampToMap();
    this.publish();
  }

  /**
   * Begin the match.
   *
   * Returns the guest list for `HostSession`, then goes quiet: from here the
   * same socket carries the match protocol, and a lobby message arriving late
   * must not be answered.
   */
  start(): RosterEntry[] {
    this.closed = true;
    const mapTiles = defaultContent.map(this.config.mapId).size;
    this.transport.broadcast(encodeMessage({ t: MSG_LOBBY_START, mapTiles }));
    this.detach();

    const roster: RosterEntry[] = [];
    this.config.slots.forEach((slot, playerId) => {
      const token = this.tokens.get(playerId);
      // Only humans are on the roster: it is the list of who may connect, and
      // a computer slot has nobody to connect for it.
      if (slot.kind !== "human" || token === undefined) return;
      roster.push({ token, playerId, name: slot.name });
    });
    return roster;
  }

  /** Stop listening without starting a match, e.g. the host backed out. */
  detach(): void {
    this.transport.off("message", this.handleMessage);
    this.transport.off("peerLeave", this.handleLeave);
  }

  /** Human slots with somebody actually attached. Includes the host. */
  get connectedPlayers(): number {
    return this.peers.size + 1;
  }

  // -- wire ------------------------------------------------------------------

  private readonly handleMessage = (from: PeerId, data: Uint8Array): void => {
    if (this.closed || from === HOST_PEER) return;
    // Untrusted input. A malformed frame must be a dropped message, not a
    // crashed host.
    const message = tryDecodeMessage(data);
    if (!message) return;

    switch (message.t) {
      case MSG_LOBBY_HELLO:
        this.admit(from, message.protocol, message.contentHash, message.token, message.name);
        break;
      case MSG_LOBBY_PICK:
        this.pick(from, message.raceId);
        break;
      default:
        break;
    }
  };

  private readonly handleLeave = (peer: PeerId): void => {
    const playerId = this.peers.get(peer);
    if (playerId === undefined) return;
    this.peers.delete(peer);
    this.tokens.delete(playerId);
    // A slot vacated *in the lobby* is free for someone else, unlike one
    // vacated mid-match: there are no units on the field to come back to yet,
    // and a seat held for somebody who left is a seat nobody can use.
    this.config.slots[playerId] = {
      ...this.config.slots[playerId],
      kind: "empty",
      name: `Computer ${playerId + 1}`,
    };
    this.publish();
  };

  private admit(
    from: PeerId,
    protocol: number,
    contentHash: number,
    token: string,
    name: string,
  ): void {
    if (protocol !== PROTOCOL_VERSION) {
      this.refuse(from, `protocol ${protocol} but the host speaks ${PROTOCOL_VERSION}`);
      return;
    }
    // Same check, same reason, as the match handshake: two peers disagreeing
    // about what a unit costs -- or about where a map's ore is -- diverge on
    // the first order, and the desync report then points at the simulation.
    if (contentHash !== defaultContent.hash) {
      this.refuse(
        from,
        `content mismatch: yours is ${hex(contentHash)}, the host's is ` +
          `${hex(defaultContent.hash)}. You are running a different build.`,
      );
      return;
    }

    // Lowest free seat. Deliberately not "the seat this token had last time":
    // a lobby departure frees the slot outright, because nothing has been built
    // yet and there is nothing to come back to. Token identity starts mattering
    // the moment the match does -- see `HostSession`'s roster, which is what
    // returns a dropped *player* to their own army.
    const playerId = this.freeSlot();
    if (playerId === undefined) {
      this.refuse(from, "the lobby is full");
      return;
    }

    this.peers.set(from, playerId);
    this.tokens.set(playerId, token);
    this.config.slots[playerId] = {
      ...this.config.slots[playerId],
      kind: "human",
      name,
    };
    this.publish();
  }

  private pick(from: PeerId, raceId: string): void {
    const playerId = this.peers.get(from);
    if (playerId === undefined) return;
    // A race the host has never heard of would build no base at all, so this is
    // checked rather than trusted -- the sender is a peer, not the UI.
    if (!RACE_IDS.includes(raceId)) return;

    this.config.slots[playerId] = { ...this.config.slots[playerId], raceId };
    this.publish();
  }

  private refuse(peer: PeerId, reason: string): void {
    this.transport.send(peer, encodeMessage({ t: MSG_LOBBY_CLOSED, reason }));
  }

  /**
   * Send the lobby to everyone, and tell the host's own screen.
   *
   * Sent per peer rather than broadcast, because each recipient needs to know
   * which row is theirs -- and a guest that had to guess would guess wrong the
   * moment two people shared a name.
   */
  private publish(): void {
    for (const [peer, playerId] of this.peers) {
      this.transport.send(peer, encodeMessage(this.stateFor(playerId)));
    }
    this.onChange(this.config);
  }

  private stateFor(playerId: number): LobbyStateMessage {
    return {
      t: MSG_LOBBY_STATE,
      mapId: this.config.mapId,
      seed: this.config.seed,
      yourSlot: playerId,
      slots: this.config.slots.map((slot, id) => ({
        kind: slot.kind,
        raceId: slot.raceId,
        name: slot.name,
        connected: id === 0 || this.tokens.has(id),
      })),
    };
  }

  /** Lowest slot nobody holds, within what the chosen map seats. */
  private freeSlot(): number | undefined {
    const seats = defaultContent.map(this.config.mapId).maxPlayers;
    for (let playerId = 1; playerId < seats; playerId++) {
      if (this.tokens.has(playerId)) continue;
      // A "computer" slot is given away to an arriving human. Somebody who
      // travelled to this address wants to play more than the host wanted a
      // fourth idle base.
      if (this.config.slots[playerId].kind !== "human") return playerId;
    }
    return undefined;
  }

  /**
   * Force slots the map cannot seat to be empty.
   *
   * The setup screen hides them, but the map can change *after* a slot was
   * filled -- switching from a four-start map to a two-start one has to do
   * something, and quietly building a world with no start position for player 3
   * is the one thing it must not do.
   */
  private clampToMap(): void {
    const seats = defaultContent.map(this.config.mapId).maxPlayers;
    for (let playerId = seats; playerId < this.config.slots.length; playerId++) {
      if (this.config.slots[playerId].kind === "empty") continue;
      this.config.slots[playerId] = { ...this.config.slots[playerId], kind: "empty" };
      this.tokens.delete(playerId);

      // Anybody sitting in that slot is told, rather than left in a lobby that
      // no longer has a row for them. Silently dropping them would leave a
      // player watching a screen that never starts.
      for (const [peer, held] of [...this.peers]) {
        if (held !== playerId) continue;
        this.peers.delete(peer);
        this.refuse(peer, `the host chose a map that seats ${seats} players`);
      }
    }
  }
}

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}
