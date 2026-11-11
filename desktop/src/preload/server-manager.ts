import { contextBridge, ipcRenderer } from "electron";
import type { ServerManagerState, ServerProfile } from "../shared/server-connections";

// Deliberately separate from both dashboard preloads. Main validates this exact
// local window and its top-level file URL for every operation.
const channel = "octop:connections:manager";
contextBridge.exposeInMainWorld("octopServerManager", {
  GetServerConnections(): Promise<ServerManagerState> {
    return ipcRenderer.invoke(channel, "GetServerConnections");
  },
  SaveServer(previous: string, value: ServerProfile): Promise<ServerManagerState> {
    return ipcRenderer.invoke(channel, "SaveServer", previous, value);
  },
  DeleteServer(url: string): Promise<ServerManagerState> {
    return ipcRenderer.invoke(channel, "DeleteServer", url);
  },
  ConnectServer(url: string): Promise<ServerManagerState> {
    return ipcRenderer.invoke(channel, "ConnectServer", url);
  },
  RetryServerConnection(): Promise<ServerManagerState> {
    return ipcRenderer.invoke(channel, "RetryServerConnection");
  },
  ConnectLocalTemporarily(): Promise<ServerManagerState> {
    return ipcRenderer.invoke(channel, "ConnectLocalTemporarily");
  },
  onChange(callback: (state: ServerManagerState) => void): () => void {
    const listener = (_event: unknown, state: ServerManagerState) => callback(state);
    ipcRenderer.on("octop:connections:manager-changed", listener);
    return () => ipcRenderer.removeListener("octop:connections:manager-changed", listener);
  },
});
