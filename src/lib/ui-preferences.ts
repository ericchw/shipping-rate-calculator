export const uiPreferencesKey = "shipping:appearance";
export const languages = ["en", "fr", "zh-TW", "zh-CN"] as const;
export type Language = typeof languages[number];
export type Theme = "system" | "light" | "dark";
export type UIPreferences = { language: Language; theme: Theme };
export const defaultUIPreferences: UIPreferences = { language: "en", theme: "system" };
export function readUIPreferences(value: unknown): UIPreferences {
  const saved = value && typeof value === "object" ? value as Partial<UIPreferences> : {};
  return {
    language: languages.includes(saved.language as Language) ? saved.language! : "en",
    theme: ["system", "light", "dark"].includes(saved.theme ?? "") ? saved.theme! : "system",
  };
}
