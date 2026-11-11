export interface ServerProfile {
  name: string;
  url: string;
}

export interface ServerConfig {
  servers: ServerProfile[];
  /** null: no choice (allow env); "": local; otherwise a saved remote URL. */
  activeUrl: string | null;
}

export interface ServerManagerState extends ServerConfig {
  currentUrl: string;
  locale: "zh" | "en";
  connectionPhase: "choose" | "connecting" | "loading" | "connected" | "failed";
  connectionError: string;
}

export interface ServerConnectionsBridge {
  current(): Promise<ServerProfile | null>;
  openManager(): Promise<void>;
  onChange(callback: () => void): () => void;
}

export const CONNECTION_IPC = {
  current: "octop:connections:current",
  openManager: "octop:connections:open-manager",
  changed: "octop:connections:changed",
  manager: "octop:connections:manager",
  managerChanged: "octop:connections:manager-changed",
} as const;

export type ManagerCommand =
  | "GetServerConnections"
  | "SaveServer"
  | "DeleteServer"
  | "ConnectServer"
  | "RetryServerConnection"
  | "ConnectLocalTemporarily";
