import { isHealthyBody } from "../supervisor/health";
import { normalizeServerUrl } from "./server-store";

/** No credentials, cookies or redirects; Node fetch keeps TLS verification enabled. */
export async function checkRemoteHealth(
  value: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const origin = normalizeServerUrl(value);
  const response = await fetchImpl(`${origin}/api/health`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok || !isHealthyBody(await response.json())) {
    throw new Error("无法连接该蜂巢智工服务器，请检查地址和网络后重试。");
  }
}
