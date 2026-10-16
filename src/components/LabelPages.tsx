"use client";
import { useI18n } from "./UIPreferences";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/client-api";
import { pagePath, type AppMode } from "@/lib/app-routes";
import { loomisLabelServices, type LabelSummary, type SavedLabel } from "@/lib/label-types";
import { formatSiteDate, formatSiteTime } from "@/lib/site-preferences";
import { copyText, formatPrice } from "@/lib/rate-table";
import { hasPackageDimensions } from "@/lib/units";
import { useSitePreferences } from "./SitePreferences";
import { useToast } from "./ToastProvider";
import type { CompanyGroup } from "@/lib/groups";
import type { Address } from "@/lib/schemas";

const location = (address?: LabelSummary["ship_from"]) => address ? [address.region, address.city, address.postal_code].filter(Boolean).join(" · ") : "—";
function LabelAddress({ title, address }: { title: string; address: Address }) {
  return <section className="panel label-address-card"><span className="eyebrow">{title}</span><h3>{address.contact_name || address.company || address.city}</h3>
    <address>{address.company && address.company !== address.contact_name && <>{address.company}<br /></>}{address.address_line1}<br />{address.address_line2 && <>{address.address_line2}<br /></>}{address.city}, {address.region} {address.postal_code}<br />{address.country_code}</address>
    {address.phone && <p className="label-contact">{address.phone}</p>}{address.email && <p className="label-contact">{address.email}</p>}
  </section>;
}
export default function LabelPages({ mode, labelId, generationEnabled = false, admin = false, ownGroup }: { mode: AppMode; labelId?: string; generationEnabled?: boolean; admin?: boolean; ownGroup?: { id: string; name: string } | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const notify = useToast();
  const { preferences } = useSitePreferences();
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [groupId, setGroupId] = useState(ownGroup?.id || "");
  const [scopeReady, setScopeReady] = useState(false);
  useEffect(() => {
    let active = true;
    if (!admin) { setGroupId(ownGroup?.id || ""); setScopeReady(true); return; }
    clientApi(mode, "admin/groups").then(data => {
      if (!active) return;
      setGroups(data.groups);
      setGroupId(new URLSearchParams(window.location.search).get("groupId") || ownGroup?.id || data.groups[0]?.id || "");
      setScopeReady(true);
    }).catch((e: Error) => { if (active) { setError(e.message); setLoading(false); } });
    return () => { active = false; };
  }, [mode, admin, ownGroup?.id]);
  const scope = admin && groupId ? `${encodeURIComponent(groupId)}` : "";
  const groupQuery = scope ? `?groupId=${scope}` : "";
  const [records, setRecords] = useState<LabelSummary[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [record, setRecord] = useState<SavedLabel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!scopeReady) return;
    let active = true;
    setLoading(true); setError(""); setRecord(null);
    clientApi(mode, labelId ? `labels/${labelId}${groupQuery}` : `labels?page=${page}&pageSize=${pageSize}${scope ? `&groupId=${scope}` : ""}`).then((data) => {
      if (!active) return;
      if (labelId) setRecord(data); else {
        setRecords(data.labels); setTotal(data.total); setTotalPages(data.totalPages); setPage(data.page);
      }
    }).catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mode, labelId, page, pageSize, scopeReady, groupQuery, scope]);
  const base = pagePath(mode, "labels");
  if (loading && (labelId || !records.length)) return <div className="panel labels-loading" role="status"><span className="quote-spinner" aria-hidden="true" />{t("Loading labels…")}</div>;
  if (error) return <div className="panel labels-loading"><Link href={`${base}${groupQuery}`}>{t("Back to labels")}</Link><p role="alert" className="error">{t(error)}</p></div>;
  if (record) {
    const parcel = record.shipment.packages[0];
    return <>
      <div className="label-detail-toolbar"><Link href={`${base}${groupQuery}`}>{t("← All labels")}</Link><span className="label-environment">{record.mode === "sandbox" ? t("Sandbox") : t("Production")}</span></div>
      <section className="panel label-detail-hero">
        <div><span className="eyebrow">LOOMIS EXPRESS</span><h2>{loomisLabelServices[record.service_code] || record.service_code}</h2><p>{t("Generated")}{" "}{formatSiteDate(new Date(record.created_at), preferences)} · {formatSiteTime(record.created_at, preferences)}</p></div>
        <div className="label-hero-actions">
          {record.shipment_number && <button type="button" className="secondary label-button" onClick={async () => {
            try { await copyText(record.shipment_number); notify("Shipment number copied."); }
            catch { notify("Could not copy the shipment number.", "error"); }
          }}>{t("Copy shipment number")}</button>}
          <a className="primary" href={`data:image/png;base64,${record.labels[0]}`} download={`loomis-${record.mode}-${record.label_id}-1.png`} onClick={() => notify("Label download started.")}>{t("Download PNG")}</a>
        </div>
      </section>
      <div className="label-detail-grid">
        <section className="panel label-preview-panel"><div className="label-card-heading"><h3>{t("Label preview")}</h3><span className="pill">{record.labels.length} {t(record.labels.length === 1 ? "LABEL" : "LABELS")}</span></div>
          <p className="label-print-note">{t("Original PNG · Print at 4 × 6 inches, 100% scale")}</p>
          <div className="label-preview-gallery">{record.labels.map((png, index) => <figure className="label-paper" key={index}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/png;base64,${png}`} alt={`Loomis ${record.mode} label ${record.label_id}, package ${index + 1}`} />
            {record.labels.length > 1 && <figcaption>{t("Package")}{" "}{index + 1}<a href={`data:image/png;base64,${png}`} download={`loomis-${record.mode}-${record.label_id}-${index + 1}.png`}>{t("Download package")}{" "}{index + 1}</a></figcaption>}
          </figure>)}</div>
        </section>
        <div className="label-information">
          <section className="panel label-info-card"><h3>{t("Shipment details")}</h3><dl className="label-facts">
            <div><dt>{t("Shipment number")}</dt><dd className="label-reference">{record.shipment_number || t("Not returned")}</dd></div>
            <div><dt>{t("Label ID")}</dt><dd>{record.label_id}</dd></div><div><dt>{t("Ship date")}</dt><dd>{record.shipment.shipDate}</dd></div>
          </dl></section>
          <div className="label-address-grid"><LabelAddress title={t("Ship From")} address={record.shipment.ship_from} /><LabelAddress title={t("Ship To")} address={record.shipment.ship_to} /></div>
          <section className="panel label-info-card"><h3>{t("Package and options")}</h3><dl className="label-facts">
            <div><dt>{t("Weight")}</dt><dd>{parcel.weight} {parcel.weightUnit}</dd></div>
            <div><dt>{t("Dimensions")}</dt><dd>{hasPackageDimensions(parcel) ? `${parcel.length} × ${parcel.width} × ${parcel.height} ${parcel.dimensionUnit}` : t("Not provided")}</dd></div>
            <div><dt>{t("Signature")}</dt><dd>{record.shipment.signatureRequired ? t("Required") : t("Not requested")}</dd></div>
            <div><dt>{t("Declared value")}</dt><dd>{formatPrice(record.shipment.coverageAmount.toFixed(2), "CAD")} CAD</dd></div>
          </dl></section>
        </div>
      </div>
    </>;
  }
  return <>
    {admin && <label className="labels-group-selector">{t("Company group")}<select aria-label={t("Labels company group")} value={groupId} onChange={event => { const id = event.target.value; setGroupId(id); setPage(1); router.replace(`${base}?groupId=${encodeURIComponent(id)}`); }}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
    {!admin && ownGroup && <p className="subtle">{t("Company group:")}{" "}{ownGroup.name}</p>}
    <div className="labels-overview"><div><span className="eyebrow">{t("SAVED SHIPMENTS")}</span><strong>{total}</strong><span>{mode === "sandbox" ? t("Sandbox") : t("Production")}{" "}{t("labels ready to view or download")}</span></div><Link className="primary" href={pagePath(mode, "rate")}>{generationEnabled && groupId === ownGroup?.id && mode === "sandbox" ? t("Generate a new label →") : t("Compare rates →")}</Link></div>
    <section className="panel labels-table-panel" aria-busy={loading}>
      <div className="labels-table-heading"><div><h2>{t("Label history")}</h2><p>{loading ? t("Loading labels…") : t("Select a shipment to view its label and details.")}</p></div>
        <label className="label-page-size">{t("Rows per page")}<select disabled={loading} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
      </div>
      <div className="table-scroll"><table className="labels-table"><thead><tr><th>{t("Shipment")}</th><th>{t("Carrier / service")}</th><th>{t("Route")}</th><th>{t("Generated")}</th><th>{t("Details")}</th></tr></thead><tbody>
        {records.map((row) => <tr className="saved-label-row" key={row.id} onClick={(event) => { if (!(event.target as HTMLElement).closest("a")) router.push(`${base}/${row.id}${groupQuery}`); }}>
          <td><strong className="label-reference">{row.shipment_number || "—"}</strong><span className="label-cell-meta">{t("Label")}{" "}{row.label_id}</span></td>
          <td><strong>{loomisLabelServices[row.service_code] || row.service_code}</strong><span className="label-cell-meta">Loomis Express</span></td>
          <td><span className="label-route">{location(row.ship_from)}<span aria-hidden="true">↓</span>{location(row.ship_to)}</span></td>
          <td>{formatSiteDate(new Date(row.created_at), preferences)}<span className="label-cell-meta">{formatSiteTime(row.created_at, preferences)}</span></td>
          <td><Link className="label-view-link" href={`${base}/${row.id}${groupQuery}`}>{t("View label →")}</Link></td>
        </tr>)}
      </tbody></table></div>
      {!records.length && <div className="labels-empty"><span aria-hidden="true">▤</span><h3>{t("Your labels will appear here")}</h3><p>{t("Saved labels remain available here to view and download.")}</p><Link href={pagePath(mode, "rate")}>{t("Compare rates →")}</Link></div>}
      <nav className="label-pagination" aria-label={t("Label pages")}>
        <span>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total} shipments` : "0 shipments"}</span>
        <div className="label-page-controls"><button type="button" className="secondary label-button" disabled={loading || page === 1} onClick={() => setPage(1)}>{t("First")}</button><button type="button" className="secondary label-button" disabled={loading || page === 1} onClick={() => setPage((previous) => previous - 1)}>{t("Previous")}</button><span>{t("Page")}{" "}{page}{" "}{t("of")}{" "}{totalPages}</span><button type="button" className="secondary label-button" disabled={loading || page >= totalPages} onClick={() => setPage((previous) => previous + 1)}>{t("Next")}</button><button type="button" className="secondary label-button" disabled={loading || page >= totalPages} onClick={() => setPage(totalPages)}>{t("Last")}</button></div>
      </nav>
    </section>
  </>;
}
