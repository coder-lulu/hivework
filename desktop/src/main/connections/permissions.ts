export interface ConnectionSender {
  id: number;
  url: string;
  frameUrl: string;
  mainFrame: boolean;
}

export type ConnectionRole = "local" | "remote" | "manager";

export function sameOrigin(value: string, origin: string): boolean {
  try {
    const a = new URL(value);
    const b = new URL(origin);
    return a.protocol === b.protocol && a.host === b.host && !a.username && !a.password;
  } catch {
    return false;
  }
}

/** Identity AND current main-frame URL; a matching URL in another window is insufficient. */
export class ConnectionPermissions {
  private readonly windows = new Map<number, { role: ConnectionRole; document: string }>();

  allow(id: number, role: ConnectionRole, document: string): void {
    this.windows.set(id, { role, document });
  }

  revoke(id: number): void {
    this.windows.delete(id);
  }

  permits(sender: ConnectionSender, operation: "public" | "local" | "manager"): boolean {
    const window = this.windows.get(sender.id);
    if (!window || !sender.mainFrame) return false;
    const matches = (url: string) => window.role === "manager"
      ? url === window.document
      : sameOrigin(url, window.document);
    if (!matches(sender.url) || !matches(sender.frameUrl)) return false;
    if (operation === "manager") return window.role === "manager";
    if (operation === "local") return window.role === "local";
    return window.role === "local" || window.role === "remote";
  }
}
