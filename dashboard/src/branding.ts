interface BrandProfile {
  id: string;
  name: { en: string; zh: string };
  description: { en: string; zh: string };
  repository_url: string;
  support_url: string;
  upstream_repository_url: string;
  allow_official_self_update: boolean;
  default_palette: "tech";
}
type Bundle = { [key: string]: string | Bundle };
declare const __HIVEWORK_PROFILE__: BrandProfile;
declare const __HIVEWORK_EN__: Bundle;
declare const __HIVEWORK_ZH__: Bundle;
export const brand = __HIVEWORK_PROFILE__;
export function brandName(locale: string): string {
  return brand.name[locale.startsWith("zh") ? "zh" : "en"];
}
function merge(base: Bundle, overlay: Bundle): Bundle {
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const original = result[key];
    result[key] =
      typeof value === "string"
        ? value
        : merge(typeof original === "object" ? original : {}, value);
  }
  return result;
}
export function applyBranding(bundle: Bundle, locale: "zh" | "en"): Bundle {
  const result = merge(
    bundle,
    locale === "zh" ? __HIVEWORK_ZH__ : __HIVEWORK_EN__,
  );
  result.brand = { ...(result.brand as Bundle), name: brandName(locale) };
  return result;
}
