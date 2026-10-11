"use client";
import { useEffect, useState } from "react";
import type { Comparison } from "@/lib/carriers/types";
import { rateTotal, taxLabel, comparableTax } from "@/lib/rate-suggestion";
import { carrierIds } from "@/lib/schemas";
import { carrierNames, formatPrice as price, formatEta as eta, serviceKey, buildRateTable, copyRateTable, copyApiResult } from "@/lib/rate-table";
export default function RateResults({
  result,
  busy,
  coverage,
  preferencesKey,
}: {
  result: Comparison | null;
  busy: boolean;
  coverage: boolean;
  preferencesKey: string;
}) {
  const [sort, setSort] = useState("price");
  const [includeTax, setIncludeTax] = useState(false);
  const [hiddenServices, setHiddenServices] = useState<string[]>([]);
  const [copyMessage, setCopyMessage] = useState("");
  const storageKey = `shipping:hidden-services:${preferencesKey}`;
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      setHiddenServices(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : []);
    } catch { setHiddenServices([]); }
  }, [storageKey]);
  useEffect(() => { setCopyMessage(""); }, [result, coverage, sort, hiddenServices, includeTax]);
  function saveHiddenServices(next: string[]) {
    setHiddenServices(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the setting for this visit. */ }
  }
  const services = [...new Map((result?.results ?? []).map((row) => [serviceKey(row), row])).values()];
  const hiddenCount = services.filter((row) => hiddenServices.includes(serviceKey(row))).length;
  useEffect(() => { if (busy) setSort("price"); }, [busy]);
  const rows = (result?.results ?? [])
    .filter((r) => !hiddenServices.includes(serviceKey(r)))
    .toSorted((a, b) =>
      sort === "carrier"
        ? a.carrier.localeCompare(b.carrier)
        : sort === "eta"
          ? (a.eta.date ? Date.parse(a.eta.date) : Infinity) -
              (b.eta.date ? Date.parse(b.eta.date) : Infinity) ||
            (a.eta.businessDays ?? Infinity) - (b.eta.businessDays ?? Infinity)
          : a.currency.localeCompare(b.currency) ||
            (rateTotal(a, coverage, includeTax) === null ? Infinity : Number(rateTotal(a, coverage, includeTax))) - (rateTotal(b, coverage, includeTax) === null ? Infinity : Number(rateTotal(b, coverage, includeTax))),
    );
  const comparable = rows.filter((r) => r.currency === "CAD" && rateTotal(r, coverage, includeTax) !== null && comparableTax(r, coverage, includeTax));
  const cheapest = comparable.toSorted((a, b) => Number(rateTotal(a, coverage, includeTax)) - Number(rateTotal(b, coverage, includeTax)))[0];
  return (
    <section aria-label="Rate comparison">
      <div className="results-head">
        <div>
          <h2>Compare your options</h2>
          <p className="subtle" style={{ margin: "7px 0 0" }}>
            {result
              ? `${rows.length} shown of ${result.results.length} rates · ${new Date(result.quotedAt).toLocaleTimeString()}`
              : "All your carriers. One clear comparison."}
          </p>
        </div>
        <span className="pill">
          {busy ? "COMPARING…" : result ? (result.results.length ? "QUOTES READY" : "NO RATES") : "3 CARRIERS"}
        </span>
      </div>
      {result && (
        <div className="carrier-api-strip" aria-label="Carrier API status" aria-live="polite">
          {result.carrierStatuses.map((status) => {
            const pending = status.status === "quoting";
            const success = status.status === "success";
            const label = pending ? "Quoting…" : success ? "Success" : status.status === "disabled" ? "Disabled" : status.status === "timeout" ? "Timeout" : status.status === "partial" ? "Partial quotes" : status.status === "unconfigured" ? "Not configured" : status.status === "unavailable" ? "No rates" : "Error";
            return <div key={status.carrier} className={`carrier-api-card ${success ? "api-success" : pending ? "api-pending" : "api-error"}`} role={success || pending ? undefined : "alert"}>
              <div className="carrier-api-heading">
                <strong>{carrierNames[status.carrier]}</strong>
                <span className={`status-badge ${pending ? "quoting" : success ? "positive" : "warning"}`}>
                  <span className={pending ? "quote-spinner" : undefined} aria-hidden="true">{pending ? "" : success ? "✓" : "!"}</span>{label}
                </span>
              </div>
              {status.message && <p className="carrier-api-message">{status.message}</p>}
            </div>;
          })}
        </div>
      )}
      {result && (
        <>
          <div className="summary">
            {cheapest && (
              <div>
                <span className="eyebrow">LOWEST CAD TOTAL · {coverage ? "WITH COVERAGE" : "WITHOUT COVERAGE"}</span>
                <strong>{price(rateTotal(cheapest, coverage, includeTax), "CAD")}</strong>
                <span className="subtle">
                  {carrierNames[cheapest.carrier]} · {cheapest.serviceName}
                </span>
              </div>
            )}

          </div>
          <div className="result-toolbar">
            <label className="check"><input type="checkbox" checked={includeTax} onChange={(event) => setIncludeTax(event.target.checked)} />Include tax</label>
            <select
              aria-label="Sort rates"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="price">Lowest price (by currency)</option>
              <option value="eta">Fastest estimate</option>
              <option value="carrier">Carrier</option>
            </select>
          </div>
          <div className="service-actions">
            <details className="service-settings">
              <summary>Show / hide services{hiddenCount ? ` (${hiddenCount} hidden)` : ""}</summary>
              <div className="service-settings-body">
                <p className="subtle">Checked services appear in the comparison and copied table. Choices are saved in this browser.</p>
                <button type="button" className="text-button" onClick={() => saveHiddenServices([])}>Show all services</button>
                <div className="service-groups">
                  {carrierIds.map((carrier) => (
                    <fieldset key={carrier}>
                      <legend>{carrierNames[carrier]}</legend>
                      {services.filter((row) => row.carrier === carrier).map((row) => (
                        <label key={serviceKey(row)} className="check">
                          <input type="checkbox" checked={!hiddenServices.includes(serviceKey(row))}
                            onChange={(event) => saveHiddenServices(event.target.checked
                              ? hiddenServices.filter((key) => key !== serviceKey(row))
                              : [...hiddenServices, serviceKey(row)])} />
                          {row.serviceName}
                        </label>
                      ))}
                      {!services.some((row) => row.carrier === carrier) && <p className="subtle">No services returned for this shipment.</p>}
                    </fieldset>
                  ))}
                </div>
              </div>
            </details>
            <button type="button" className="secondary" disabled={busy || !rows.length}
              onClick={async () => {
                try {
                  await copyRateTable(buildRateTable(rows, coverage, includeTax));
                  setCopyMessage(`Table copied: ${rows.length} rates. Paste into Teams or another app.`);
                } catch { setCopyMessage("Could not copy the table. Allow clipboard access and try again."); }
              }}>Copy table</button>
          </div>
          {copyMessage && <p className="subtle" role="status">{copyMessage}</p>}
        </>
      )}
      <div className="panel" aria-live="polite" aria-busy={busy}>
        {!result ? (
          <div className="empty">
            <div className="empty-symbol" aria-hidden="true">
              ↗
            </div>
            <h3>Your next shipment, compared.</h3>
            <p>
              Enter your shipment details to see rates and delivery estimates
              side by side.
            </p>
            <div className="carrier-logos">
              <span>Canada Post</span>
              <span>Loomis Express</span>
              <span>FedEx</span>
            </div>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Carrier / service</th>
                    <th>Delivery estimate</th>
                    <th>{coverage ? "Without coverage" : "Rate"}</th>
                    {coverage && (
                      <>
                        <th>With coverage</th>
                      </>
                    )}
                    <th>Signature</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.carrierStatuses.filter((status) => status.status === "quoting").map((status) => (
                    <tr key={`pending-${status.carrier}`} className="quoting-row">
                      <td><span className="service">{carrierNames[status.carrier]}</span><span className="subtle">Requesting carrier rates…</span></td>
                      <td colSpan={coverage ? 4 : 3}><span className="quote-skeleton" /></td>
                      <td><span className="status-badge quoting"><span className="quote-spinner" aria-hidden="true" />Quoting…</span></td>
                    </tr>
                  ))}
                  {rows.map((r) => (
                    <tr key={`${r.carrier}:${r.serviceCode}:${r.variant}`}>
                      <td>
                        <span className="service">
                          {carrierNames[r.carrier]}
                        </span>
                        {r.serviceName}
                        <details>
                          <summary>Quote details</summary>
                          {r.notices.map((n, i) => (
                            <p key={i} className="subtle">
                              {n}
                            </p>
                          ))}
                          {r.withoutCoverage.breakdown.map((b, i) => (
                            <p key={i}>
                              {b.label}: {b.amount} {r.currency}
                            </p>
                          ))}
                        </details>
                      </td>
                      <td>{eta(r)}</td>
                      <td>
                        <span className="price">
                          {price(rateTotal(r, false, includeTax), r.currency)}
                        </span>
                        <span className="meta">
                          {r.currency} ·{" "}
                          {taxLabel(r, false, includeTax)}
                        </span>
                      </td>
                      {coverage && (
                        <>
                          <td>
                            {r.withCoverage.available ? (
                              <><span className="price">
                                {price(rateTotal(r, true, includeTax), r.currency)}
                              </span><span className="meta">{taxLabel(r, true, includeTax)}</span></>
                            ) : (
                              <span className="subtle">
                                {r.withCoverage.status === "carrier_error"
                                  ? "Coverage quote failed"
                                  : "Coverage not available"}
                              </span>
                            )}
                          </td>
                        </>
                      )}
                      <td>
                        <span className="signature-icon positive" role="img" aria-label={r.signature.includedInQuote ? "Signature quoted" : "Signature not quoted"} title={r.signature.includedInQuote ? "Signature requested and quoted" : "No signature quoted"}>
                          {r.signature.includedInQuote ? "✓" : "—"}
                        </span>
                      </td>
                      <td><div className="row-result-status"><span className={`status-badge ${coverage && !r.withCoverage.available ? "warning" : "positive"}`}><span aria-hidden="true">{coverage && !r.withCoverage.available ? "!" : "✓"}</span> {coverage && !r.withCoverage.available ? "Base quoted" : "Success"}</span>
                        <button type="button" className="copy-api-result" disabled={r.apiResult === undefined} aria-label={`Copy API result for ${carrierNames[r.carrier]} ${r.serviceName}`} onClick={async () => {
                          try { await copyApiResult(r); setCopyMessage(`API result copied: ${r.serviceName}.`); }
                          catch (error) { setCopyMessage((error as Error).message || "Could not copy the API result."); }
                        }}><span aria-hidden="true">›</span> Copy API result</button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && !busy && (
              <p style={{ padding: 20 }}>
                {result.results.length ? "All returned services are hidden. Use Show all services." : "No quotes available. Check the carrier statuses above."}
              </p>
            )}

          </>
        )}
      </div>
      <div className="notice">
        Carrier quotes are estimates; final charges and coverage terms may
        differ. Declared value does not guarantee insurance coverage. Your
        quotes are not saved.
        <br />
        Rates use your own parcel packaging. FedEx quotes assume drop-off at a
        staffed location.
      </div>
    </section>
  );
}
