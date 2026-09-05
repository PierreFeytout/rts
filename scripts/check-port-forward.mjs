/**
 * Try to open a port on this machine's router and report what happened.
 *
 * Run it before hosting for the first time: it answers "can my friends
 * actually reach me" without needing a friend to try.
 */
import { forwardPort, localAddress } from "../packages/desktop/dist/port-forward.js";

const port = Number(process.argv[2] ?? 47654);
console.log(`[rts] local address: ${localAddress() ?? "unknown"}`);
console.log(`[rts] attempting to open TCP ${port}...`);

const result = await forwardPort(port);
console.log(`[rts] ${result.ok ? "opened" : "not opened"} via ${result.method}`);
console.log(`[rts] ${result.detail}`);
if (result.externalIp) console.log(`[rts] public address: ${result.externalIp}:${port}`);
