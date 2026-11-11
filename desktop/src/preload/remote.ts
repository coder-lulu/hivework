import { contextBridge, ipcRenderer } from "electron";
import type { ServerConnectionsBridge } from "../shared/server-connections";

// Keep this entry self-contained: sandboxed preloads cannot require a shared
// Rollup chunk. Remote sites get no local session, picker, settings or updater.
const serverConnections: ServerConnectionsBridge = {
  current() {
    return ipcRenderer.invoke("octop:connections:current");
  },
  openManager() {
    return ipcRenderer.invoke("octop:connections:open-manager");
  },
  onChange(callback) {
    const listener = () => callback();
    ipcRenderer.on("octop:connections:changed", listener);
    return () => ipcRenderer.removeListener("octop:connections:changed", listener);
  },
};

contextBridge.exposeInMainWorld("hiveworkServerConnections", serverConnections);
