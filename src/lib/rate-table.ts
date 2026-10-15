import { hasPackageDimensions } from "./units";
import { rateTotal } from "./rate-suggestion";
import type { Shipment } from "./schemas";
import type { RateRow } from "./carriers/types";

export const carrierNames = {
  canada_post: "Canada Post",
  loomis: "Loomis Express",
  fedex: "FedEx",
};
export const formatPrice = (value: string | null, currency: string) =>
  value === null ? "Unavailable" : new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency === "UNKNOWN" ? "CAD" : currency,
  }).format(Number(value));
export function formatEta(row: RateRow) {
  const days = row.eta.businessDays !== null
    ? `${row.eta.businessDays} business ${row.eta.businessDays === 1 ? "day" : "days"}`
    : null;
  const parts = [row.eta.date, days];
  return parts.filter(Boolean).join(" · ") || "ETA unavailable";
}
export const serviceKey = (row: Pick<RateRow, "carrier" | "serviceCode">) =>
  `${row.carrier}:${row.serviceCode}`;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function alignedTextTable(headers: string[], rows: string[][]) {
  const normalize = (value: string) => value.replace(/[\t\r]/g, " ").replaceAll("—", "-").replaceAll("…", "...");
  const widths = headers.map((header, i) => Math.min(i === 0 ? 18 : i === 1 ? 34 : 30,
    Math.max(header.length, ...rows.map((row) => Math.max(...normalize(row[i]).split("\n").map((line) => line.length))))));
  const border = "+" + widths.map((width) => "-".repeat(width + 2)).join("+") + "+";
  const wrap = (value: string, width: number) => value.split("\n").flatMap((line) => {
    const lines: string[] = [];
    let rest = normalize(line);
    while (rest.length > width) {
      const space = rest.lastIndexOf(" ", width);
      const end = space > 0 ? space : width;
      lines.push(rest.slice(0, end)); rest = rest.slice(end).trimStart();
    }
    return [...lines, rest];
  });
  const render = (cells: string[], heading = false) => {
    const lines = cells.map((cell, i) => wrap(cell, widths[i]));
    return Array.from({ length: Math.max(...lines.map((cell) => cell.length)) }, (_, line) =>
      "| " + lines.map((cell, i) => {
        const value = cell[line] ?? "";
        const price = !heading && ["Rate", "Without coverage", "With coverage"].includes(headers[i]) && line === 0 && /\$/.test(value);
        return price ? value.padStart(widths[i]) : value.padEnd(widths[i]);
      }).join(" | ") + " |").join("\n");
  };
  return [border, render(headers, true), border, ...rows.flatMap((row) => [render(row), border])].join("\n");
}

export const rateTableCaption = (coverageAmount: number, includeTax: boolean) =>
  `Shipping rates · ${includeTax ? "Tax included where available" : "Tax excluded where available"} · Coverage ${formatPrice(coverageAmount.toFixed(2), "CAD")} CAD`;

export type RateTableShipment = {
  origin: Pick<Shipment["ship_from"], "region" | "postal_code"> & { city?: string };
  destination: Pick<Shipment["ship_to"], "region" | "postal_code"> & { city?: string };
  parcel: Shipment["packages"][number];
  signatureRequired: boolean;
  shipDate: string;
};

