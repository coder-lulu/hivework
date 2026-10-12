import { afterEach, describe, expect, it, vi } from "vitest";
import { i18nApi } from "./api/modules/i18n";
import i18n, {
  ensureLocaleBundle,
  initI18n,
  loadLocaleBundle,
  refreshServerLabels,
} from "./i18n";
vi.unmock("react-i18next");
vi.mock("./api/modules/i18n", () => ({
  i18nApi: { getToolLabels: vi.fn(), getSkillLabels: vi.fn() },
}));
vi.mock("./utils/localePrefs", async (original) => ({
  ...(await original<typeof import("./utils/localePrefs")>()),
  resolveInitialLocale: () => "zh",
}));
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("branded locale loading", () => {
  it("brands initial, lazy fallback, language switching and server hydration", async () => {
    vi.stubGlobal("BASE_URL", "");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ setup_required: false }),
      }),
    );
    vi.stubGlobal("requestIdleCallback", vi.fn());
    vi.mocked(i18nApi.getToolLabels).mockResolvedValue({
      locale: "en",
      labels: { test_tool: "Tool" },
    });
    vi.mocked(i18nApi.getSkillLabels).mockResolvedValue({
      locale: "en",
      labels: { "octop-assistant": "蜂巢智工助手" },
    });
    await initI18n();
    expect(i18n.t("app.pageTitle")).toContain("蜂巢智工");
    await ensureLocaleBundle("en");
    await i18n.changeLanguage("en");
    expect(i18n.t("app.pageTitle")).toContain("HiveWork");
    vi.mocked(i18nApi.getSkillLabels).mockResolvedValue({
      locale: "en",
      labels: { "octop-assistant": "HiveWork Assistant" },
    });
    await refreshServerLabels("en");
    expect(i18n.t("skills.octop-assistant")).toBe("HiveWork Assistant");
    expect(i18n.t("tools.test_tool")).toBe("Tool");
    await i18n.changeLanguage("zh");
    expect(i18n.t("app.pageTitle")).toContain("蜂巢智工");
    expect(await loadLocaleBundle("en")).toMatchObject({
      brand: { name: "HiveWork" },
    });
  });
});
