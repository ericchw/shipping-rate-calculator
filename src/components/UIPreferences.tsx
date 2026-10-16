"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { defaultUIPreferences, readUIPreferences, uiPreferencesKey, type UIPreferences } from "@/lib/ui-preferences";
import { translate } from "@/lib/i18n";
const Context = createContext<{ preferences: UIPreferences; update(value: Partial<UIPreferences>): void } | null>(null);
export function UIPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(defaultUIPreferences);
  const [ready, setReady] = useState(false);
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const load = () => { try { setPreferences(readUIPreferences(JSON.parse(localStorage.getItem(uiPreferencesKey) ?? "null"))); } catch { setPreferences(defaultUIPreferences); } };
    load(); setReady(true);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches); change();
    media.addEventListener("change", change);
    const sync = (event: StorageEvent) => { if (event.key === uiPreferencesKey || event.key === null) load(); };
    window.addEventListener("storage", sync);
    return () => { media.removeEventListener("change", change); window.removeEventListener("storage", sync); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = preferences.theme === "system" ? (systemDark ? "dark" : "light") : preferences.theme;
    document.documentElement.lang = preferences.language;
    document.title = translate("Shipping Rate Calculator", preferences.language);
  }, [preferences, systemDark, ready]);
  const update = useCallback((value: Partial<UIPreferences>) => {
    const next = readUIPreferences({ ...preferences, ...value });
    setPreferences(next);
    try { localStorage.setItem(uiPreferencesKey, JSON.stringify(next)); } catch { /* Preferences still apply for this visit. */ }
  }, [preferences]);
  return <Context.Provider value={{ preferences, update }}>{children}</Context.Provider>;
}
export function useUIPreferences() {
  const value = useContext(Context);
  if (!value) throw new Error("UI preferences require a provider");
  return value;
}
export function useI18n() {
  const { preferences } = useUIPreferences();
  const t = useCallback((text: string) => translate(text, preferences.language), [preferences.language]);
  return { t, language: preferences.language };
}
export function AppearanceControls() {
  const { preferences, update } = useUIPreferences();
  const { t } = useI18n();
  return <div className="appearance-controls">
    <label><span className="sr-only">{t("Language")}</span><select aria-label={t("Language")} value={preferences.language} onChange={event => update({ language: event.target.value as UIPreferences["language"] })}>
      <option value="en">EN</option><option value="fr">FR</option><option value="zh-TW">繁體中文</option><option value="zh-CN">简体中文</option>
    </select></label>
    <button type="button" className="theme-toggle" aria-label={t(preferences.theme === "system" ? "System theme · Switch to dark mode" : preferences.theme === "dark" ? "Dark mode · Switch to light mode" : "Light mode · Use system theme")}
      title={t(preferences.theme === "system" ? "System theme · Switch to dark mode" : preferences.theme === "dark" ? "Dark mode · Switch to light mode" : "Light mode · Use system theme")}
      onClick={() => update({ theme: preferences.theme === "system" ? "dark" : preferences.theme === "dark" ? "light" : "system" })}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {preferences.theme === "system" ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></> : preferences.theme === "dark" ? <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
      </svg>
    </button>
  </div>;
}
