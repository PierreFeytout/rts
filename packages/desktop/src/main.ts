import { BrowserWindow, app, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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
    backgroundColor: "#0b0f16",
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
    void window.loadFile(join(here, "../../client/dist/index.html"));
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
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") console.error(`[rts] renderer: ${event.message}`);
  });

  window.on("closed", () => {
    window = null;
  });
}

// ---------------------------------------------------------------------------
// The bridge the renderer talks to
// ---------------------------------------------------------------------------

ipcMain.handle("rts:host", async (): Promise<HostInfo> => {
  // Hosting twice would leave the first relay listening with nobody attached.
  if (hosting) await stopHosting();

  const running = await startRelay({
    port: DEFAULT_PORT,
    onRoster: (players) => window?.webContents.send("rts:roster", players),
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

app.whenReady().then(createWindow, (error: unknown) => {
  console.error("[rts] failed to start:", error);
  app.quit();
});

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
