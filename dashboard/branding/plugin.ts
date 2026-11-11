import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const brandRoot = path.resolve(dashboardRoot, "../src/octop/branding");
export function brandingDefines() {
  return {
    __HIVEWORK_PROFILE__: readFileSync(
      path.join(brandRoot, "profile.json"),
      "utf8",
    ),
    __HIVEWORK_EN__: readFileSync(
      path.join(brandRoot, "frontend.en.json"),
      "utf8",
    ),
    __HIVEWORK_ZH__: readFileSync(
      path.join(brandRoot, "frontend.zh.json"),
      "utf8",
    ),
  };
}
const profile = () =>
  JSON.parse(brandingDefines().__HIVEWORK_PROFILE__) as {
    name: { en: string; zh: string };
    description: { en: string; zh: string };
  };
function replaceOnce(
  html: string,
  target: string,
  value: string,
  file: string,
) {
  if (html.split(target).length !== 2) {
    throw new Error(
      `HiveWork branding: ${file} expected exactly one ${JSON.stringify(
        target,
      )}`,
    );
  }
  return html.replace(target, value);
}
function brandTemplateColors(html: string) {
  return html
    .replaceAll("232, 93, 117", "75, 116, 250")
    .replaceAll("240, 139, 154", "123, 155, 252")
    .replaceAll("#e85d75", "#3a5fe0")
    .replaceAll("#f08b9a", "#7b9bfc");
}
export function brandIndexHtml(html: string) {
  const { name } = profile();
  let result = replaceOnce(
    html,
    "<title>Octop</title>",
    `<title>${name.zh}（${name.en}）</title>`,
    "index.html",
  );
  result = replaceOnce(
    result,
    'name="apple-mobile-web-app-title" content="Octop"',
    `name="apple-mobile-web-app-title" content="${name.zh}"`,
    "index.html",
  );
  result = result.replaceAll('alt="Octop"', `alt="${name.zh}"`);
  return brandTemplateColors(result);
}
export function brandOfflineHtml(html: string) {
  const { name } = profile();
  let result = html;
  for (const [target, value] of [
    ["<title>Octop — 离线中</title>", `<title>${name.zh} — 离线中</title>`],
    ["无法连接到 Octop 服务端", `无法连接到${name.zh}服务端`],
  ])
    result = replaceOnce(result, target, value, "offline.html");
  return brandTemplateColors(result);
}
export function brandManifest(manifest: Record<string, unknown>) {
  const { name, description } = profile();
  return {
    ...manifest,
    name: `${name.zh}（${name.en}）`,
    short_name: name.zh,
    description: description.zh,
  };
}
export function hiveworkBranding(): Plugin {
  return {
    name: "hivework-branding",
    config() {
      const parent = path.resolve(
        dashboardRoot,
        "../logs/hivework-branding/public",
      );
      mkdirSync(parent, { recursive: true });
      const publicDir = mkdtempSync(path.join(parent, "vite-"));
      cpSync(path.join(dashboardRoot, "public"), publicDir, {
        recursive: true,
      });
      cpSync(path.join(dashboardRoot, "branding/assets"), publicDir, {
        recursive: true,
      });
      for (const file of ["octop-mascot-peek.webm", "octop-mascot-type.webm"]) {
        rmSync(path.join(publicDir, file), { force: true });
      }
      const manifestPath = path.join(publicDir, "manifest.json");
      writeFileSync(
        manifestPath,
        JSON.stringify(
          brandManifest(JSON.parse(readFileSync(manifestPath, "utf8"))),
          null,
          2,
        ),
      );
      const offlinePath = path.join(publicDir, "offline.html");
      writeFileSync(
        offlinePath,
        brandOfflineHtml(readFileSync(offlinePath, "utf8")),
      );
      return { publicDir, define: brandingDefines() };
    },
    transformIndexHtml: { order: "pre", handler: brandIndexHtml },
  };
}
