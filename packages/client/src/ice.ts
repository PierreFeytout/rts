import { DEFAULT_ICE_SERVERS, type RTCIceServerLike } from "@rts/transport";

/**
 * ICE servers, fetched from the broker.
 *
 * Not baked into the bundle, because that would mean rebuilding and
 * redeploying the client to rotate a TURN password. The broker is the one
 * always-on process and already knows the deployment, so it is the natural
 * place for the configuration to live.
 *
 * Fetched once and cached for the tab. ICE configuration does not change
 * mid-session, and a reconnect happening during a network problem is the worst
 * possible moment to add another round trip that can fail.
 */

let cached: Promise<RTCIceServerLike[]> | null = null;

export function iceServers(brokerUrl: string): Promise<RTCIceServerLike[]> {
  cached ??= load(brokerUrl);
  return cached;
}

async function load(brokerUrl: string): Promise<RTCIceServerLike[]> {
  try {
    // The broker's WebSocket url and its HTTP url are the same origin; only
    // the scheme and path differ.
    const url = new URL(brokerUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/ice";

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as { iceServers?: RTCIceServerLike[] };
    if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) {
      throw new Error("no iceServers in response");
    }
    return body.iceServers;
  } catch {
    // A broker that predates this endpoint, or a dev server that does not
    // serve it, must not stop a game starting. Public STUN gets most home
    // connections through; only symmetric NAT actually needs the relay.
    return DEFAULT_ICE_SERVERS;
  }
}
