/**
 * The desktop shell's bridge, as seen from the game.
 *
 * Present when running inside Electron, absent in a browser. The distinction
 * matters for exactly one feature: only the desktop build can open a listening
 * socket, so only it can host. Everything else -- joining, replays, the whole
 * simulation -- runs identically either way, which is what keeps a browser
 * still usable as a development target.
 */

export interface ForwardResult {
  ok: boolean;
  method: "nat-pmp" | "upnp" | "none";
  externalIp: string | null;
  detail: string;
}

export interface HostInfo {
  port: number;
  /** Where the host's own game connects. Always loopback. */
  localUrl: string;
  /** What a friend on the same network types. */
  lanAddress: string | null;
  /** What a friend elsewhere types, when the router was willing to say. */
  publicAddress: string | null;
  forwarding: ForwardResult;
}

export interface DesktopBridge {
  host(): Promise<HostInfo>;
  stopHosting(): Promise<void>;
  onRoster(handler: (players: number) => void): () => void;
}

/** The bridge, or null in a browser. */
export const desktop: DesktopBridge | null =
  (globalThis as unknown as { rtsDesktop?: DesktopBridge }).rtsDesktop ?? null;
