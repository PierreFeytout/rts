import { defaultContent } from "@rts/content";
import {
  MSG_LOBBY_CLOSED,
  MSG_LOBBY_HELLO,
  MSG_LOBBY_PICK,
  MSG_LOBBY_START,
  MSG_LOBBY_STATE,
  PROTOCOL_VERSION,
  encodeMessage,
  tryDecodeMessage,
  type LobbySlotState,
} from "@rts/protocol";
import { HOST_PEER, type PeerId, type Transport } from "@rts/transport";

/**
 * The guest's side of the pre-match lobby.
 *
 * Holds no opinion of its own. Everything it displays came from the host's last
 * state message, and the only thing it ever sends is "I would like this race" --
 * a request, which it does not apply locally. A guest that updated its own row
 * optimistically would show a race it might not get, and the discrepancy would
 * only surface once the match had started and the units were wrong.
 *
 * Detaches at `MSG_LOBBY_START`, handing the socket to `GuestSession`. There is
 * no second connection and no second handshake.
 */

export interface LobbyView {
  mapId: string;
  seed: number;
  slots: LobbySlotState[];
  /** Which row is this player's. */
  yourSlot: number;
}

/** What the screen wants to hear about. Replaceable; see `replaceHandlers`. */
export interface LobbyGuestHandlers {
  onState: (view: LobbyView) => void;
  /** The match is beginning; `mapTiles` sizes the world to receive it. */
  onStart: (mapTiles: number) => void;
  /** Refused or evicted. Carries something the player can act on. */
  onClosed: (reason: string) => void;
}

export interface LobbyGuestOptions extends LobbyGuestHandlers {
  transport: Transport;
  /** Stable identity, so the host can return this player to their own slot. */
  token: string;
  name: string;
}

export class LobbyGuest {
  private readonly transport: Transport;
  private readonly token: string;
  private readonly name: string;
  private handlers: LobbyGuestHandlers;
  private detached = false;

  constructor(options: LobbyGuestOptions) {
    this.transport = options.transport;
    this.token = options.token;
    this.name = options.name;
    this.handlers = options;
    this.transport.on("message", this.handleMessage);
    this.transport.on("peerLeave", this.handleLeave);
  }

  /**
   * Hand the guest over to a different screen.
   *
   * Connecting and sitting in the lobby are two screens -- the address prompt,
   * which must stay up to show a failed connection, and the lobby itself. They
   * share one connection, because dropping and remaking it between them would
   * lose the slot the host has already assigned.
   */
  replaceHandlers(handlers: LobbyGuestHandlers): void {
    this.handlers = handlers;
  }

  /** Announce ourselves and ask for a slot. */
  connect(): void {
    this.transport.send(
      HOST_PEER,
      encodeMessage({
        t: MSG_LOBBY_HELLO,
        protocol: PROTOCOL_VERSION,
        contentHash: defaultContent.hash,
        token: this.token,
        name: this.name,
      }),
    );
  }

  /** Ask to play a race. The host decides; the answer arrives as new state. */
  pick(raceId: string): void {
    this.transport.send(HOST_PEER, encodeMessage({ t: MSG_LOBBY_PICK, raceId }));
  }

  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.transport.off("message", this.handleMessage);
    this.transport.off("peerLeave", this.handleLeave);
  }

  private readonly handleMessage = (from: PeerId, data: Uint8Array): void => {
    // Only the host has anything to say here. The relay refuses guest-to-guest
    // traffic anyway; this is the same rule stated where it is relied upon.
    if (from !== HOST_PEER) return;
    const message = tryDecodeMessage(data);
    if (!message) return;

    switch (message.t) {
      case MSG_LOBBY_STATE:
        this.handlers.onState({
          mapId: message.mapId,
          seed: message.seed,
          slots: message.slots,
          yourSlot: message.yourSlot,
        });
        break;

      case MSG_LOBBY_START:
        // Hand the socket over before the caller does anything with it: the
        // host's first match message can arrive in the very next frame, and
        // this listener would eat it.
        this.detach();
        this.handlers.onStart(message.mapTiles);
        break;

      case MSG_LOBBY_CLOSED:
        this.detach();
        this.handlers.onClosed(message.reason);
        break;

      default:
        break;
    }
  };

  private readonly handleLeave = (peer: PeerId): void => {
    if (peer !== HOST_PEER) return;
    this.detach();
    this.handlers.onClosed("the host closed the lobby");
  };
}
