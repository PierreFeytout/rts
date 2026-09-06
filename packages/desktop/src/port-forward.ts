import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { request } from "node:http";
import { URL } from "node:url";

/**
 * Opening a port on the player's router, so friends can actually reach them.
 *
 * This is the cost of dropping the broker: nothing has to be deployed any more,
 * but the hosting player's machine has to be reachable from the internet, and
 * home routers do not forward anything by default.
 *
 * Two protocols, tried in order, both implemented here rather than pulled in:
 *
 *   - **NAT-PMP** (RFC 6886), and its successor PCP. A dozen bytes over UDP to
 *     the default gateway. Apple routers and a good deal of consumer hardware.
 *   - **UPnP IGD**. SSDP discovery, then a SOAP call. Much more common on
 *     Windows-facing consumer routers.
 *
 * The obvious npm packages for this depend on `request` -- deprecated since
 * 2020 -- and on an `xml2js` old enough to have its own CVEs. Shipping that
 * inside a desktop binary is a worse trade than a few hundred lines of
 * well-specified protocol with no dependencies at all.
 *
 * Every failure path is soft. A router that refuses, or lies, or does not
 * answer must leave the player with a clear message and a port number to
 * forward by hand -- never with a game that will not start.
 */

/** How long to wait for any single router response. Routers are slow but local. */
const TIMEOUT_MS = 2500;
/**
 * Lease length requested, in seconds.
 *
 * A lease means an abandoned mapping expires on its own rather than leaving a
 * hole in the player's router forever. Routers that refuse a lease get a
 * permanent mapping instead -- see the retry in `tryUpnp`.
 */
const LEASE_SECONDS = 3600;

export interface ForwardResult {
  ok: boolean;
  /** How it was opened, for the "what happened" line in the UI. */
  method: "nat-pmp" | "upnp" | "none";
  /** Public address, when the router was willing to say. */
  externalIp: string | null;
  /** Human-readable outcome, shown to the player verbatim. */
  detail: string;
}

/**
 * Try to open `port` for TCP, returning what happened rather than throwing.
 *
 * Callers show the result and carry on either way: hosting on a LAN works
 * without any of this, and a player who knows their way around a router can do
 * it by hand.
 */
export async function forwardPort(port: number): Promise<ForwardResult> {
  const gateway = defaultGateway();
  if (!gateway) {
    return {
      ok: false,
      method: "none",
      externalIp: null,
      detail: "could not find your router's address on this network",
    };
  }

  const pmp = await tryNatPmp(gateway, port);
  if (pmp.ok) return pmp;

  const upnp = await tryUpnp(port);
  if (upnp.ok) return upnp;

  return {
    ok: false,
    method: "none",
    externalIp: null,
    detail:
      `your router did not accept an automatic port opening ` +
      `(${pmp.detail}; ${upnp.detail}). Forward TCP port ${port} by hand, or play on a LAN.`,
  };
}

// ---------------------------------------------------------------------------
// NAT-PMP
// ---------------------------------------------------------------------------

/**
 * The default gateway, guessed from the local interface address.
 *
 * Reading the real routing table means a different command on every platform.
 * Assuming `.1` on the local /24 is right for the overwhelming majority of
 * consumer networks, and being wrong costs one timeout before UPnP is tried --
 * where UPnP finds the router by multicast and does not need a guess at all.
 */
function defaultGateway(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      const parts = address.address.split(".");
      if (parts.length !== 4) continue;
      return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
    }
  }
  return null;
}

async function tryNatPmp(gateway: string, port: number): Promise<ForwardResult> {
  try {
    // Opcode 0 asks for the public address; 2 maps a TCP port.
    const external = await natPmpCall(gateway, Buffer.from([0, 0]));
    const externalIp =
      external.length >= 12 ? `${external[8]}.${external[9]}.${external[10]}.${external[11]}` : null;

    const request = Buffer.alloc(12);
    request.writeUInt8(0, 0); // version
    request.writeUInt8(2, 1); // map TCP
    request.writeUInt16BE(0, 2); // reserved
    request.writeUInt16BE(port, 4); // internal port
    request.writeUInt16BE(port, 6); // suggested external port
    request.writeUInt32BE(LEASE_SECONDS, 8);

    const response = await natPmpCall(gateway, request);
    if (response.length < 16) return fail("nat-pmp", "router gave a short reply");
    const resultCode = response.readUInt16BE(2);
    if (resultCode !== 0) return fail("nat-pmp", `router refused (code ${resultCode})`);

    const mapped = response.readUInt16BE(10);
    if (mapped !== port) {
      // A different external port is legal but useless here: friends are given
      // one address, and silently handing out the wrong port would look like
      // the host being unreachable.
      return fail("nat-pmp", `router mapped port ${mapped} instead of ${port}`);
    }
    return { ok: true, method: "nat-pmp", externalIp, detail: "opened via NAT-PMP" };
  } catch (error) {
    return fail("nat-pmp", error instanceof Error ? error.message : "no reply");
  }
}

function natPmpCall(gateway: string, payload: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("no reply from router"));
    }, TIMEOUT_MS);

    socket.on("message", (message) => {
      clearTimeout(timer);
      socket.close();
      resolve(message);
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
    socket.send(payload, 5351, gateway);
  });
}

// ---------------------------------------------------------------------------
// UPnP IGD
// ---------------------------------------------------------------------------

