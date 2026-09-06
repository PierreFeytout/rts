import { contextBridge, ipcRenderer } from "electron";

/**
 * The bridge between the game and the machine it runs on.
 *
 * Deliberately three functions. The renderer runs the simulation, the renderer
 * also parses replay files chosen by the player, and a file is untrusted input
 * -- so it gets the narrowest possible surface rather than Node. Everything
 * else it needs, it does over an ordinary WebSocket to `localUrl`, exactly as a
 * guest connects to a friend.
 */

contextBridge.exposeInMainWorld("rtsDesktop", {
  /** Start listening, and try to open the port. Returns how to be reached. */
  host: () => ipcRenderer.invoke("rts:host"),
  /** Stop listening and drop every connected player. */
  stopHosting: () => ipcRenderer.invoke("rts:stop-hosting"),
  /** Close the game from its own main menu, as a desktop application should. */
  quit: () => ipcRenderer.invoke("rts:quit"),
});
