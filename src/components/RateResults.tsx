"use client";
import { useI18n } from "./UIPreferences";
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
import { carrierNames, formatPrice as price, formatEta as eta, serviceKey, type RateTableShipment, rateTableCaption, buildRateTable, copyRateTable, copyApiResult, copyApiRequest } from "@/lib/rate-table";
export default function RateResults({
  availableCarriers = carrierIds,
  result,
  busy,
  coverageAmount,
  shipment,
  preferencesKey,
  labelShipment,
  shipmentEdited = false,
  generationEnabled = false,
}: {
  availableCarriers?: readonly Shipment["carriers"][number][];
  result: Comparison | null;
  busy: boolean;
  coverageAmount: number;
  shipment: RateTableShipment;
  preferencesKey: string;
  labelShipment?: Shipment | null;
  shipmentEdited?: boolean;
  generationEnabled?: boolean;
}) {
  const { t } = useI18n();
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
  async function copyRequest(carrier?: RateRow["carrier"]) {
    if (!labelShipment) return;
    try { await copyApiRequest(labelShipment, carrier); notify(carrier ? `Request copied: ${carrierNames[carrier]}.` : t("Shipment request copied.")); }
    catch (error) { notify((error as Error).message || t("Could not copy the request."), "error"); }
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
    <section aria-label={t("Rate comparison")}>
      {result && shipmentEdited && <div className="stale-rates-note" role="status"><strong>{t("Shipment details changed")}</strong><span>{t("Previous rates are kept below. Compare again to update them.")}</span></div>}
      <div className="results-head">
        <div>
          <h2>{t("Shipping rates")}</h2>
          <p className="subtle" style={{ margin: "7px 0 0" }}>
            {t(rateTableCaption(coverageAmount, includeTax).replace("Shipping rates · ", ""))}
          </p>
          <p className="subtle" style={{ margin: "7px 0 0" }}>
            {result
              ? t(`${rows.length} shown of ${result.results.length} rates · ${formatSiteTime(result.quotedAt, preferences)}`)
              : t("All your carriers. One clear comparison.")}
          </p>
        </div>
        <span className="pill">
          {busy ? t("COMPARING…") : result ? (result.results.length ? t("QUOTES READY") : t("NO RATES")) : t(`${availableCarriers.length} CARRIERS`)}
        </span>
      </div>
      {result && (
        <div className="carrier-api-strip" aria-label={t("Carrier API status")} aria-live="polite">
          {result.carrierStatuses.map((status) => {
            const pending = status.status === "quoting";
            const success = status.status === "success";
            const label = pending ? t("Quoting…") : success ? t("Success") : status.status === "disabled" ? t("Disabled") : status.status === "timeout" ? t("Timeout") : status.status === "partial" ? t("Partial quotes") : status.status === "unconfigured" ? t("Not configured") : status.status === "unavailable" ? t("No rates") : t("Error");
            return <div key={status.carrier} className={`carrier-api-card ${success ? "api-success" : pending ? "api-pending" : "api-error"}`} role={success || pending ? undefined : "alert"}>
              <div className="carrier-api-heading">
                <strong>{carrierNames[status.carrier]}</strong>
                <span className={`status-badge ${pending ? "quoting" : success ? "positive" : "warning"}`}>
                  <span className={pending ? "quote-spinner" : undefined} aria-hidden="true">{pending ? "" : success ? "✓" : "!"}</span>{t(label)}
                </span>
              </div>
              {status.message && <p className="carrier-api-message">{t(status.message)}</p>}
            </div>;
          })}
        </div>
      )}
      {result && (
        <>
          <div className="summary">
            {cheapest && (
              <div>
                <span className="eyebrow">{t("LOWEST CAD TOTAL ·")}{" "}{coverage ? t("WITH COVERAGE") : t("WITHOUT COVERAGE")}</span>
                <strong>{price(rateTotal(cheapest, coverage, includeTax), "CAD")}</strong>
                <span className="subtle">
                  {carrierNames[cheapest.carrier]} · {cheapest.serviceName}
                </span>
              </div>
            )}

          </div>
          <div className="result-toolbar">
            <label className="check"><input type="checkbox" checked={includeTax} onChange={(event) => setIncludeTax(event.target.checked)} />{t("Include tax")}</label>
            <select
              aria-label={t("Sort rates")}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="price">{t("Lowest price (by currency)")}</option>
              <option value="eta">{t("Fastest estimate")}</option>
              <option value="carrier">{t("Carrier")}</option>
            </select>
          </div>
          <div className="service-actions">
            <details className="service-settings">
              <summary>{t("Show / hide services")}{hiddenCount ? ` ${t(`(${hiddenCount} hidden)`)}` : ""}</summary>
              <div className="service-settings-body">
                <p className="subtle">{t("Checked services appear in the comparison and copied table. Choices are saved in this browser.")}</p>
                <button type="button" className="text-button" onClick={() => saveHiddenServices([])}>{t("Show all services")}</button>
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
                      {!services.some((row) => row.carrier === carrier) && <p className="subtle">{t("No services returned for this shipment.")}</p>}
                    </fieldset>
                  ))}
                </div>
              </div>
            </details>
            <div className="actions" style={{ margin: 0 }}>
            <button type="button" className="secondary" disabled={!labelShipment} title={t("Copy calculator API request JSON for this comparison")} onClick={() => void copyRequest()}>{t("Copy request")}</button>
            <button type="button" className="secondary" disabled={busy || !rows.length}
              onClick={async () => {
                try {
                  await copyRateTable(buildRateTable(rows, coverage, includeTax, coverageAmount, shipment));
                  notify(`Table copied: ${rows.length} rates. Paste into Teams or another app.`);
                } catch { notify("Could not copy the table. Allow clipboard access and try again.", "error"); }
              }}>{t("Copy table")}</button>
            <button type="button" className="secondary" title={t("Download the full page as JPG")} aria-busy={imageBusy} disabled={busy || imageBusy}
              onClick={async () => {
                setImageBusy(true);
                try { await downloadPageImage(); notify("Full page downloaded as shipping-calculator.jpg."); }
                catch (error) { notify((error as Error).message || "Could not download the page image.", "error"); }
                finally { setImageBusy(false); }
              }}>{t("Copy image")}</button>
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
            <h3>{t("Your next shipment, compared.")}</h3>
            <p>{t("Enter your shipment details to see rates and delivery estimates side by side.")}{" "}</p>
            <div className="carrier-logos">
              {availableCarriers.map(carrier => <span key={carrier}>{carrierNames[carrier]}</span>)}
            </div>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("Carrier / service")}</th>
                    <th>{t("Delivery estimate")}</th>
                    <th>{coverage ? t("Without coverage") : t("Rate")}</th>
                    {coverage && (
                      <>
                        <th>{t("With coverage")}</th>
                      </>
                    )}
                    <th>{t("Signature")}</th>
                    <th>{t("Status")}</th>
                    {showLabels && <th>{t("Sandbox label")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {result.carrierStatuses.filter((status) => status.status === "quoting").map((status) => (
                    <tr key={`pending-${status.carrier}`} className="quoting-row">
                      <td><span className="service">{carrierNames[status.carrier]}</span><span className="subtle">{t("Requesting carrier rates…")}</span></td>
                      <td colSpan={coverage ? 4 : 3}><span className="quote-skeleton" /></td>
                      <td><span className="status-badge quoting"><span className="quote-spinner" aria-hidden="true" />{t("Quoting…")}</span></td>
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
                          <summary>{t("Quote details")}</summary>
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
                      <td>{t(eta(r))}</td>
                      <td>
                        <span className="price">
                          {price(rateTotal(r, false, includeTax), r.currency)}
                        </span>
                        <span className="meta">
                          {r.currency} ·{" "}
                          {t(taxLabel(r, false, includeTax))}
                        </span>
                      </td>
                      {coverage && (
                        <>
                          <td>
                            {r.withCoverage.available ? (
                              <><span className="price">
                                {price(rateTotal(r, true, includeTax), r.currency)}
                              </span><span className="meta">{t(taxLabel(r, true, includeTax))}</span></>
                            ) : (
                              <span className="subtle">
                                {r.withCoverage.status === "carrier_error"
                                  ? t("Coverage quote failed")
                                  : t("Coverage not available")}
                              </span>
                            )}
                          </td>
                        </>
                      )}
                      <td>
                        <span className="signature-icon positive" role="img" aria-label={r.signature.includedInQuote ? t("Signature quoted") : t("Signature not quoted")} title={r.signature.includedInQuote ? t("Signature requested and quoted") : t("No signature quoted")}>
                          {r.signature.includedInQuote ? "✓" : "—"}
                        </span>
                      </td>
                      <td><div className="row-result-status"><span className={`status-badge ${coverage && !r.withCoverage.available ? "warning" : "positive"}`}><span aria-hidden="true">{coverage && !r.withCoverage.available ? "!" : "✓"}</span> {coverage && !r.withCoverage.available ? t("Base quoted") : t("Success")}</span>
                        <button type="button" className="copy-api-result" disabled={!labelShipment || !labelShipment.carriers.includes(r.carrier)} aria-label={t(`Copy request for ${carrierNames[r.carrier]} ${r.serviceName}`)} title={t("Copy calculator API request JSON for this carrier")} onClick={() => void copyRequest(r.carrier)}><span aria-hidden="true">‹</span>{" "}{t("Copy request")}</button>
                        <button type="button" className="copy-api-result" disabled={r.apiResult === undefined} aria-label={t(`Copy API result for ${carrierNames[r.carrier]} ${r.serviceName}`)} onClick={async () => {
                          try { await copyApiResult(r); notify(`API result copied: ${r.serviceName}.`); }
                          catch (error) { notify((error as Error).message || "Could not copy the API result.", "error"); }
                        }}><span aria-hidden="true">›</span>{" "}{t("Copy API result")}</button>
                      </div></td>
                      {showLabels && <td>{r.carrier === "loomis" && ["DD", "DE", "DN", "D9"].includes(r.serviceCode) ? (
                        confirmLabel === `${r.carrier}:${r.serviceCode}:${r.variant}` ? <div className="label-confirmation" role="group" aria-label={t(`Confirm label for ${r.serviceName}`)}>
                          <span className="subtle">{t("Generate and download label?")}</span>
                          <div className="label-confirmation-actions">
                            <button type="button" className="secondary label-button" disabled={busy || shipmentEdited} onClick={() => void generateLabel(r)}>{t("Yes")}</button>
                            <button type="button" className="secondary label-button" onClick={() => setConfirmLabel(null)}>{t("No")}</button>
                          </div>
                        </div> : <button type="button" className="secondary label-button" disabled={busy || shipmentEdited || generatingLabels.includes(`${r.carrier}:${r.serviceCode}:${r.variant}`)} onClick={() => setConfirmLabel(`${r.carrier}:${r.serviceCode}:${r.variant}`)}>
                          {generatingLabels.includes(`${r.carrier}:${r.serviceCode}:${r.variant}`) ? t("Generating…") : t("Generate Label")}
                        </button>
                      ) : <span className="subtle">—</span>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && !busy && (
              <p style={{ padding: 20 }}>
                {result.results.length ? t("All returned services are hidden. Use Show all services.") : t("No quotes available. Check the carrier statuses above.")}
              </p>
            )}

          </>
        )}
      </div>
      {labelError && <p role="alert">{labelError}</p>}
      <div className="notice">{t("Carrier quotes are estimates; final charges and coverage terms may differ. Declared value does not guarantee insurance coverage. Comparisons and shipment details are saved in Rate logs.")}{" "}<br />{t("Rates use your own parcel packaging. FedEx quotes assume drop-off at a staffed location.")}{" "}</div>
    </section>
  );
}
