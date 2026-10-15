"use client";
import { useSitePreferences } from "./SitePreferences";
import { formatSiteTime } from "@/lib/site-preferences";
import { useEffect, useState } from "react";
import type { RateRow, Comparison } from "@/lib/carriers/types";
import { rateTotal, taxLabel, comparableTax } from "@/lib/rate-suggestion";
import { useToast } from "./ToastProvider";
import { downloadPageImage } from "@/lib/page-image";
import { clientApi } from "@/lib/client-api";
import type { Shipment } from "@/lib/schemas";
import { carrierIds } from "@/lib/schemas";
import { carrierNames, formatPrice as price, formatEta as eta, serviceKey, type RateTableShipment, rateTableCaption, buildRateTable, copyRateTable, copyApiResult } from "@/lib/rate-table";
export default function RateResults({
  result,
  busy,
  coverageAmount,
  shipment,
  preferencesKey,
  labelShipment,
  shipmentEdited = false,
  generationEnabled = false,
}: {
  result: Comparison | null;
  busy: boolean;
  coverageAmount: number;
  shipment: RateTableShipment;
  preferencesKey: string;
  labelShipment?: Shipment | null;
  shipmentEdited?: boolean;
  generationEnabled?: boolean;
}) {
  const { preferences } = useSitePreferences();
  const coverage = coverageAmount > 0;
  const [sort, setSort] = useState("price");
  const [includeTax, setIncludeTax] = useState(false);
  const [hiddenServices, setHiddenServices] = useState<string[]>([]);
  const notify = useToast();
  const [imageBusy, setImageBusy] = useState(false);
  const [generatingLabels, setGeneratingLabels] = useState<string[]>([]);
  const [confirmLabel, setConfirmLabel] = useState<string | null>(null);
  const [labelError, setLabelError] = useState("");
  const showLabels = generationEnabled && result?.mode === "sandbox" && !!labelShipment && result.carrierStatuses.some((s) => s.carrier === "loomis" && s.source === "live_carrier" && ["success", "partial"].includes(s.status));
  const storageKey = `shipping:hidden-services:${preferencesKey}`;
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      setHiddenServices(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : []);
    } catch { setHiddenServices([]); }
  }, [storageKey]);
  async function generateLabel(r: RateRow) {
    if (!labelShipment || !generationEnabled || shipmentEdited) return;
    setConfirmLabel(null);
    const rowKey = `${r.carrier}:${r.serviceCode}:${r.variant}`;
    setGeneratingLabels((previous) => [...previous, rowKey]); setLabelError("");
    try {
      const response: { labelId: string; labels: string[] } = await clientApi("sandbox", "loomis/labels", "POST", { shipment: labelShipment, serviceCode: r.serviceCode });
      const generated = response.labels.map((png, i) => ({ id: `${response.labelId}-${i + 1}`, png }));
      for (const label of generated) {
        const download = document.createElement("a");
        download.href = `data:image/png;base64,${label.png}`;
        download.download = `loomis-sandbox-${label.id}.png`;
        document.body.appendChild(download);
        download.click();
        download.remove();
      }
      notify("Label saved and downloaded. View it again in Labels.");
    } catch (error) { setLabelError((error as Error).message); }
    finally { setGeneratingLabels((previous) => previous.filter((key) => key !== rowKey)); }
  }
  function saveHiddenServices(next: string[]) {
    setHiddenServices(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the setting for this visit. */ }
  }
  const services = [...new Map((result?.results ?? []).map((row) => [serviceKey(row), row])).values()];
  const hiddenCount = services.filter((row) => hiddenServices.includes(serviceKey(row))).length;
  useEffect(() => { if (busy) { setSort("price"); setConfirmLabel(null); } }, [busy]);
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
      {result && shipmentEdited && <div className="stale-rates-note" role="status"><strong>Shipment details changed</strong><span>Previous rates are kept below. Compare again to update them.</span></div>}
      <div className="results-head">
        <div>
          <h2>Shipping rates</h2>
          <p className="subtle" style={{ margin: "7px 0 0" }}>
            {rateTableCaption(coverageAmount, includeTax).replace("Shipping rates · ", "")}
          </p>
          <p className="subtle" style={{ margin: "7px 0 0" }}>
            {result
              ? `${rows.length} shown of ${result.results.length} rates · ${formatSiteTime(result.quotedAt, preferences)}`
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
            <div className="actions" style={{ margin: 0 }}>
            <button type="button" className="secondary" disabled={busy || !rows.length}
              onClick={async () => {
                try {
                  await copyRateTable(buildRateTable(rows, coverage, includeTax, coverageAmount, shipment));
                  notify(`Table copied: ${rows.length} rates. Paste into Teams or another app.`);
                } catch { notify("Could not copy the table. Allow clipboard access and try again.", "error"); }
              }}>Copy table</button>
            <button type="button" className="secondary" title="Download the full page as JPG" aria-busy={imageBusy} disabled={busy || imageBusy}
              onClick={async () => {
                setImageBusy(true);
                try { await downloadPageImage(); notify("Full page downloaded as shipping-calculator.jpg."); }
                catch (error) { notify((error as Error).message || "Could not download the page image.", "error"); }
                finally { setImageBusy(false); }
              }}>Copy image</button>
            </div>
          </div>
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
                    {showLabels && <th>Sandbox label</th>}
                  </tr>
                </thead>
                <tbody>
                  {result.carrierStatuses.filter((status) => status.status === "quoting").map((status) => (
                    <tr key={`pending-${status.carrier}`} className="quoting-row">
                      <td><span className="service">{carrierNames[status.carrier]}</span><span className="subtle">Requesting carrier rates…</span></td>
                      <td colSpan={coverage ? 4 : 3}><span className="quote-skeleton" /></td>
                      <td><span className="status-badge quoting"><span className="quote-spinner" aria-hidden="true" />Quoting…</span></td>
                      {showLabels && <td />}
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
                          try { await copyApiResult(r); notify(`API result copied: ${r.serviceName}.`); }
                          catch (error) { notify((error as Error).message || "Could not copy the API result.", "error"); }
                        }}><span aria-hidden="true">›</span> Copy API result</button>
                      </div></td>
                      {showLabels && <td>{r.carrier === "loomis" && ["DD", "DE", "DN", "D9"].includes(r.serviceCode) ? (
                        confirmLabel === `${r.carrier}:${r.serviceCode}:${r.variant}` ? <div className="label-confirmation" role="group" aria-label={`Confirm label for ${r.serviceName}`}>
                          <span className="subtle">Generate and download label?</span>
                          <div className="label-confirmation-actions">
                            <button type="button" className="secondary label-button" disabled={busy || shipmentEdited} onClick={() => void generateLabel(r)}>Yes</button>
                            <button type="button" className="secondary label-button" onClick={() => setConfirmLabel(null)}>No</button>
                          </div>
                        </div> : <button type="button" className="secondary label-button" disabled={busy || shipmentEdited || generatingLabels.includes(`${r.carrier}:${r.serviceCode}:${r.variant}`)} onClick={() => setConfirmLabel(`${r.carrier}:${r.serviceCode}:${r.variant}`)}>
                          {generatingLabels.includes(`${r.carrier}:${r.serviceCode}:${r.variant}`) ? "Generating…" : "Generate Label"}
                        </button>
                      ) : <span className="subtle">—</span>}</td>}
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
      {labelError && <p role="alert">{labelError}</p>}
      <div className="notice">
        Carrier quotes are estimates; final charges and coverage terms may
        differ. Declared value does not guarantee insurance coverage. Comparisons and shipment details are saved in Rate logs.
        <br />
        Rates use your own parcel packaging. FedEx quotes assume drop-off at a
        staffed location.
      </div>
    </section>
  );
}
