import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  brandIndexHtml,
  brandManifest,
  brandOfflineHtml,
} from "../branding/plugin";
import { applyBranding, brand, brandName } from "./branding";
import english from "./locales/en.json";
import chinese from "./locales/zh.json";
const readTemplate = (name: string) => readFileSync(name, "utf8");
describe("brand resources", () => {
  it("merges both languages without mutating originals or technical labels", () => {
    const en = applyBranding(english, "en");
    const zh = applyBranding(chinese, "zh");
    expect(en.app).toMatchObject({
      pageTitle: expect.stringContaining("HiveWork"),
    });
    expect(zh.app).toMatchObject({
      pageTitle: expect.stringContaining("蜂巢智工"),
    });
    expect(english.app.pageTitle).toContain("Octop");
    expect(JSON.stringify(en)).toContain('"label_octopbot":"OctopBot"');
    expect(en.skills).toMatchObject({
      "octop-assistant": "HiveWork Assistant",
    });
    expect(zh.skills).toMatchObject({ "octop-assistant": "蜂巢智工助手" });
    expect(zh.connectors).toMatchObject({
      weknoraNotFound: expect.stringContaining("蜂巢智工主机"),
    });
    expect(brand.default_palette).toBe("tech");
    expect(brandName("zh-CN")).toBe("蜂巢智工");
    expect(brandName("fr")).toBe("HiveWork");
    expect(zh.apiErrors).toMatchObject({
      BACKUP_SCHEMA_INCOMPATIBLE: expect.stringContaining(
        "{{archive_schema_version}}",
      ),
      UPDATE_BRAND_MANAGED: expect.stringContaining("{{repository_url}}"),
    });
    for (const bundle of [en, zh]) {
      expect(bundle.wizard.password.whereDefault).toContain(
        "~/hivework-login.txt",
      );
    }
  });
});
describe("build templates", () => {
  it("changes installation labels while preserving identity and fields", () => {
    const original = JSON.parse(readTemplate("public/manifest.json"));
    const result = brandManifest(original);
    expect(result).toMatchObject({
      id: "/",
      start_url: "/",
      scope: "/",
      name: "蜂巢智工（HiveWork）",
      short_name: "蜂巢智工",
    });
    expect(result.icons).toEqual(original.icons);
    expect(result.categories).toEqual(original.categories);
    expect(original.name).toBe("Octop");
  });
  it("brands startup and offline documents while preserving scripts", () => {
    const result = brandIndexHtml(readTemplate("index.html"));
    expect(result).toContain("<title>蜂巢智工（HiveWork）</title>");
    expect(result).toContain('var KEY = "theme"');
    expect(result).toContain('var KEY = "octop:chunk-reload"');
    expect(result).not.toContain('content="Octop"');
    const offline = brandOfflineHtml(readTemplate("public/offline.html"));
    expect(offline).toContain("无法连接到蜂巢智工服务端。");
    expect(offline).not.toContain("Octop");
    expect(offline).toContain('onclick="location.reload()"');
  });
  it("fails clearly for missing and ambiguous template targets", () => {
    const original = readTemplate("index.html");
    expect(() =>
      brandIndexHtml(original.replace("<title>Octop</title>", "")),
    ).toThrow(/index.html expected exactly one/);
    expect(() => brandIndexHtml(original + "<title>Octop</title>")).toThrow(
      /index.html expected exactly one/,
    );
    expect(() =>
      brandOfflineHtml(
        readTemplate("public/offline.html").replace('alt="Octop"', 'alt="New"'),
      ),
    ).toThrow(/offline.html expected exactly one/);
  });
});