export function buildRateTable(rows: RateRow[], coverage: boolean, includeTax = true, coverageAmount = 0, shipment?: RateTableShipment) {
  const headers = ["Carrier", "Service", "Delivery", coverage ? "Without coverage" : "Rate",
    ...(coverage ? ["With coverage"] : [])];
  const amount = (row: RateRow, covered: boolean) => {
    const rate = covered ? row.withCoverage : row.withoutCoverage;
    const note = includeTax ? rate.taxIncluded ? "" : " (tax unconfirmed)"
      : rate.preTaxTotal != null ? "" : " (pre-tax unavailable)";
    return `${formatPrice(rateTotal(row, covered, includeTax), row.currency)} ${row.currency}${note}`;
  };
  const values = rows.map((row) => [
    carrierNames[row.carrier], row.serviceName, formatEta(row), amount(row, false),
    ...(coverage ? [row.withCoverage.available ? amount(row, true) : "Unavailable"] : []),
  ]);
  const heading = [
    ...(shipment ? [
      `Ship From: ${[shipment.origin.region, shipment.origin.city, shipment.origin.postal_code].filter(Boolean).join(" · ")}`,
      `Ship To: ${[shipment.destination.region, shipment.destination.city, shipment.destination.postal_code].filter(Boolean).join(" · ")}`,
      `Ship Date: ${shipment.shipDate}`,
      `Package: ${shipment.parcel.weight} ${shipment.parcel.weightUnit} · ${hasPackageDimensions(shipment.parcel) ? `${shipment.parcel.length} × ${shipment.parcel.width} × ${shipment.parcel.height} ${shipment.parcel.dimensionUnit}` : "Dimensions not provided"}`,
    ] : []),
    `Signature: ${(shipment?.signatureRequired ?? rows.some((row) => row.signature.requested)) ? "Required" : "Not required"}`,
    includeTax ? "Tax: included" : "Tax: excluded",
    `Coverage ${formatPrice(coverageAmount.toFixed(2), "CAD")} CAD`,
  ];
  const cellStyle = "border:1px solid #d6e4ef;padding:8px;vertical-align:top;";
  const alignment = (index: number) => index >= 3 ? "right" : "left";
  const style = (index: number) => `${cellStyle}text-align:${alignment(index)};`;
  const cell = (value: string) => escapeHtml(value).replaceAll("\n", "<br>");
  const html = `<html><body><!--StartFragment--><p>${heading.map(escapeHtml).join("<br>")}</p><table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;width:100%;"><thead><tr>${headers.map((value, index) => `<th style="${style(index)}background:#eef5fc;">${escapeHtml(value)}</th>`).join("")}</tr></thead><tbody>${values.map((cells) => `<tr>${cells.map((value, index) => `<td style="${style(index)}">${cell(value)}</td>`).join("")}</tr>`).join("")}</tbody></table><!--EndFragment--></body></html>`;
  return { html, text: [heading.join("\n"), alignedTextTable(headers, values)].join("\n\n") };
}

export async function copyRateTableImage(table: { html: string; text: string }) {
  const lines = table.text.split("\n");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the table image.");
  const font = "14px monospace";
  context.font = font;
  const padding = 24;
  const lineHeight = 22;
  const width = Math.ceil(Math.max(...lines.map((line) => context.measureText(line).width))) + padding * 2;
  const height = lines.length * lineHeight + padding * 2;
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;
  context.scale(scale, scale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.font = font;
  context.textBaseline = "top";
  context.fillStyle = "#172b4d";
  lines.forEach((line, index) => context.fillText(line, padding, padding + index * lineHeight));
  // Start the clipboard write during the click; Safari requires user activation.
  const blob = new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not create the table image.")), "image/png");
  });
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copied" as const;
    } catch { /* Download the same image when clipboard access is denied. */ }
  }
  const image = await blob;
  const url = URL.createObjectURL(image);
  const link = document.createElement("a");
  link.href = url;
  link.download = "shipping-rates.png";
  document.body.appendChild(link);
  try { link.click(); } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return "downloaded" as const;
}

export function buildApiResult(row: RateRow) {
  if (row.apiResult === undefined) throw new Error("API result unavailable. Request fresh rates and try again.");
  return JSON.stringify({ carrier: carrierNames[row.carrier], serviceCode: row.serviceCode,
    withoutCoverage: row.apiResult,
    ...(row.withCoverage.apiResult === undefined ? {} : { withCoverage: row.withCoverage.apiResult }),
  }, null, 2);
}
export async function copyApiResult(row: RateRow) {
  await copyText(buildApiResult(row));
}
export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* Use the selected-content fallback. */ }
  }
  await copyRateTable({ text, html: `<pre>${escapeHtml(text)}</pre>` });
}

export async function copyRateTable(table: { html: string; text: string }) {
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([table.html], { type: "text/html" }),
        "text/plain": new Blob([table.text], { type: "text/plain" }),
      })]);
      return;
    } catch {
      // Older browsers may allow the copy event even without ClipboardItem support.
    }
  }
  // Give legacy copy a real selection; an unfocused copy event can report
  // success without placing our table on the clipboard in some browsers.
  const previousFocus = document.activeElement as HTMLElement | null;
  const selection = window.getSelection();
  const savedRanges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.style.cssText = "position:fixed;left:-10000px;top:0;";
  holder.innerHTML = table.html;
  document.body.appendChild(holder);
  holder.focus();
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);
  let copied = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/html", table.html);
    event.clipboardData.setData("text/plain", table.text);
    event.preventDefault();
    copied = true;
  };
  document.addEventListener("copy", onCopy);
  try {
    if (!document.execCommand("copy") || !copied) throw new Error("Copy is unavailable. Allow clipboard access and try again.");
  } finally {
    document.removeEventListener("copy", onCopy);
    holder.remove();
    selection?.removeAllRanges();
    for (const saved of savedRanges) selection?.addRange(saved);
    previousFocus?.focus({ preventScroll: true });
  }
}
