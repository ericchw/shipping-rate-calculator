import type { Language } from "./ui-preferences";
import messages from "./translations.json";
const catalog: Record<string, string[]> = Object.fromEntries(Object.entries(messages).map(([key, values]) => [key.replace(/\s+/g, " ").trim(), values]));
const patterns = Object.entries(catalog).filter(([key]) => /\{\w+\}/.test(key)).map(([key, values]) => {
  const names: string[] = [];
  const escaped = key.split(/(\{\w+\})/).map(part => {
    if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return "(.+?)"; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return { regex: new RegExp(`^${escaped}$`), names, values };
});
export function translate(text: string, language: Language): string {
  if (language === "en" || !text.trim()) return text;
  const normalized = text.replace(/\s+/g, " ").trim();
  const index = language === "fr" ? 0 : language === "zh-TW" ? 1 : 2;
  let translated = catalog[normalized]?.[index];
  if (!translated) {
    for (const pattern of patterns) {
      const match = normalized.match(pattern.regex);
      if (match) {
        translated = pattern.values[index].replace(/\{(\w+)\}/g, (token, key) => {
          const position = pattern.names.indexOf(key); return position >= 0 ? match[position + 1] : token;
        }); break;
      }
    }
  }
  if (!translated && normalized.includes(" · ")) translated = normalized.split(" · ").map(part => translate(part, language)).join(" · ");
  return translated ? text.replace(text.trim(), translated.trim()) : text;
}