async function tryUpnp(port: number): Promise<ForwardResult> {
  try {
    const location = await discoverIgd();
    if (!location) return fail("upnp", "no UPnP router answered");

    const { controlUrl, serviceType } = await readDeviceDescription(location);
    if (!controlUrl) return fail("upnp", "router exposes no port-mapping service");

    const local = localAddress();
    if (!local) return fail("upnp", "could not determine this machine's address");

    const mapping = (lease: number): string =>
      `<NewRemoteHost></NewRemoteHost>` +
      `<NewExternalPort>${port}</NewExternalPort>` +
      `<NewProtocol>TCP</NewProtocol>` +
      `<NewInternalPort>${port}</NewInternalPort>` +
      `<NewInternalClient>${local}</NewInternalClient>` +
      `<NewEnabled>1</NewEnabled>` +
      `<NewPortMappingDescription>RTS</NewPortMappingDescription>` +
      `<NewLeaseDuration>${lease}</NewLeaseDuration>`;

    try {
      await soap(controlUrl, serviceType, "AddPortMapping", mapping(LEASE_SECONDS));
    } catch (leaseError) {
      // A great many consumer routers answer 500 to any non-zero lease and only
      // accept permanent mappings. Retrying with zero is the difference between
      // "your router refused" and a game that just works, and it is by far the
      // most common reason a first attempt fails.
      void leaseError;
      await soap(controlUrl, serviceType, "AddPortMapping", mapping(0));
    }

    let externalIp: string | null = null;
    try {
      const body = await soap(controlUrl, serviceType, "GetExternalIPAddress", "");
      externalIp = /<NewExternalIPAddress>([^<]*)</.exec(body)?.[1] ?? null;
    } catch {
      // A mapping that worked is worth having even if the router will not say
      // what its public address is; the player can look that up.
    }

    return { ok: true, method: "upnp", externalIp, detail: "opened via UPnP" };
  } catch (error) {
    return fail("upnp", error instanceof Error ? error.message : "failed");
  }
}

/** SSDP M-SEARCH for an internet gateway, returning its description URL. */
function discoverIgd(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    const message = Buffer.from(
      "M-SEARCH * HTTP/1.1\r\n" +
        "HOST: 239.255.255.250:1900\r\n" +
        'MAN: "ssdp:discover"\r\n' +
        "MX: 2\r\n" +
        "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n",
    );

    const timer = setTimeout(() => {
      socket.close();
      resolve(null);
    }, TIMEOUT_MS);

    socket.on("message", (reply) => {
      const location = /LOCATION:\s*(\S+)/i.exec(reply.toString())?.[1];
      if (!location) return;
      clearTimeout(timer);
      socket.close();
      resolve(location);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      socket.close();
      resolve(null);
    });

    socket.send(message, 1900, "239.255.255.250");
  });
}

/**
 * Find the port-mapping control URL in a device description.
 *
 * Matched with regular expressions rather than parsed. That is normally the
 * wrong instinct, but the alternative is an XML dependency inside a shipped
 * binary for the sake of extracting two strings from a document whose shape is
 * fixed by the UPnP specification -- and a router whose description does not
 * match simply falls back to "forward it by hand", which is where an unknown
 * router was always going to end up.
 */
async function readDeviceDescription(
  location: string,
): Promise<{ controlUrl: string | null; serviceType: string }> {
  const xml = await httpGet(location);
  // WANIPConnection is the common one; WANPPPConnection appears on DSL.
  for (const type of [
    "urn:schemas-upnp-org:service:WANIPConnection:2",
    "urn:schemas-upnp-org:service:WANIPConnection:1",
    "urn:schemas-upnp-org:service:WANPPPConnection:1",
  ]) {
    const block = new RegExp(
      `<service>\\s*<serviceType>${type}</serviceType>[\\s\\S]*?</service>`,
      "i",
    ).exec(xml)?.[0];
    if (!block) continue;
    const control = /<controlURL>([^<]*)<\/controlURL>/i.exec(block)?.[1];
    if (!control) continue;
    return { controlUrl: new URL(control, location).toString(), serviceType: type };
  }
  return { controlUrl: null, serviceType: "" };
}

function soap(url: string, serviceType: string, action: string, body: string): Promise<string> {
  const envelope =
    `<?xml version="1.0"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body>` +
    `</s:Envelope>`;

  return httpRequest(url, {
    method: "POST",
    headers: {
      "content-type": 'text/xml; charset="utf-8"',
      soapaction: `"${serviceType}#${action}"`,
      "content-length": Buffer.byteLength(envelope).toString(),
    },
    body: envelope,
  });
}

function httpGet(url: string): Promise<string> {
  return httpRequest(url, { method: "GET" });
}

function httpRequest(
  url: string,
  options: { method: string; headers?: Record<string, string>; body?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    // Plain HTTP only, and deliberately: UPnP control endpoints live on the
    // local network and are never TLS. Following this to an arbitrary host
    // would be a different matter, which is why nothing here follows redirects.
    if (parsed.protocol !== "http:") {
      reject(new Error("router description is not plain HTTP"));
      return;
    }

    const req = request(
      url,
      { method: options.method, headers: options.headers, timeout: TIMEOUT_MS },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          // Routers have been known to return enormous or endless bodies.
          if (data.length < 512 * 1024) data += chunk;
        });
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`router replied ${res.statusCode}`));
            return;
          }
          resolve(data);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("router timed out")));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------

/** This machine's address on the local network, for friends on the same LAN. */
export function localAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

function fail(method: ForwardResult["method"], detail: string): ForwardResult {
  return { ok: false, method, externalIp: null, detail };
}
