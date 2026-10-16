"use client";
import { useI18n } from "./UIPreferences";
import type { Address } from "@/lib/schemas";

export default function GoogleMapsButton({ address }: { address: Address }) {
  const { t } = useI18n();
  const parts = [address.address_line1, address.address_line2, address.city, address.region, address.postal_code]
    .map(part => part.trim()).filter(Boolean);
  const country = ({ CA: "Canada", US: "United States", GB: "United Kingdom", AU: "Australia" } as Record<string, string>)[address.country_code] || address.country_code;
  return <button type="button" className="google-maps-button" disabled={!parts.length}
    title={t("Open Google Maps")} aria-label={t("Open Ship To address in Google Maps")}
    onClick={event => {
      event.preventDefault();
      event.stopPropagation();
      window.open(`https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: [...parts, country].join(", ") })}`, "_blank", "noopener,noreferrer");
    }}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
      <path d="M9 3v15M15 6v15" />
    </svg>
  </button>;
}
