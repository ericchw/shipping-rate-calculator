"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import AddressFields, { blankAddress, profileAddress } from "./AddressFields";
import RateResults from "./RateResults";
import CarrierSettings from "./CarrierSettings";
import AdminAccounts from "./AdminAccounts";
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
import { convert, todayInVancouver, roundMeasurementUp, measurementValue } from "@/lib/units";
import type { Comparison } from "@/lib/carriers/types";
import { carrierNames } from "@/lib/rate-table";
type Session = {
  user: { id: string; email: string; role: string; channel?: string; webAccess?: boolean } | null;
  modes: ("sandbox" | "production")[];
  mode: "sandbox" | "production";
  source: string;
};
type EditablePackage = Omit<Shipment["packages"][number], "weight" | "length" | "width" | "height"> & Record<"weight" | "length" | "width" | "height", number | string>;
const initialPackage: EditablePackage = {
  length: 0,
  width: 0,
  height: 0,
  dimensionUnit: "in",
  weight: 0,
  weightUnit: "lb",
};
export default function ShippingApp({ initialMode = "production", page = "rate" }: { initialMode?: AppMode; page?: AppPage }) {
  const router = useRouter();
  const api = useCallback((path: string, method = "GET", value?: unknown) => clientApi(initialMode, path, method, value), [initialMode]);
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
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
  const [result, setResult] = useState<Comparison | null>(null);
  const [quoteCarriers, setQuoteCarriers] = useState<Shipment["carriers"]>([...carrierIds]);
  const generation = useRef(0);
  const clear = () => {
    generation.current++;
    setResult(null);
  };
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
  const loadCarrierSelection = useCallback(async (environment: "sandbox" | "production", source?: string) => {
    if (source === "mock") { setQuoteCarriers([...carrierIds]); return; }
    const data = await api(`carrier-settings?mode=${environment}`);
    setQuoteCarriers(data.settings.filter((setting: { enabled: boolean }) => setting.enabled)
      .map((setting: { carrier: Shipment["carriers"][number] }) => setting.carrier));
  }, [api]);
  useEffect(() => {
    setShipDate(todayInVancouver());
    api("auth/session")
      .then((s) => {
        s = { ...s, user: browserUser(s.user) };
        setSession(s);
        setMode(s.mode);
        if (!s.user && page !== "login") { redirectToLogin(initialMode); return; }
        if (s.user && page === "login") {
          router.replace(safeReturnPath(initialMode, new URLSearchParams(window.location.search).get("next")));
          return;
        }
        if (s.user && page === "rate") {
          void loadProfiles(true).catch((e) => setError(e.message));
          void loadCarrierSelection(s.mode, s.source).catch((e) => setError(e.message));
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
      try { const current = await api("auth/session"); if (!stopped && !browserUser(current.user)) redirectToLogin(initialMode); } catch { /* The next check retries temporary network failures. */ }
    };
    const timer = setInterval(() => void check(), 30000);
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [api, initialMode, page, session?.user]);
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
      router.replace(safeReturnPath(initialMode, new URLSearchParams(window.location.search).get("next")));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function profileAction(fn: () => Promise<unknown>) {
    setError("");
    setMessage("");
    setProfileBusy(true);
    try {
      await fn();
      await loadProfiles();
      setMessage("Profile changes saved.");
    } catch (e) {
      setError((e as Error).message);
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
    setBusy(true);
    clear();
    const id = generation.current;
    const payload = {
      ship_from: origin, ship_to: destination,
      ...(selected ? { ship_from_profile_id: selected } : {}),
      shipDate, packages: [{ ...parcel, weight: measurementValue(parcel.weight), length: measurementValue(parcel.length), width: measurementValue(parcel.width), height: measurementValue(parcel.height) }], signatureRequired: signature,
      coverageAmount: Number(coverage || 0), coverageCurrency: "CAD", carrierMode: mode,
    };
    setParcel({ ...payload.packages[0] });
    setResult({ requestId: `pending-${id}`, quotedAt: new Date().toISOString(), mode,
      appEnvironment: mode === "sandbox" ? "development" : "production", results: [],
      carrierStatuses: quoteCarriers.map((carrier) => ({ carrier, mode,
        source: session?.source === "mock" ? "mock" : "live_carrier", status: "quoting", message: null })),
    });
    try {
      await Promise.all(quoteCarriers.map(async (carrier) => {
        try {
          const response: Comparison = await api("rates", "POST", { ...payload, carriers: [carrier] });
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
              ? { ...status, status: (error as Error).name === "TimeoutError" ? "timeout" : "error", message: (error as Error).name === "TimeoutError" ? "The carrier request timed out. Try again." : (error as Error).message } : status),
          } : previous);
        }
      }));
    } finally { setBusy(false); }
  }

  function reset() {
    clear();
    setDestination({ ...blankAddress });
    setParcel({ ...initialPackage });
    setSignature(true);
    setCoverage("");
    setShipDate(todayInVancouver());
    setError("");
    setMessage("");
    setToOpen(true);
    setPackageOpen(true);
    setManage(false);
    void loadCarrierSelection(mode, session?.source).catch((e) => setError(e.message));
    const p = profiles.find((p) => p.is_default);
    setFromOpen(!p);
    setSelected(p?.id ?? "");
    setProfileName(p?.profile_name ?? "");
    setOrigin(p ? profileAddress(p) : { ...blankAddress });
  }
  const changeOrigin = (a: Address) => {
    clear();
    setOrigin(a);
  };
  const changeDestination = (a: Address) => {
    clear();
    setDestination(a);
  };
  return (
    <>
      <header>
        <div className="brand">
          Shipping Rate Calculator
        </div>
        <div className="header-right">
          {session?.user && <nav className="app-nav" aria-label="Main navigation">
            {(["home", "rate", "setting", "docs"] as const).map((item) => <Link key={item} href={pagePath(mode, item)} aria-current={page === item ? "page" : undefined}>{item === "home" ? "Home" : item === "rate" ? "Rates" : item === "docs" ? "API docs" : "Settings"}</Link>)}
            {session.user.role === "admin" && <Link href={pagePath(mode, "admin")} aria-current={page === "admin" ? "page" : undefined}>Admin</Link>}
            <Link className="environment-link" href={pagePath(mode === "sandbox" ? "production" : "sandbox", "home")}>{mode === "sandbox" ? "Production" : "Sandbox / UAT"}</Link>
          </nav>}
          {session?.user && (
            <button
              className="text-button"
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
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className={!booting && !session?.user ? "login-page" : undefined}>
        {session?.user && <>
        <h1>{page === "admin" ? "Account administration" : page === "docs" ? "API documentation" : page === "setting" ? "Settings" : page === "home" ? "Shipping calculator" : "Compare shipping rates"}</h1>
        <p className="subtitle">
          {page === "admin" ? "Manage accounts, roles and access permissions." : page === "docs" ? "Call the shipping calculator from your own application." : page === "setting" ? "Manage your carrier connections and credentials." : page === "home" ? "Choose an action below to get started." : "Enter the addresses, package size, and weight to compare Canada Post, Loomis Express, and FedEx."}
        </p>
        </>}
        {booting ? (
          <p role="status">Loading…</p>
        ) : !session?.user && page !== "login" ? (
          <div>{error ? <><p className="error" role="alert">{error}</p><Link href={pagePath(initialMode, "login")}>Go to login</Link></> : <p role="status">Redirecting to login…</p>}</div>
        ) : !session?.user ? (
          <section className="panel login" aria-labelledby="login-title">
            <div className="login-heading">
              <div className="login-symbol" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.25l8 4.5"/></svg>
              </div>
              <span className="login-environment">{initialMode === "sandbox" ? "Sandbox / UAT" : "Production"}</span>
              <h1 id="login-title">Sign in</h1>
              <p>Calculate shipping rates and use your saved addresses.</p>
            </div>
            <form className="section login-form" onSubmit={signIn}>
              <label>
                Email
                <input
                  name="email"
                  placeholder="you@company.com"
                  type="email"
                  autoComplete="username"
                  required
                />
              </label>
              <label htmlFor="login-password">Password</label>
              <div className="password-field">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  required
                />
                <button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>
                    {showPassword && <path d="m3 3 18 18"/>}
                  </svg>
                </button>
              </div>
              <button className="primary login-submit" disabled={busy}>
                {busy ? <><span className="quote-spinner" aria-hidden="true" /> Signing in…</> : <>Sign in <span aria-hidden="true">→</span></>}
              </button>
              {error && (
                <div role="alert" className="error">
                  {error}
                </div>
              )}
            </form>
            <div className="login-carriers">Canada Post <span>·</span> Loomis Express <span>·</span> FedEx
              <Link className="login-area-link" href={pagePath(initialMode === "sandbox" ? "production" : "sandbox", "login")}>{initialMode === "sandbox" ? "Production login" : "Sandbox / UAT login"} →</Link>
            </div>
          </section>
        ) : (
          <>
            {session.modes.length === 0 && (
              <div className="error">
                Sign in to access your carrier settings.
              </div>
            )}
            {page === "home" && <div className="home-actions">
              <Link className="panel home-action" href={pagePath(mode, "rate")}><h2>Compare rates <span aria-hidden="true">→</span></h2><p>Enter shipment details and compare carrier services.</p></Link>
              <Link className="panel home-action" href={pagePath(mode, "setting")}><h2>Carrier settings <span aria-hidden="true">→</span></h2><p>Save API credentials, enable carriers, and test connections.</p></Link>
            </div>}
            {page === "admin" && <AdminAccounts mode={mode} />}
            {page === "docs" && <ApiDocs mode={mode} />}
            {page === "setting" && <CarrierSettings initialMode={mode} onSaved={clear} />}
            {page === "rate" && <div className="workspace">
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
                  <h2>Shipment details</h2>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={reset}
                  >
                    Reset
                  </button>
                </div>
                <fieldset
                  disabled={busy}
                  style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                >
                  <div className="section quote-carriers">
                    <h3>Carriers to quote</h3>
                    <div className="filters">
                      {carrierIds.map((carrier) => (
                        <label key={carrier} className="check">
                          <input type="checkbox" checked={quoteCarriers.includes(carrier)}
                            onChange={(event) => {
                              clear();
                              setQuoteCarriers(event.target.checked
                                ? [...quoteCarriers, carrier]
                                : quoteCarriers.filter((selectedCarrier) => selectedCarrier !== carrier));
                            }} />
                          {carrierNames[carrier]}
                        </label>
                      ))}
                    </div>
                    {!quoteCarriers.length && <p className="inline-note">Select at least one carrier.</p>}
                  </div>
                  <details className="shipment-section" open={fromOpen} onToggle={(e) => setFromOpen(e.currentTarget.open)}>
                    <summary className="section-heading">
                      <span><span className="step">1</span>Ship From</span>
                      <span className="section-summary">{profiles.find((p) => p.id === selected)?.profile_name || origin.city || "Origin address"}{origin.postal_code ? ` · ${origin.postal_code}` : ""}</span>
                    </summary>
                    <div className="section-body">
                    <label>
                      Saved Ship From Profile
                      <select
                        aria-label="Saved Ship From Profile"
                        value={selected}
                        disabled={profileBusy}
                        onChange={(e) => {
                          if (e.target.value === "manage") {
                            setManage(true);
                            setFromOpen(true);
                            return;
                          }
                          clear();
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
                        <option value="">New address</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.profile_name}
                            {p.is_default ? " (default)" : ""}
                          </option>
                        ))}
                        <option value="manage">Manage profiles</option>
                      </select>
                    </label>
                    <div style={{ marginTop: 16 }}>
                      <AddressFields sandbox={mode === "sandbox"}
                        prefix="from"
                        value={origin}
                        onChange={changeOrigin}
                      />
                    </div>
                    <details
                      open={manage}
                      onToggle={(e) => setManage(e.currentTarget.open)}
                    >
                      <summary>Save or manage origin profiles</summary>
                      <label style={{ marginTop: 14 }}>
                        Profile name
                        <input
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
                                "ship-from-profiles",
                                "POST",
                                { profile_name: profileName, address: origin },
                              );
                              setSelected(p.id);
                            })
                          }
                        >
                          Save as profile
                        </button>
                        {selected && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={profileBusy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Overwrite this saved profile with the displayed origin and profile name?",
                                )
                              )
                                void profileAction(() =>
                                  api(
                                    `ship-from-profiles/${selected}`,
                                    "PATCH",
                                    {
                                      profile_name: profileName,
                                      address: origin,
                                    },
                                  ),
                                );
                            }}
                          >
                            Update profile
                          </button>
                        )}
                        {selected && (
                          <>
                            <button type="button" className="secondary"
                              disabled={profileBusy || !!profiles.find((p) => p.id === selected)?.is_default}
                              onClick={() => profileAction(() => api(`ship-from-profiles/${selected}/default`, "PUT"))}>
                              {profiles.find((p) => p.id === selected)?.is_default ? "Default profile" : "Set default"}
                            </button>
                            <button type="button" className="text-button profile-delete" disabled={profileBusy}
                              onClick={() => {
                                if (window.confirm("Delete this saved profile? This removes its stored address."))
                                  void profileAction(async () => {
                                    await api(`ship-from-profiles/${selected}`, "DELETE");
                                    setSelected(""); setProfileName(""); clear();
                                  });
                              }}>Delete profile</button>
                          </>
                        )}
                      </div>
                      {profileBusy && (
                        <p role="status">Saving / loading profiles…</p>
                      )}
                      {profiles.length === 0 && !profileBusy && (
                        <p className="subtle">No saved profiles yet.</p>
                      )}

                    </details>
                    {message && (
                      <p role="status" className="subtle">
                        {message}
                      </p>
                    )}
                    </div>
                  </details>
                  <details className="shipment-section" open={toOpen} onToggle={(e) => setToOpen(e.currentTarget.open)}>
                    <summary className="section-heading">
                      <span><span className="step">2</span>Ship To</span>
                      <span className="section-summary">{destination.city || "Destination address"}{destination.postal_code ? ` · ${destination.postal_code}` : ""}</span>
                    </summary>
                    <div className="section-body">
                    <AddressFields sandbox={mode === "sandbox"}
                      prefix="to"
                      value={destination}
                      onChange={changeDestination}
                    />
                    <label style={{ marginTop: 16 }}>
                      Ship date
                      <input
                        type="date"
                        value={shipDate}
                        required
                        onChange={(e) => {
                          clear();
                          setShipDate(e.target.value);
                        }}
                      />
                    </label>
                    <p className="inline-note">
                      Default: today in Vancouver. Check carrier holiday
                      availability.
                    </p>
                    </div>
                  </details>
                  <details className="shipment-section" open={packageOpen} onToggle={(e) => setPackageOpen(e.currentTarget.open)}>
                    <summary className="section-heading">
                      <span><span className="step">3</span>Package</span>
                      <span className="section-summary">{parcel.weight} {parcel.weightUnit} · {parcel.length} × {parcel.width} × {parcel.height} {parcel.dimensionUnit}</span>
                    </summary>
                    <div className="section-body">
                      <div className="package-unit-switch" role="group" aria-label="Package measurement system">
                        {(["imperial", "metric"] as const).map((system) => <button key={system} type="button" aria-pressed={(parcel.weightUnit === "lb" ? "imperial" : "metric") === system} onClick={() => {
                          clear();
                          const weightUnit = system === "metric" ? "kg" : "lb";
                          const dimensionUnit = system === "metric" ? "cm" : "in";
                          setParcel((previous) => ({ ...previous, weightUnit, dimensionUnit,
                            weight: previous.weight === "" ? "" : roundMeasurementUp(convert(Number(previous.weight), previous.weightUnit, weightUnit)),
                            length: previous.length === "" ? "" : roundMeasurementUp(convert(Number(previous.length), previous.dimensionUnit, dimensionUnit)),
                            width: previous.width === "" ? "" : roundMeasurementUp(convert(Number(previous.width), previous.dimensionUnit, dimensionUnit)),
                            height: previous.height === "" ? "" : roundMeasurementUp(convert(Number(previous.height), previous.dimensionUnit, dimensionUnit)),
                          }));
                        }}>{system === "imperial" ? "Imperial · lb / in" : "Metric · kg / cm"}</button>)}
                      </div>
                      <p className="inline-note">Blank or zero measurements use 1 in the selected units when requesting rates.</p>
                      <div className="package-measurements">
                        {(["weight", "length", "width", "height"] as const).map((field) => <label key={field} htmlFor={field}>
                          {field[0].toUpperCase() + field.slice(1)} ({field === "weight" ? parcel.weightUnit : parcel.dimensionUnit})
                          <input id={field} type="number" min="0" max="1000" step="any" placeholder="0" value={parcel[field]}
                            onChange={(event) => { clear(); setParcel({ ...parcel, [field]: event.target.value }); }}
                            onBlur={() => { if (parcel[field] !== "" && Number(parcel[field]) > 0) setParcel(previous => ({ ...previous, [field]: measurementValue(previous[field]) })); }} />
                        </label>)}
                      </div>
                    </div>
                  </details>
                  <div className="section">
                    <h3>
                      <span className="step">4</span>Additional options
                    </h3>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={signature}
                        onChange={(e) => {
                          clear();
                          setSignature(e.target.checked);
                        }}
                      />
                      Signature required
                    </label>
                    <label style={{ marginTop: 18 }}>
                      Coverage / declared value (CAD)
                      <input
                        type="number"
                        placeholder="Optional · e.g. 500.00"
                        min="0"
                        max="99999.99"
                        step="0.01"
                        value={coverage}
                        onChange={(e) => {
                          clear();
                          setCoverage(e.target.value);
                        }}
                      />
                    </label>
                    <p className="inline-note">
                      Compare with and without declared value. Carrier terms and
                      exclusions apply.
                    </p>
                  </div>
                </fieldset>
                <div className="form-footer">
                  {error && (
                    <div role="alert" className="error">
                      {error}
                    </div>
                  )}
                  <button
                    className="primary"
                    disabled={busy || session.modes.length === 0 || quoteCarriers.length === 0}
                  >
                    <span>{busy ? "Comparing rates…" : "Compare rates"}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </form>
              <RateResults
                preferencesKey={`${mode}:${session.user?.id ?? ""}`}
                result={result}
                busy={busy}
                coverage={Number(coverage) > 0}
              />
            </div>}
          </>
        )}
        <footer>
          <span className="footer-credit">ericchw © 2026</span>
          <span className="footer-carriers"><span>Supported carriers:</span> Canada Post · Loomis Express · FedEx</span>
        </footer>
      </main>
    </>
  );
}
