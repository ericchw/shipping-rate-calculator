"use client";
import { useEffect, useRef, useState } from "react";
import { clientApi } from "@/lib/client-api";
import type { AppMode } from "@/lib/app-routes";
import type { QuoteLog, QuoteLogSummary } from "@/lib/quote-log-types";
import type { Shipment } from "@/lib/schemas";
import { carrierNames, formatPrice, formatEta } from "@/lib/rate-table";
import { formatSiteDate, formatSiteTime } from "@/lib/site-preferences";
import { hasPackageDimensions } from "@/lib/units";
import { useSitePreferences } from "./SitePreferences";
const location = (address: QuoteLogSummary["ship_from"]) => `${address.region} · ${address.city} · ${address.postal_code}`;
const stateLabel = (log: QuoteLogSummary) => log.status === "completed" ? "Completed" : log.status === "partial" ? "Partial results" : log.status === "no_rates" ? "No rates" : Date.now() - Date.parse(log.created_at) > 90000 ? "Incomplete" : "Comparing…";
export default function QuoteLogModal({ open, mode, company, onClose, onRestore }: { open: boolean; mode: AppMode; company?: string; onClose: () => void; onRestore: (shipment: Shipment) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton=useRef<HTMLButtonElement>(null);
  const closeButton=useRef<HTMLButtonElement>(null);
  const deleteTrigger=useRef<HTMLElement|null>(null);
  const [deleting,setDeleting]=useState<QuoteLogSummary|null>(null);
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [deleteError,setDeleteError]=useState("");
  const [deletedMessage,setDeletedMessage]=useState("");
  useEffect(()=>{ if(deleting) cancelButton.current?.focus(); },[deleting]);
  const askDelete=(log:QuoteLogSummary,trigger:HTMLElement)=>{deleteTrigger.current=trigger;setDeleteError("");setDeleting(log);};
  const cancelDelete=()=>{setDeleting(null);setDeleteError("");requestAnimationFrame(()=>deleteTrigger.current?.focus());};
  const { preferences } = useSitePreferences();
  const [logs, setLogs] = useState<QuoteLogSummary[]>([]);
  const [record, setRecord] = useState<QuoteLog | null>(null);
  const [id, setId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const old = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = old; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError("");
    clientApi(mode, `rate-logs?page=${page}&pageSize=${pageSize}`).then(data => {
      if (!active) return;
      setLogs(data.logs); setTotal(data.total); setPages(data.totalPages); setPage(data.page);
    }).catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, mode, page, pageSize, refresh]);
  useEffect(() => {
    if (!open || !id) { setRecord(null); return; }
    let active=true; setDetailLoading(true); setDetailError(""); setRecord(null);
    clientApi(mode,`rate-logs/${id}`).then(data => { if(active) setRecord(data); }).catch((e:Error) => { if(active) setDetailError(e.message); }).finally(() => { if(active) setDetailLoading(false); });
    return () => { active=false; };
  },[open,mode,id,refresh]);
  const close = () => { if(deleteBusy)return;setDeleting(null);setDeletedMessage("");dialog.current?.close(); setId(""); setPage(1); setRecord(null); onClose(); };
  if (!open) return null;
  const parcel=record?.shipment.packages[0];
  const date=(value:string) => formatSiteDate(new Date(value),preferences);
  return <dialog ref={dialog} className={`quote-log-modal history-dialog ${id ? "history-has-selection" : ""}`} aria-labelledby="quote-log-title" onCancel={event => { event.preventDefault(); if(deleting){if(!deleteBusy)cancelDelete();}else close(); }} onClose={onClose} onClick={event => {
    if(event.target!==event.currentTarget)return; const bounds=event.currentTarget.getBoundingClientRect(); if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)close();
  }}>
    <div className="history-header" inert={!!deleting}><span className="history-header-icon" aria-hidden="true">↶</span><div><h2 id="quote-log-title">Rate logs</h2><p>{company || "Company comparisons"}<span>·</span><span className={`environment-badge ${mode}`}>{mode === "sandbox" ? "Sandbox" : "Production"}</span></p></div><button type="button" className="modal-close" aria-label="Close rate logs" ref={closeButton} disabled={deleteBusy} onClick={close}>×</button></div>
    <div className="history-layout" inert={!!deleting}>
      <section className="history-list-pane" aria-label="Saved comparisons">
        <div className="history-list-heading"><div><strong>Comparison history</strong><span>{total} saved {total===1?"comparison":"comparisons"}</span></div><button type="button" className="text-button" aria-label="Refresh rate logs" disabled={loading} onClick={() => setRefresh(refresh+1)}>↻</button></div>
        <div className="history-records">{deletedMessage && <p className="history-deleted-message" role="status">{deletedMessage}</p>}
          {loading ? <div className="history-loading" role="status"><span className="quote-spinner" />Loading comparisons…</div> : error ? <div className="history-empty"><p role="alert">{error}</p><button className="secondary" onClick={() => setRefresh(refresh+1)}>Try again</button></div> : logs.length ? logs.map(log => <div className="history-entry" key={log.id}><button type="button" className={`history-record ${id === log.id ? "selected" : ""}`} key={log.id} aria-pressed={id === log.id} aria-label={`View comparison from ${log.ship_from.city} to ${log.ship_to.city}`} onClick={() => setId(log.id)}>
            <span className="history-record-meta"><time>{date(log.created_at)}</time><span className={`history-state ${log.status}`}>{stateLabel(log)}</span></span>
            <span className="history-route"><strong>{log.ship_from.city}</strong><span aria-hidden="true">→</span><strong>{log.ship_to.city}</strong></span>
            <span className="history-postals">{log.ship_from.region} {log.ship_from.postal_code} <span>·</span> {log.ship_to.region} {log.ship_to.postal_code}</span>
            <span className="history-record-footer"><span>{log.weight} {log.weightUnit} <span>·</span> {log.rateCount} rates</span><time>{formatSiteTime(log.created_at,preferences)}</time></span>
          </button><button type="button" className="history-entry-delete" aria-label={`Delete comparison from ${log.ship_from.city} to ${log.ship_to.city}`} onClick={event=>askDelete(log,event.currentTarget)}>Delete</button></div>) : <div className="history-empty"><span aria-hidden="true">↶</span><h3>Your next comparison starts here</h3><p>Compare rates to save your shipment and prices automatically.</p></div>}
        </div>
        <div className="history-list-footer"><label>Rows<select aria-label="Rate log page size" value={pageSize} disabled={loading} onChange={event => { setId(""); setPageSize(Number(event.target.value)); setPage(1); }}>{[10,20,50,100].map(size=><option key={size}>{size}</option>)}</select></label><nav aria-label="Rate log pages"><button type="button" className="history-page-button" aria-label="Previous rate log page" disabled={loading||page===1} onClick={()=>{setId("");setPage(page-1);}}>‹</button><span>{page} / {pages}</span><button type="button" className="history-page-button" aria-label="Next rate log page" disabled={loading||page>=pages} onClick={()=>{setId("");setPage(page+1);}}>›</button></nav></div>
      </section>
      <section className="history-detail-pane" aria-label="Comparison details">
        {id && <div className="history-mobile-back"><button type="button" className="text-button" onClick={()=>setId("")}>← All rate logs</button></div>}
        <div className="history-detail-scroll">
          {!id ? <div className="history-detail-placeholder"><span aria-hidden="true">▤</span><h3>Every shipment, ready to revisit</h3><p>Select a comparison to review its prices, carrier results and shipping details.</p><div><span>1. Choose a comparison</span><span>2. Review saved rates</span><span>3. Load details to quote again</span></div></div> : detailLoading ? <div className="history-loading" role="status"><span className="quote-spinner" />Loading comparison…</div> : detailError ? <div className="history-empty"><p role="alert">{detailError}</p><button className="secondary" onClick={()=>setRefresh(refresh+1)}>Try again</button></div> : record && parcel ? <>
            <div className="history-detail-title"><span className="eyebrow">SAVED COMPARISON</span><h3>Saved rate comparison</h3><p>{date(record.created_at)} · {formatSiteTime(record.created_at,preferences)}</p></div>
            <div className="history-detail-summary"><div><span>Route</span><strong>{record.shipment.ship_from.city} → {record.shipment.ship_to.city}</strong></div><div><span>Package</span><strong>{parcel.weight} {parcel.weightUnit}</strong></div><div><span>Results</span><strong>{record.rateCount} rates</strong></div></div>
            <div className="history-section-heading"><h4>Carrier results</h4><span>Saved estimates</span></div>
            <div className="history-carrier-results">{record.comparison.carrierStatuses.map(status=><div key={status.carrier}><strong>{carrierNames[status.carrier]}</strong><span className={`history-state ${status.status === "success" ? "completed" : "partial"}`}>{status.status === "quoting" ? "Incomplete" : status.status.replaceAll("_"," ")}</span>{status.message&&<p>{status.message}</p>}</div>)}</div>
            <div className="history-rate-cards">{record.comparison.results.map(row=><article key={`${row.carrier}:${row.serviceCode}:${row.variant}:${row.currency}`}><div><span>{carrierNames[row.carrier]}</span><h4>{row.serviceName}</h4><p>{formatEta(row)}</p></div><div className="history-rate-price"><strong>{formatPrice(row.withoutCoverage.total,row.currency)} <small>{row.currency}</small></strong><span>{row.withoutCoverage.taxIncluded ? "Includes tax" : "Before tax"}</span>{record.shipment.coverageAmount>0&&<span>With coverage: {row.withCoverage.available?`${formatPrice(row.withCoverage.total,row.currency)} ${row.currency}`:"Unavailable"}</span>}</div></article>)}</div>
            {!record.comparison.results.length&&<p className="history-note">No rates were returned. Load these details to try again.</p>}
            <details className="history-shipment-details" open><summary>Shipping details<span>Ship {record.shipment.shipDate}</span></summary><div className="history-addresses">{(["ship_from","ship_to"] as const).map(key=>{const address=record.shipment[key];return <section key={key}><h4>{key === "ship_from" ? "Ship From" : "Ship To"}</h4><strong>{location(address)}</strong>{[address.contact_name,address.company].filter(Boolean).length>0&&<p>{[address.contact_name,address.company].filter(Boolean).join(" · ")}</p>}<p>{[address.address_line1,address.address_line2,address.country_code].filter(Boolean).join(", ")}</p>{address.phone&&<p>{address.phone}</p>}</section>;})}</div><dl className="history-package-facts"><div><dt>Dimensions</dt><dd>{hasPackageDimensions(parcel)?`${parcel.length} × ${parcel.width} × ${parcel.height} ${parcel.dimensionUnit}`:"Not provided"}</dd></div><div><dt>Signature</dt><dd>{record.shipment.signatureRequired?"Required":"Not requested"}</dd></div><div><dt>Declared value</dt><dd>{formatPrice(record.shipment.coverageAmount.toFixed(2),"CAD")} CAD</dd></div></dl><p className="history-ship-date">Ship date: {record.shipment.shipDate}</p></details>
          </> : null}
        </div>
        {id && <div className="history-detail-actions"><button type="button" className="text-button danger-text history-detail-delete" disabled={!record||detailLoading} onClick={event=>{if(record)askDelete(record,event.currentTarget);}}>Delete log</button><p>Load the details, then compare current rates.<small>Past ship dates update to today.</small></p><button type="button" className="primary" disabled={!record||detailLoading} onClick={()=>{if(record){onRestore(record.shipment);close();}}}>Load shipping details <span aria-hidden="true">→</span></button></div>}
      </section>
    </div>
    {deleting && <div className="history-delete-overlay"><section role="alertdialog" aria-modal="true" aria-labelledby="delete-log-title" aria-describedby="delete-log-description" className="history-delete-confirmation" aria-busy={deleteBusy} onKeyDown={event=>{
      if(event.key!=="Tab")return;
      const buttons=event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      const first=buttons[0],last=buttons[buttons.length-1];
      if(!first){event.preventDefault();return;}
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }}><span className="history-delete-icon" aria-hidden="true">×</span><h3 id="delete-log-title">Delete this rate log?</h3><p id="delete-log-description">The saved comparison from <strong>{deleting.ship_from.city}</strong> to <strong>{deleting.ship_to.city}</strong> on {date(deleting.created_at)} will be removed for everyone in this company. Shipping labels stay saved.</p><p className="subtle">This cannot be undone.</p>{deleteError&&<p className="error" role="alert">{deleteError}</p>}<div className="admin-actions"><button type="button" ref={cancelButton} className="secondary" disabled={deleteBusy} onClick={cancelDelete}>Cancel</button><button type="button" className="danger-button" disabled={deleteBusy} onClick={async()=>{
      setDeleteBusy(true);setDeleteError("");
      try{await clientApi(mode,`rate-logs/${deleting.id}`,"DELETE");if(id===deleting.id){setId("");setRecord(null);}setDeleting(null);setLogs(current=>current.filter(log=>log.id!==deleting.id));setDeletedMessage("Rate log deleted.");setRefresh(current=>current+1);requestAnimationFrame(()=>closeButton.current?.focus());}
      catch(e){setDeleteError((e as Error).message);}finally{setDeleteBusy(false);}
    }}>{deleteBusy?"Deleting…":"Yes, delete log"}</button></div></section></div>}
  </dialog>;
}
