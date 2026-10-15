"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { defaultSitePreferences, readSitePreferences, sitePreferencesKey, type SitePreferences } from "@/lib/site-preferences";
const Context = createContext<{ preferences: SitePreferences; ready: boolean; storageAvailable: boolean; update(value: Partial<SitePreferences>): void } | null>(null);
export function SitePreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(defaultSitePreferences);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    const detected = readSitePreferences({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const load = () => {
      try { setPreferences(readSitePreferences(JSON.parse(localStorage.getItem(sitePreferencesKey) ?? "null"), detected)); }
      catch { setPreferences(detected); }
    };
    load(); setReady(true);
    const sync = (event: StorageEvent) => { if (event.key === sitePreferencesKey || event.key === null) load(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const update = useCallback((value: Partial<SitePreferences>) => {
    const next = readSitePreferences({ ...preferences, ...value }, preferences);
    setPreferences(next);
    try { localStorage.setItem(sitePreferencesKey, JSON.stringify(next)); setStorageAvailable(true); }
    catch { setStorageAvailable(false); }
  }, [preferences]);
  return <Context.Provider value={{ preferences, ready, storageAvailable, update }}>{children}</Context.Provider>;
}
export function useSitePreferences() {
  const context = useContext(Context);
  if (!context) throw new Error("Site preferences require a provider");
  return context;
}
