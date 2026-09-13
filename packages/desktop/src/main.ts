import { BrowserWindow, app, ipcMain, net, protocol, shell } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, normalize, sep } from "node:path";
import { forwardPort, localAddress, type ForwardResult } from "./port-forward.js";
import { startRelay, type RunningRelay } from "./relay-server.js";

/**
 * The Electron main process.
 *
 * It owns the two things a browser cannot do: a window, and a socket that
 * accepts incoming connections. Everything else -- the simulation, the netcode,
 * the renderer -- runs in the renderer process exactly as it did in the
 * browser, which is why moving to a desktop build cost the game logic nothing.
 *
 * Electron rather than a lighter shell specifically because it bundles its own
 * Chromium. Every determinism guarantee in this project is verified against V8;
 * a shell using the OS webview would run JavaScriptCore on macOS, and a Mac
 * player could then desync against a Windows player with nothing to catch it.
 *
 * The host's own game connects to its own relay over loopback, like any other
 * player. That keeps one transport implementation instead of a client one and a
 * server one that have to agree.
 */

/** Default listening port. Unassigned by IANA, easy to say out loud. */
const DEFAULT_PORT = 47654;

const here = dirname(fileURLToPath(import.meta.url));

/** The built renderer, next to this file whether packaged or not. */
const CLIENT_ROOT = normalize(join(here, "../../client/dist"));

/**
 * The renderer is served over `app://` rather than loaded from `file://`.
 *
 * Chromium refuses `fetch` on a file URL. Everything the renderer loads through
 * `fetch` -- decoded audio, and every `.glb` model through three.js's loader --
 * therefore worked in the dev server and failed in the shipped game, which is
 * the worst shape a bug can have. The soundtrack worked around it by being
 * inlined into the bundle as data URLs; models with textures are megabytes each
 * and cannot.
 *
 * A privileged custom scheme is an ordinary origin as far as the page is
 * concerned: `fetch` works, relative URLs resolve, and nothing in the renderer
 * needs to know it is not talking to a web server.
 *
 * Registered at module load because Electron only accepts scheme privileges
 * before the app is ready.
 */
const SCHEME = "app";
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/**
 * Map `app://rts/<path>` onto a file inside the built renderer, and nothing else.
 *
 * The containment check is the whole security story of this handler. Without
 * it, `app://rts/../../../../somewhere` is a way for anything the renderer
 * parses -- a replay file, a model -- to read arbitrary files off the player's
 * disk through a URL.
 */
function serveRenderer(request: Request): Promise<Response> | Response {
  const { pathname } = new URL(request.url);
  const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const file = normalize(join(CLIENT_ROOT, relative));

  if (file !== CLIENT_ROOT && !file.startsWith(CLIENT_ROOT + sep)) {
    return new Response("not found", { status: 404 });
  }
  // `net.fetch` on a file URL goes through Electron's own file handler, which
  // reads straight out of `app.asar` in a packaged build.
  return net.fetch(pathToFileURL(file).toString());
}

let window: BrowserWindow | null = null;
let hosting: RunningRelay | null = null;

export interface HostInfo {
  port: number;
  /** Where the host's own game should connect. Always loopback. */
  localUrl: string;
  /** What a friend on the same network types. */
  lanAddress: string | null;
  /** What a friend elsewhere types, when the router was willing to say. */
  publicAddress: string | null;
  forwarding: ForwardResult;
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    // `void` from the palette, so the window does not flash a colour that is in
    // no part of the game before the first frame lands.
    backgroundColor: "#0a0806",
    title: "RTS",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      // The renderer runs the game and nothing else. It reaches the socket
      // through the narrow bridge in preload, never through Node directly --
      // the renderer also parses replay files, and a file is untrusted input.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // External links open in the player's browser rather than replacing the game.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devServer = process.env.RTS_DEV_SERVER;
  if (devServer) {
    void window.loadURL(devServer);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadURL(`${SCHEME}://rts/index.html`);
  }

