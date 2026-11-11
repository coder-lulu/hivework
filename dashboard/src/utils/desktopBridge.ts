/**
 * Typed access to the Electron shell bridge injected by the desktop preload as
 * ``window.octopDesktop``. In a browser (server mode) this is absent, so the
 * Dashboard falls back to its existing Python self-update flow.
 */

export interface DesktopClientSettings {
  launchAtLogin: boolean;
  closeBehavior: "quit" | "tray";
  themeBackground: "system" | "light" | "dark";
  stableOnly: boolean;
}

export interface DesktopUpdateCheckResult {
  status: "update-available" | "up-to-date" | "error";
  currentVersion: string;
  latestVersion: string | null;
  error: string | null;
}

export interface DesktopPlatformInfo {
  platform: "darwin" | "win32" | "linux";
  arch: string;
  isDesktop: true;
}

/**
 * Theme for the *native* window controls the shell keeps (macOS traffic lights,
 * Windows caption buttons). `scheme` is the user's preference, so "system" keeps
 * following the OS instead of pinning today's answer.
 */
export interface DesktopWindowChromeTheme {
  mode: "light" | "dark";
  scheme?: "system" | "light" | "dark";
}

export interface WindowsMenuCommand {
  kind: "command";
  id: string;
  label: string;
  accelerator: string | null;
}

export interface WindowsMenuSeparator {
  kind: "separator";
}

export type WindowsMenuEntry = WindowsMenuCommand | WindowsMenuSeparator;

export interface WindowsMenuModel {
  titles: string[];
  menus: WindowsMenuEntry[][];
}

/**
 * A JWT minted by the shell from its stored device credential. The credential
 * itself never crosses the bridge.
 */
export interface DesktopIssuedSession {
  access_token: string;
  expires_in: number;
}

export interface DesktopSessionBridge {
  /** Bind the credential to the signed-in user; false when the shell refused. */
  register(accessToken: string): Promise<boolean>;
  /** Mint a fresh JWT, or null when this install has no usable credential. */
  renew(): Promise<DesktopIssuedSession | null>;
  /** Forget this install's credential. */
  revoke(accessToken: string): Promise<boolean>;
}

export interface DesktopServerConnection {
  name: string;
  url: string;
}

export interface DesktopServerConnectionsBridge {
  current(): Promise<DesktopServerConnection | null>;
  openManager(): Promise<void>;
  onChange(callback: () => void): () => void;
}

export interface DesktopUpdaterBridge {
  clientSettings: {
    get(): Promise<DesktopClientSettings>;
    set(patch: Partial<DesktopClientSettings>): Promise<DesktopClientSettings>;
  };
  checkForUpdates(): Promise<DesktopUpdateCheckResult>;
  /** Start the shell install. Takes no arguments; the page confirms first. */
  installUpdate(): Promise<void>;
}

/** Full bridge for the local packaged Dashboard. */
export interface OctopDesktopBridge extends DesktopUpdaterBridge {
  session?: DesktopSessionBridge;
  /** Optional on shells with local and remote server profiles. */
  serverConnections?: DesktopServerConnectionsBridge;
  /**
   * Where to dial WebSockets (§5.2). Absent on an older shell, and null when the
   * relay could not bind — both mean "derive the address from the page origin".
   */
  wsEndpoint?(): { baseUrl: string; token: string } | null;
  getPlatformInfo(): Promise<DesktopPlatformInfo>;
  openDirectoryPicker(): Promise<string | null>;
  openFilePicker(): Promise<string | null>;
  onBackendReady(callback: (ready: { ok: boolean }) => void): () => void;
  /**
   * Tell the shell what the page looks like so its native window controls match.
   * macOS and Windows keep native buttons. Linux draws square ones and drives
   * them through ``windowControls``.
   */
  setWindowChrome(theme: DesktopWindowChromeTheme): void;
  /**
   * Linux caption buttons. Absent on a shell from before this handshake.
   * macOS and Windows ignore the calls.
   */
  windowControls?: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(callback: (maximized: boolean) => void): () => void;
  };
  /**
   * Windows caption overlay hides the native menu bar. The page draws the
   * titles and the submenus, then asks the shell to run the chosen command.
   */
  windowsMenu?: {
    model(): Promise<WindowsMenuModel | null>;
    invoke(id: string): Promise<void>;
  };
  /**
   * macOS hides the traffic lights in full screen; the page then stops
   * reserving room for them. Fires only on change.
   */
  onWindowFullscreenChange?(
    callback: (fullscreen: boolean) => void,
  ): () => void;
}

declare global {
  interface Window {
    /** Older shells may expose only part of the local API. */
    octopDesktop?: Partial<OctopDesktopBridge>;
    /** Remote pages get profile switching without any local capabilities. */
    hiveworkServerConnections?: DesktopServerConnectionsBridge;
  }
}

export function isDesktopShell(): boolean {
  return (
    typeof window !== "undefined" && typeof window.octopDesktop !== "undefined"
  );
}

/**
 * Electron on Linux. The page draws square caption buttons there; macOS and
 * Windows keep the native ones. A Linux browser has no shell bridge.
 */
export function isLinuxDesktopShell(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  return (
    isDesktopShell() && /Linux/.test(userAgent) && !/Android/.test(userAgent)
  );
}

export function getDesktopBridge(): Partial<OctopDesktopBridge> | null {
  return isDesktopShell() ? window.octopDesktop! : null;
}

export function getServerConnectionsBridge(): DesktopServerConnectionsBridge | null {
  if (typeof window === "undefined") return null;
  return (
    getDesktopBridge()?.serverConnections ??
    window.hiveworkServerConnections ??
    null
  );
}

/** Only the local packaged Dashboard can use the device account. */
export function hasDesktopSession(): boolean {
  return typeof getDesktopBridge()?.session?.renew === "function";
}

/** A minimal remote bridge uses its native window frame. */
export function hasDesktopChrome(): boolean {
  return typeof getDesktopBridge()?.setWindowChrome === "function";
}

/** Settings and installation are one capability; partial bridges use server updates. */
export function getDesktopUpdater(): DesktopUpdaterBridge | null {
  const bridge = getDesktopBridge();
  if (
    typeof bridge?.clientSettings?.get !== "function" ||
    typeof bridge.clientSettings.set !== "function" ||
    typeof bridge.checkForUpdates !== "function" ||
    typeof bridge.installUpdate !== "function"
  )
    return null;
  return bridge as DesktopUpdaterBridge;
}
