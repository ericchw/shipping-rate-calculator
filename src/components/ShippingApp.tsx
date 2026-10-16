"use client";
import { useI18n } from "./UIPreferences";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppearanceControls } from "./UIPreferences";
import QuoteLogModal from "./QuoteLogModal";
import { useToast } from "./ToastProvider";
import AddressFields, { blankAddress, profileAddress } from "./AddressFields";
import GoogleMapsButton from "./GoogleMapsButton";
import SettingsWorkspace from "./SettingsWorkspace";
import { useSitePreferences } from "./SitePreferences";
import LabelPages from "./LabelPages";
import RateResults from "./RateResults";
import ApiDocs from "./ApiDocs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserUser, pagePath, safeReturnPath, type AppMode, type AppPage } from "@/lib/app-routes";
import { clientApi, redirectToLogin } from "@/lib/client-api";
import {
  carrierIds,
  type Address,
  type Profile,
  type Shipment,
} from "@/lib/schemas";
import { convert, todayInTimeZone, roundMeasurementUp, measurementValue, dimensionValue } from "@/lib/units";
import type { Comparison } from "@/lib/carriers/types";
import { carrierNames } from "@/lib/rate-table";
type Session = {
  user: { id: string; email: string; role: string; channel?: string; webAccess?: boolean } | null;
  modes: ("sandbox" | "production")[];
  mode: "sandbox" | "production";
  source: string;
  generationEnabled: boolean;
  group: { id: string; name: string } | null;
};
type EditablePackage = Omit<Shipment["packages"][number], "weight" | "length" | "width" | "height" | "quantity"> & Record<"weight" | "length" | "width" | "height" | "quantity", number | string>;
const initialPackage: EditablePackage = {
  length: 0,
  width: 0,
  height: 0,
  dimensionUnit: "in",
  weight: 1,
  weightUnit: "lb",
  quantity: 1,
};
export default function ShippingApp({ initialMode = "production", page = "rate", labelId }: { initialMode?: AppMode; page?: AppPage; labelId?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const notify = useToast();
  const [logsOpen, setLogsOpen] = useState(false);
  const { preferences, ready: preferencesReady } = useSitePreferences();
  const previousTimeZone = useRef<string | null>(null);
  const api = useCallback((path: string, method = "GET", value?: unknown) => clientApi(initialMode, path, method, value), [initialMode]);
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState("");
  const [manage, setManage] = useState(false);
  const [fromOpen, setFromOpen] = useState(true);
  const [toOpen, setToOpen] = useState(true);
  const [packageOpen, setPackageOpen] = useState(true);
  const [profileName, setProfileName] = useState("");
  const [origin, setOrigin] = useState<Address>({ ...blankAddress });
  const [destination, setDestination] = useState<Address>({ ...blankAddress });
  const [parcel, setParcel] = useState({ ...initialPackage });
  const [shipDate, setShipDate] = useState("");
  const [mode, setMode] = useState<"sandbox" | "production">(initialMode);
  const [signature, setSignature] = useState(true);
  const [coverage, setCoverage] = useState("");
  const [labelShipment, setLabelShipment] = useState<Shipment | null>(null);
  const [quotesStale, setQuotesStale] = useState(false);
  const [result, setResult] = useState<Comparison | null>(null);
  const [enabledCarriers, setEnabledCarriers] = useState<Shipment["carriers"]>([]);
  const [quoteCarriers, setQuoteCarriers] = useState<Shipment["carriers"]>([]);
  const [carriersLoading, setCarriersLoading] = useState(true);
  const generation = useRef(0);
  const clear = () => {
    generation.current++;
    setResult(null);
    setLabelShipment(null);
    setQuotesStale(false);
  };
  const markEdited = () => setQuotesStale(true);
  const loadProfiles = useCallback(async (useDefault = false) => {
    setProfileBusy(true);
    try {
      const data = await api("ship-from-profiles");
      setProfiles(data.profiles);
      if (useDefault) {
        const p = data.profiles.find((p: Profile) => p.is_default);
        if (p) {
          setOrigin(profileAddress(p));
          setSelected(p.id);
          setProfileName(p.profile_name);
          setFromOpen(false);
        }
      }
    } finally {
      setProfileBusy(false);
    }
  }, [api]);
  const loadCarrierSelection = useCallback(async (environment: "sandbox" | "production") => {
    setCarriersLoading(true);
    try {
      const data = await api(`carrier-settings?mode=${environment}`);
      const enabled = data.settings.filter((setting: { enabled: boolean }) => setting.enabled)
        .map((setting: { carrier: Shipment["carriers"][number] }) => setting.carrier);
      setEnabledCarriers(enabled);
      setQuoteCarriers(enabled);
    } finally { setCarriersLoading(false); }
  }, [api]);
  useEffect(() => {
    api("auth/session")
      .then((s) => {
        s = { ...s, user: browserUser(s.user) };
        setSession(s);
        setMode(s.mode);
        if (!s.user && page !== "login") { redirectToLogin(initialMode); return; }
        if (s.user && !s.modes.includes(initialMode)) { router.replace(pagePath(s.modes[0], "home")); return; }
        if (s.user && page === "login") {
          router.replace(s.modes.includes(initialMode) ? safeReturnPath(initialMode, new URLSearchParams(window.location.search).get("next")) : pagePath(s.modes[0], "home"));
          return;
        }
        if (s.user && page === "rate") {
          void loadProfiles(true).catch((e) => setError(e.message));
          void loadCarrierSelection(s.mode).catch((e) => setError(e.message));
        }
      })
      .catch((e) =>
        setError(
          e.name === "TimeoutError"
            ? "The server took too long to respond. Refresh to try again."
            : e.message,
        ),
      )
      .finally(() => setBooting(false));
  }, [api, initialMode, page, router, loadProfiles, loadCarrierSelection]);
  useEffect(() => {
    if (!session?.user || page === "login") return;
    let stopped = false;
    const check = async () => {
      try { const current = await api("auth/session"); if (!stopped) { if (!browserUser(current.user)) redirectToLogin(initialMode); else if (!current.modes.includes(initialMode)) window.location.assign(pagePath(current.modes[0], "home")); else setSession(current); } } catch { /* The next check retries temporary network failures. */ }
    };
    const timer = setInterval(() => void check(), 30000);
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [api, initialMode, page, session?.user]);
  useEffect(() => {
    if (!preferencesReady) return;
    const previous = previousTimeZone.current;
    if (previous === preferences.timeZone) return;
    const today = todayInTimeZone(preferences.timeZone);
    if ((!shipDate || (previous && shipDate === todayInTimeZone(previous))) && shipDate !== today) {
      setShipDate(today);
      setQuotesStale(true);
    }
    previousTimeZone.current = preferences.timeZone;
  }, [preferences.timeZone, preferencesReady, shipDate]);
  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
      await api("auth/login", "POST", {
        channel: "web",
        email: data.get("email"),
        password: data.get("password"),
      });
      const s = await api("auth/session");
      setSession(s);
      setMode(s.mode);
      router.replace(s.modes.includes(initialMode) ? safeReturnPath(initialMode, new URLSearchParams(window.location.search).get("next")) : pagePath(s.modes[0], "home"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function profileAction(fn: () => Promise<unknown>) {
    setProfileError("");
    setMessage("");
    setProfileBusy(true);
    try {
      await fn();
      await loadProfiles();
      setMessage("Profile changes saved.");
    } catch (e) {
      setProfileError((e as Error).message);
    } finally {
      setProfileBusy(false);
    }
  }
  async function quote(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!quoteCarriers.length) {
      setError("Select at least one carrier. You can enable carriers in Carrier settings.");
      return;
    }
    if (!Number.isInteger(Number(parcel.quantity)) || Number(parcel.quantity) < 1 || Number(parcel.quantity) > 100) {
      setError("Enter a whole number of boxes from 1 to 100."); setPackageOpen(true); return;
    }
    const sizes = [parcel.length, parcel.width, parcel.height].map(Number);
    if (sizes.some((value) => value > 0) && sizes.some((value) => value === 0)) {
      setError("Enter all three dimensions, or leave all three at 0 for a quote without dimensions.");
      setPackageOpen(true);
      return;
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    const comparisonId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    setBusy(true);
    clear();
    const id = generation.current;
    const payload = {
      ship_from: origin, ship_to: destination,
      ...(selected ? { ship_from_profile_id: selected } : {}),
      shipDate, packages: [{ ...parcel, quantity: Number(parcel.quantity), weight: measurementValue(parcel.weight), length: dimensionValue(parcel.length), width: dimensionValue(parcel.width), height: dimensionValue(parcel.height) }], signatureRequired: signature,
      coverageAmount: Number(coverage || 0), coverageCurrency: "CAD", carrierMode: mode,
    };
    setLabelShipment({ ...payload, coverageCurrency: "CAD", carriers: [...quoteCarriers] });
    setParcel({ ...payload.packages[0] });
    setResult({ requestId: `pending-${id}`, quotedAt: new Date().toISOString(), mode,
      appEnvironment: mode === "sandbox" ? "development" : "production", results: [],
      carrierStatuses: quoteCarriers.map((carrier) => ({ carrier, mode,
        source: session?.source === "mock" ? "mock" : "live_carrier", status: "quoting", message: null })),
    });
    try {
      await Promise.all(quoteCarriers.map(async (carrier) => {
        try {
          const response: Comparison = await api("rates", "POST", { ...payload, carriers: [carrier], comparisonId, comparisonCarriers: [...quoteCarriers] });
          if (generation.current !== id) return;
          setResult((previous) => previous ? { ...previous, quotedAt: response.quotedAt,
            results: [...previous.results.filter((row) => row.carrier !== carrier), ...response.results],
            carrierStatuses: previous.carrierStatuses.map((status) => status.carrier === carrier
              ? response.carrierStatuses.find((next) => next.carrier === carrier) ?? { ...status, status: "error", message: "Carrier returned no status." }
              : status),
          } : previous);
        } catch (error) {
          if (generation.current !== id) return;
          setResult((previous) => previous ? { ...previous,
            carrierStatuses: previous.carrierStatuses.map((status) => status.carrier === carrier
              ? { ...status, status: (error as Error).name === "TimeoutError" ? "timeout" : "error", message: (error as Error).name === "TimeoutError" ? t("The carrier request timed out. Try again.") : (error as Error).message } : status),
          } : previous);
        }
      }));
    } finally { setBusy(false); }
  }

  function restoreLog(shipment: Shipment) {
    markEdited();
    setOrigin(shipment.ship_from); setDestination(shipment.ship_to); setParcel({ ...shipment.packages[0], quantity: shipment.packages[0].quantity ?? 1 });
    setSelected(""); setProfileName(""); setSignature(shipment.signatureRequired); setCoverage(shipment.coverageAmount ? String(shipment.coverageAmount) : "");
    const today = todayInTimeZone(preferences.timeZone);
    setShipDate(shipment.shipDate < today ? today : shipment.shipDate);
    const active = shipment.carriers.filter(carrier => enabledCarriers.includes(carrier));
    setQuoteCarriers(active.length ? active : [...enabledCarriers]);
    setFromOpen(true); setToOpen(true); setPackageOpen(true);
    notify(shipment.shipDate < today ? t("Shipping details loaded. Past ship date updated to today. Compare rates for current prices.") : t("Shipping details loaded. Compare rates for current prices."));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function reset() {
    markEdited();
    setDestination({ ...blankAddress });
    setParcel({ ...initialPackage });
    setSignature(true);
    setCoverage("");
    setShipDate(todayInTimeZone(preferences.timeZone));
    setError("");
    setMessage("");
    setToOpen(true);
    setPackageOpen(true);
    setManage(false);
    setProfileError("");
    void loadCarrierSelection(mode).catch((e) => setError(e.message));
    const p = profiles.find((p) => p.is_default);
    setFromOpen(!p);
    setSelected(p?.id ?? "");
    setProfileName(p?.profile_name ?? "");
    setOrigin(p ? profileAddress(p) : { ...blankAddress });
  }
  const changeOrigin = (a: Address) => {
    markEdited();
    setOrigin(a);
  };
  const changeDestination = (a: Address) => {
    markEdited();
    setDestination(a);
  };
  return (
    <div data-page-capture>
      {initialMode === "sandbox" && <div className="sandbox-environment-banner">{t("SANDBOX Environment")}</div>}
      <header className="site-header">
        <div className="brand">{t("Shipping Rate Calculator")}{" "}</div>
        <div className="header-right">
          {session?.user && <div className="environment-switch" role="group" aria-label={t("Environment")}>
            {(["production", "sandbox"] as const).filter(environment => session.modes.includes(environment)).map(environment => <Link key={environment} href={pagePath(environment, "home")} aria-current={mode === environment ? "true" : undefined} data-environment={environment}>
              <span className="environment-dot" aria-hidden="true" />{t(environment === "production" ? "Production" : "Sandbox / UAT")}
            </Link>)}
          </div>}
          <AppearanceControls />
          {session?.user && (
            <button
              className="nav-signout"
              title={t("Sign out")}
              aria-label={t("Sign out")}
              onClick={async () => {
                if (!window.dispatchEvent(new Event("shipping:before-leave", { cancelable: true }))) return;
                try {
                  await api("auth/logout", "POST");
                  clear();
                  setProfiles([]);
                  setOrigin({ ...blankAddress });
                  setDestination({ ...blankAddress });
                  setSelected("");
                  router.replace(pagePath(initialMode, "login"));
                  setSession(await api("auth/session"));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            ><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5H5v14h4M14 8l4 4-4 4M9 12h12" /></svg><span>{t("Sign out")}</span></button>
          )}
        </div>
          {session?.user && <nav className="app-nav" aria-label={t("Main navigation")}>
            {(["home", "rate", "labels", "setting", "docs"] as const).map((item) => <Link key={item} href={pagePath(mode, item)} aria-current={page === item || item === "setting" && page === "admin" ? "page" : undefined}>{item === "home" ? t("Home") : item === "rate" ? t("Rates") : item === "labels" ? t("Labels") : item === "docs" ? t("API Docs") : t("Settings")}</Link>)}
          </nav>}
      </header>
      <main className={!booting && !session?.user ? "login-page" : undefined}>
        {session?.user && <>
        <h1>{page === "labels" ? labelId ? t("Label details") : t("Generated labels") : page === "admin" ? t("Settings") : page === "docs" ? t("API documentation") : page === "setting" ? t("Settings") : page === "home" ? t("Shipping calculator") : t("Compare shipping rates")}</h1>
        <p className="subtitle">
          {page === "labels" ? t("View saved labels and shipment details, or download a label again.") : page === "admin" ? t("Manage company groups, carrier connections, accounts and access permissions.") : page === "docs" ? t("Call the shipping calculator from your own application.") : page === "setting" ? t("Your preferences, company workspace and access — in one place.") : page === "home" ? t("Choose an action below to get started.") : t("Enter the addresses, package size, and weight to compare rates from your enabled carriers.")}
        </p>
        </>}
        {booting ? (
          <p role="status">{t("Loading…")}</p>
        ) : !session?.user && page !== "login" ? (
          <div>{error ? <><p className="error" role="alert">{t(error)}</p><Link href={pagePath(initialMode, "login")}>{t("Go to login")}</Link></> : <p role="status">{t("Redirecting to login…")}</p>}</div>
        ) : !session?.user ? (
          <section className="panel login" aria-labelledby="login-title">
            <div className="login-heading">
              <div className="login-symbol" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.25l8 4.5"/></svg>
              </div>
              <span className="login-environment">{initialMode === "sandbox" ? t("Sandbox / UAT") : t("Production")}</span>
              <h1 id="login-title">{t("Sign in")}</h1>
              <p>{t("Calculate shipping rates and use your saved addresses.")}</p>
            </div>
            <form className="section login-form" onSubmit={signIn}>
              <label>{t("Email")}{" "}<input
                  name="email"
                  placeholder="you@company.com"
                  type="email"
                  autoComplete="username"
                  required
                />
              </label>
              <label htmlFor="login-password">{t("Password")}</label>
              <div className="password-field">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder={t("Enter your password")}
                  required
                />
                <button type="button" className="password-toggle" aria-label={showPassword ? t("Hide password") : t("Show password")}
                  aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>
                    {showPassword && <path d="m3 3 18 18"/>}
                  </svg>
                </button>
              </div>
              <button className="primary login-submit" disabled={busy}>
                {busy ? <><span className="quote-spinner" aria-hidden="true" />{" "}{t("Signing in…")}</> : <>{t("Sign in")}{" "}<span aria-hidden="true">→</span></>}
              </button>
              {error && (
                <div role="alert" className="error">
                  {t(error)}
                </div>
              )}
            </form>
            <div className="login-carriers">{carrierIds.map(carrier => carrierNames[carrier]).join(" · ")}
              <Link className="login-area-link" href={pagePath(initialMode === "sandbox" ? "production" : "sandbox", "login")}>{initialMode === "sandbox" ? t("Production login") : t("Sandbox / UAT login")} →</Link>
            </div>
          </section>
        ) : (
          <>
            {session.modes.length === 0 && (
              <div className="error">{t("Sign in to access your carrier settings.")}{" "}</div>
            )}
            {page === "home" && <div className="home-actions">
              <Link className="panel home-action" href={pagePath(mode, "rate")}><h2>{t("Compare rates")}{" "}<span aria-hidden="true">→</span></h2><p>{t("Enter shipment details and compare carrier services.")}</p></Link>
              <Link className="panel home-action" href={`${pagePath(mode, "setting")}${session.user.role === "admin" ? "?section=companies" : ""}`}><h2>{session.user.role === "admin" ? t("Company administration") : t("Your settings")} <span aria-hidden="true">→</span></h2><p>{session.user.role === "admin" ? t("Manage groups, API connections and accounts.") : t("Manage your locations and time preferences.")}</p></Link>
            </div>}
            {page === "labels" && <LabelPages mode={mode} labelId={labelId} generationEnabled={session.generationEnabled} admin={session.user.role === "admin"} ownGroup={session.group} />}
            {page === "docs" && <ApiDocs mode={mode} />}
            {(page === "setting" || page === "admin") && <SettingsWorkspace mode={mode} user={session.user} group={session.group} generationEnabled={session.generationEnabled} adminPage={page === "admin"} onSaved={() => { void api("auth/session").then(setSession).catch((e: Error) => setError(e.message)); }} />}
            {page === "rate" && <><div className="rate-log-toolbar"><div className="rate-workspace-context"><span className="workspace-dot" aria-hidden="true" /><span>{session.group?.name || t("Company group required")}</span></div><button type="button" className="rate-history-button" aria-label={t("Rate logs")} disabled={busy} onClick={() => setLogsOpen(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7"/><path d="M12 7v5l3 2"/></svg><span>{t("Rate logs")}<small>{t("View saved comparisons")}</small></span><b aria-hidden="true">↗</b></button></div><QuoteLogModal open={logsOpen} mode={mode} company={session.group?.name} onClose={() => setLogsOpen(false)} onRestore={restoreLog} /><div className="workspace">
              <form className="panel" onSubmit={quote}
                onInvalidCapture={(event) => {
                  let parent = (event.target as HTMLElement).parentElement;
                  while (parent) {
                    if (parent instanceof HTMLDetailsElement) parent.open = true;
                    parent = parent.parentElement;
                  }
                }}
              >
                <div className="panel-title">
                  <h2>{t("Shipment details")}</h2>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={reset}
                  >{t("Reset")}{" "}</button>
                </div>
                <fieldset
                  disabled={busy}
                  style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                >
                  <div className="section quote-carriers">
                    <h3>{t("Carriers to quote")}</h3>
                    <div className="filters">
                      {enabledCarriers.map((carrier) => (
                        <label key={carrier} className="check">
                          <input type="checkbox" checked={quoteCarriers.includes(carrier)}
                            onChange={(event) => {
                              markEdited();
                              setQuoteCarriers(event.target.checked
                                ? [...quoteCarriers, carrier]
                                : quoteCarriers.filter((selectedCarrier) => selectedCarrier !== carrier));
                            }} />
                          {carrierNames[carrier]}
                        </label>
                      ))}
                    </div>
                    {carriersLoading ? <p className="inline-note" role="status">{t("Loading carriers…")}</p> : !enabledCarriers.length ? <p className="inline-note">{t("No carriers enabled for your company group.")}{" "}{session.user.role === "admin" ? <Link href={`${pagePath(mode, "setting")}?section=companies`}>{t("Configure carriers in Settings")}</Link> : <span>{t("Ask your administrator to enable a carrier.")}</span>}</p> : !quoteCarriers.length && <p className="inline-note">{t("Select at least one carrier.")}</p>}
                  </div>
                  <details className="shipment-section" open={fromOpen} onToggle={(e) => setFromOpen(e.currentTarget.open)}>
                    <summary className="section-heading">
                      <span><span className="step">1</span>{t("Ship From")}</span>
                      <span className="section-summary">{[origin.region, origin.city, origin.postal_code].filter(Boolean).join(" · ") || t("Origin address")}</span>
                    </summary>
                    <div className="section-body">
                    <label>{t("Saved Ship From Profile")}{" "}<select
                        aria-label={t("Saved Ship From Profile")}
                        value={selected}
                        disabled={profileBusy}
                        onChange={(e) => {
                          setProfileError("");
                          setMessage("");
                          markEdited();
                          const p = profiles.find(
                            (p) => p.id === e.target.value,
                          );
                          setFromOpen(!p);
                          setManage(false);
                          setSelected(p?.id ?? "");
                          setProfileName(p?.profile_name ?? "");
                          setOrigin(
                            p ? profileAddress(p) : { ...blankAddress },
                          );
                        }}
                      >
                        <option value="">{t("New address")}</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.profile_name}
                            {p.is_default ? " (default)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div style={{ marginTop: 16 }}>
                      <AddressFields sandbox={mode === "sandbox"} mode={mode}
                        prefix="from"
                        value={origin}
                        onChange={changeOrigin}
                      />
                    </div>
                    <details
                      open={manage}
                      onToggle={(e) => setManage(e.currentTarget.open)}
                    >
                      <summary>{t("Save profile")}</summary>
                      <label style={{ marginTop: 14 }}>{t("Profile name")}{" "}<input
                          value={profileName}
                          maxLength={100}
                          onChange={(e) => setProfileName(e.target.value)}
                        />
                      </label>
                      <div className="actions">
                        <button
                          type="button"
                          className="secondary"
                          disabled={profileBusy || !profileName.trim()}
                          onClick={() =>
                            profileAction(async () => {
                              const p = await api(
                                selected ? `ship-from-profiles/${selected}` : "ship-from-profiles",
                                selected ? "PATCH" : "POST",
                                { profile_name: profileName, address: origin },
                              );
                              setSelected(p.id);
                              setProfileName(p.profile_name);
                              setOrigin(profileAddress(p));
                            })
                          }
                        >
                          {profileBusy ? t("Saving…") : t("Save profile")}
                        </button>
                        {selected && (
                          <>
                            <button type="button" className="secondary"
                              disabled={profileBusy || !!profiles.find((p) => p.id === selected)?.is_default}
                              onClick={() => profileAction(() => api(`ship-from-profiles/${selected}/default`, "PUT"))}>
                              {profiles.find((p) => p.id === selected)?.is_default ? t("Default profile") : t("Set default")}
                            </button>
                            <button type="button" className="text-button profile-delete" disabled={profileBusy}
                              onClick={() => {
                                if (window.confirm("Delete this saved profile? This removes its stored address."))
                                  void profileAction(async () => {
                                    await api(`ship-from-profiles/${selected}`, "DELETE");
                                    setSelected(""); setProfileName(""); markEdited();
                                  });
                              }}>{t("Delete profile")}</button>
                          </>
                        )}
                      </div>
                      {profileError && <p role="alert" className="error">{profileError}</p>}
                      {profileBusy && (
                        <p role="status">{t("Saving / loading profiles…")}</p>
                      )}
                      {profiles.length === 0 && !profileBusy && (
                        <p className="subtle">{t("No saved profiles yet.")}</p>
                      )}

                    </details>
                    {message && (
                      <p role="status" className="subtle">
                        {t(message)}
                      </p>
                    )}
                    </div>
                  </details>
                  <details className="shipment-section" open={toOpen} onToggle={(e) => setToOpen(e.currentTarget.open)}>
                    <summary className="section-heading ship-to-section-heading">
                      <span className="ship-to-heading"><span><span className="step">2</span>{t("Ship To")}</span><GoogleMapsButton address={destination} /></span>
                      <span className="section-summary">{[destination.region, destination.city, destination.postal_code].filter(Boolean).join(" · ") || t("Destination address")}</span>
                    </summary>
                    <div className="section-body">
                    <AddressFields sandbox={mode === "sandbox"} mode={mode}
                      prefix="to"
                      value={destination}
                      onChange={changeDestination}
                    />
                    <label style={{ marginTop: 16 }}>{t("Ship date")}{" "}<input
                        type="date"
                        value={shipDate}
                        required
                        onChange={(e) => {
                          markEdited();
                          setShipDate(e.target.value);
                        }}
                      />
                    </label>
                    <p className="inline-note">{t("Time zone:")}{" "}<Link href={`${pagePath(mode, "setting")}#location-time-heading`} title={preferences.timeZone}>{preferences.timeZone.split("/").at(-1)?.replaceAll("_", " ")}</Link>
                    </p>
                    </div>
                  </details>
                  <details className="shipment-section" open={packageOpen} onToggle={(e) => setPackageOpen(e.currentTarget.open)}>
                    <summary className="section-heading">
                      <span><span className="step">3</span>{t("Package")}</span>
                      <span className="section-summary">{parcel.quantity} {Number(parcel.quantity) === 1 ? t("box") : t("boxes")} · {parcel.weight} {parcel.weightUnit}{" "}{t("each ·")}{" "}{parcel.length} × {parcel.width} × {parcel.height} {parcel.dimensionUnit}</span>
                    </summary>
                    <div className="section-body">
                      <div className="package-unit-switch" role="group" aria-label={t("Package measurement system")}>
                        {(["imperial", "metric"] as const).map((system) => <button key={system} type="button" aria-pressed={(parcel.weightUnit === "lb" ? "imperial" : "metric") === system} onClick={() => {
                          markEdited();
                          const weightUnit = system === "metric" ? "kg" : "lb";
                          const dimensionUnit = system === "metric" ? "cm" : "in";
                          setParcel((previous) => ({ ...previous, weightUnit, dimensionUnit,
                            weight: previous.weight === "" ? "" : roundMeasurementUp(convert(Number(previous.weight), previous.weightUnit, weightUnit)),
                            length: previous.length === "" ? "" : roundMeasurementUp(convert(Number(previous.length), previous.dimensionUnit, dimensionUnit)),
                            width: previous.width === "" ? "" : roundMeasurementUp(convert(Number(previous.width), previous.dimensionUnit, dimensionUnit)),
                            height: previous.height === "" ? "" : roundMeasurementUp(convert(Number(previous.height), previous.dimensionUnit, dimensionUnit)),
                          }));
                        }}>{system === "imperial" ? t("Imperial · lb / in") : t("Metric · kg / cm")}</button>)}
                      </div>
                      <div className="package-measurements">
                      <label htmlFor="boxes">{t("Boxes")}{" "}<input id="boxes" type="number" min="1" max="100" step="1" required value={parcel.quantity}
                          onChange={event => { markEdited(); setParcel({ ...parcel, quantity: event.target.value }); }} />
                      </label>
                        {(["weight", "length", "width", "height"] as const).map((field) => <label key={field} htmlFor={field}>
                          {t(field[0].toUpperCase() + field.slice(1))}{Number(parcel.quantity) > 1 ? ` ${t("per box")}` : ""} ({field === "weight" ? parcel.weightUnit : parcel.dimensionUnit})
                          <input id={field} type="number" min="0" max="1000" step="any" placeholder="0" value={parcel[field]}
                            onChange={(event) => { markEdited(); setParcel({ ...parcel, [field]: event.target.value }); }}
                            onBlur={() => { if (parcel[field] !== "" && Number(parcel[field]) > 0) setParcel(previous => ({ ...previous, [field]: measurementValue(previous[field]) })); }} />
                        </label>)}
                      </div>
                      <p className="inline-note">{t("Weight and dimensions are per box.")}{" "}{Number(parcel.quantity) > 1 && <>{t("Total weight:")}{" "}{roundMeasurementUp(Number(parcel.weight || 0) * Number(parcel.quantity))} {parcel.weightUnit}{t(". Multiple boxes are currently supported by Purolator only.")}</>}</p>
                      <p className="inline-note">{t("All three dimensions at 0 means no dimensions provided. Actual measurements may change final charges.")}</p>
                    </div>
                  </details>
                  <div className="section">
                    <h3>
                      <span className="step">4</span>{t("Additional options")}{" "}</h3>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={signature}
                        onChange={(e) => {
                          markEdited();
                          setSignature(e.target.checked);
                        }}
                      />{t("Signature required")}{" "}</label>
                    <label style={{ marginTop: 18 }}>{t("Coverage / declared value (CAD)")}{" "}<input
                        type="number"
                        placeholder={t("Optional · e.g. 500.00")}
                        min="0"
                        max="99999.99"
                        step="0.01"
                        value={coverage}
                        onChange={(e) => {
                          markEdited();
                          setCoverage(e.target.value);
                        }}
                      />
                    </label>
                    <p className="inline-note">{t("Compare with and without declared value. Carrier terms and exclusions apply.")}{" "}</p>
                  </div>
                </fieldset>
                <div className="form-footer">
                  {error && (
                    <div role="alert" className="error">
                      {t(error)}
                    </div>
                  )}
                  <button
                    className="primary"
                    disabled={busy || carriersLoading || session.modes.length === 0 || quoteCarriers.length === 0}
                  >
                    <span>{busy ? t("Comparing rates…") : t("Compare rates")}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </form>
              <RateResults
                availableCarriers={enabledCarriers}
                preferencesKey={`${mode}:${session.user?.id ?? ""}`}
                generationEnabled={session.generationEnabled}
                labelShipment={labelShipment}
                result={result}
                busy={busy}
                shipmentEdited={quotesStale}
                coverageAmount={labelShipment?.coverageAmount ?? (Number(coverage) || 0)}
                shipment={labelShipment ? { origin: labelShipment.ship_from, destination: labelShipment.ship_to, shipDate: labelShipment.shipDate, signatureRequired: labelShipment.signatureRequired, parcel: labelShipment.packages[0] } : { origin, destination, shipDate, signatureRequired: signature, parcel: {
                  ...parcel, quantity: Number(parcel.quantity), weight: measurementValue(parcel.weight),
                  length: dimensionValue(parcel.length), width: dimensionValue(parcel.width), height: dimensionValue(parcel.height),
                } }}
              />
            </div></>}
          </>
        )}
        <footer>
          <span className="footer-credit">ericchw © 2026</span>
          <span className="footer-carriers"><span>{t("Supported carriers:")}</span> {carrierIds.map(carrier => carrierNames[carrier]).join(" · ")}</span>
        </footer>
      </main>
    </div>
  );
}