  // A packaged desktop app has no console for the player to check, so the
  // main process logs what the renderer could not do. A blank window with a
  // silent failure behind it is the worst outcome available here.
  window.webContents.on("did-finish-load", () => {
    console.log(`[rts] window ready (${window?.webContents.getURL() ?? "?"})`);
  });
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[rts] failed to load ${url}: ${description} (${code})`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[rts] renderer stopped: ${details.reason}`);
  });
  // Warnings as well as errors: a missing model falls back to its procedural
  // silhouette with a warning rather than failing, and that is exactly the
  // kind of problem a packaged build otherwise hides completely.
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") console.error(`[rts] renderer: ${event.message}`);
    else if (event.level === "warning") console.warn(`[rts] renderer: ${event.message}`);
    // Everything else only on request, so a packaged build can be asked what it
    // loaded without a devtools window: `RTS_VERBOSE=1 <app>`.
    else if (process.env.RTS_VERBOSE) console.log(`[rts] renderer: ${event.message}`);
  });

  window.on("closed", () => {
    window = null;
  });
}

// ---------------------------------------------------------------------------
// The bridge the renderer talks to
// ---------------------------------------------------------------------------

async function beginHosting(): Promise<HostInfo> {
  // Hosting twice would leave the first relay listening with nobody attached.
  if (hosting) await stopHosting();

  const running = await startRelay({
    port: DEFAULT_PORT,
    // Logged, not forwarded to the renderer. The lobby shows a real roster --
    // names, races, who is connected -- built from the host's own lobby state,
    // and a second mechanism carrying a bare connection count would only be a
    // wrong answer for anyone who reached for it first.
    onRoster: (players) => console.log(`[rts] ${players} connected`),
  });
  hosting = running;

  // Port forwarding is attempted, never required. A LAN game needs none of it,
  // and a player who knows their router can do it by hand.
  const forwarding = await forwardPort(running.port);
  const lan = localAddress();

  return {
    port: running.port,
    localUrl: `ws://127.0.0.1:${running.port}`,
    lanAddress: lan ? `${lan}:${running.port}` : null,
    publicAddress: forwarding.externalIp ? `${forwarding.externalIp}:${running.port}` : null,
    forwarding,
  };
}

ipcMain.handle("rts:host", beginHosting);

// The menu's Quit entry. `app.quit()` runs the before-quit handler, so hosting
// is torn down and the forwarded port released on the way out -- closing the
// window by hand does the same thing, and the two must not diverge.
ipcMain.handle("rts:quit", (): void => {
  app.quit();
});

ipcMain.handle("rts:stop-hosting", async (): Promise<void> => {
  await stopHosting();
});

async function stopHosting(): Promise<void> {
  if (!hosting) return;
  const running = hosting;
  hosting = null;
  await running.close();
}

// ---------------------------------------------------------------------------

/**
 * Start the relay, report, and quit -- without opening a window.
 *
 * `RTS_SMOKE=1 <app>` answers "does hosting work in this build" on a machine
 * where nobody can click the button. It is the check that would have caught the
 * packaging bug that shipped: the failure was a module the bundler had not
 * inlined, and it only appeared once a real build tried to open a real socket.
 */
async function smokeTest(): Promise<void> {
  try {
    const info = await beginHosting();
    console.log(`[rts] smoke: listening on ${info.port}`);
    console.log(`[rts] smoke: lan ${info.lanAddress ?? "unknown"}`);
    console.log(`[rts] smoke: public ${info.publicAddress ?? "unknown"}`);
    console.log(`[rts] smoke: forwarding ${info.forwarding.method} -- ${info.forwarding.detail}`);
    console.log("[rts] smoke: ok");
  } catch (error) {
    console.error("[rts] smoke: FAILED", error);
    process.exitCode = 1;
  } finally {
    await stopHosting();
    app.quit();
  }
}

app.whenReady().then(
  () => {
    if (process.env.RTS_SMOKE) return smokeTest();
    protocol.handle(SCHEME, serveRenderer);
    createWindow();
    return undefined;
  },
  (error: unknown) => {
    console.error("[rts] failed to start:", error);
    app.quit();
  },
);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  // The relay lives and dies with the game, which is the whole point: closing
  // the window is how you take the server down, because there is no server.
  void stopHosting().finally(() => {
    if (process.platform !== "darwin") app.quit();
  });
});

app.on("before-quit", () => {
  void stopHosting();
});
