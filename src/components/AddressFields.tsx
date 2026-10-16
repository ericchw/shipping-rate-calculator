"use client";
import { useI18n } from "./UIPreferences";
import { useEffect, useRef, useState } from "react";
import { clientApi } from "@/lib/client-api";
import type { AppMode } from "@/lib/app-routes";
import { autoFillPostalAddress, normalizePostalCode, postalLookupCode, type PostalSuggestions } from "@/lib/postal-suggestion-types";
import type { Address } from "@/lib/schemas";
export const blankAddress: Address = {
  contact_name: "",
  company: "",
  address_line1: "",
  address_line2: "",
  city: "",
  region: "",
  postal_code: "",
  country_code: "CA",
  phone: "",
  email: "",
};
export function profileAddress(p: Address): Address {
  return Object.fromEntries(
    Object.keys(blankAddress).map((k) => [k, p[k as keyof Address]]),
  ) as Address;
}
export default function AddressFields({
  value,
  onChange,
  prefix,
  sandbox = false,
  mode = "production",
}: {
  value: Address;
  onChange: (a: Address) => void;
  prefix: string;
  sandbox?: boolean;
  mode?: AppMode;
}) {
  const { t } = useI18n();
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const autoFillRequest = useRef<Address | null>(null);
  const countryCode = value.country_code;
  const postalCode = normalizePostalCode(value.postal_code);
  const lookupCode = postalLookupCode(countryCode, postalCode);
  const lookupKey = lookupCode ? `${value.country_code}:${lookupCode}` : null;
  const [lookup, setLookup] = useState<{ key: string; result: PostalSuggestions } | null>(null);
  const suggestions = lookup?.key === lookupKey ? lookup.result : null;
  useEffect(() => {
    if (!lookupKey) return;
    let active = true;
    const apply = (result: PostalSuggestions) => {
      if (!active) return;
      setLookup({ key: lookupKey, result });
      const entered = autoFillRequest.current;
      if (!entered) return;
      const current = latest.current.value;
      if (current.country_code !== entered.country_code || normalizePostalCode(current.postal_code) !== normalizePostalCode(entered.postal_code)) return;
      autoFillRequest.current = null;
      const next = autoFillPostalAddress(current, entered, result);
      if (next.city !== current.city || next.region !== current.region) latest.current.onChange(next);
    };
    const timer = setTimeout(() => {
      clientApi(mode, `postal-suggestions?country=${countryCode}&postalCode=${encodeURIComponent(postalCode)}`).then((result: PostalSuggestions) => {
        apply(result);
      }).catch(() => {
        apply({ country: countryCode as "CA" | "US", lookupCode: lookupCode!, precision: countryCode === "CA" ? "area" : "postal", suggestions: [], message: "City suggestions are unavailable. You can enter the address manually." });
      });
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [mode, lookupKey, lookupCode, countryCode, postalCode]);
  const field = (
    key: keyof Address,
    label: string,
    required = false,
    full = false,
  ) => (
    <label
      key={key}
      className={full ? "full" : ""}
      htmlFor={`${prefix}-${key}`}
    >
      {t(label)}
      <input
        id={`${prefix}-${key}`}
        name={`${prefix}-${key}`}
        value={value[key]}
        required={required}
        placeholder={sandbox ? ({ address_line1: "1 Test Street", contact_name: prefix === "from" ? "Sandbox Sender" : "Sandbox Recipient", phone: "6045550100" } as Partial<Record<keyof Address, string>>)[key] : undefined}
        maxLength={key === "email" ? 200 : 200}
        type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
        autoComplete={`section-${prefix} shipping ${({ city: "address-level2", region: "address-level1", postal_code: "postal-code", country_code: "country", address_line1: "address-line1", address_line2: "address-line2", contact_name: "name", company: "organization", phone: "tel", email: "email" } as Record<keyof Address, string>)[key]}`}
        onChange={(e) => {
          const next = { ...value, [key]: e.target.value };
          if (key === "postal_code") autoFillRequest.current = next;
          onChange(next);
        }}
      />
    </label>
  );
  return (
    <div className="field-grid">
      <label>{t("Country")}{" "}<select
          aria-label={`${prefix} country`}
          value={value.country_code}
          onChange={(e) => {
            const next = { ...value, country_code: e.target.value };
            autoFillRequest.current = next;
            onChange(next);
          }}
        >
          <option value="CA">{t("Canada")}</option>
          <option value="US">{t("United States")}</option>
          <option value="GB">{t("United Kingdom")}</option>
          <option value="AU">{t("Australia")}</option>
        </select>
      </label>
      {field("postal_code", t("Postal / ZIP code"), true)}
      {lookupKey && suggestions && (suggestions.suggestions.length > 1 || suggestions.message) && <div className="full postal-suggestions" aria-live="polite">
        {suggestions.suggestions.length > 1 && <div className="postal-suggestion-options">{suggestions.suggestions.map((suggestion) => <button type="button" className="secondary label-button" key={`${suggestion.city}:${suggestion.region}`} onClick={() => onChange({ ...value, city: suggestion.city, region: suggestion.region })}>
          {suggestion.city}, {suggestion.region}
        </button>)}</div>}
        {suggestions.message && <p className="subtle">{t(suggestions.message)}</p>}
      </div>}
      {field("city", t("City"), true)}
      {field("region", t("Province / state"), true)}
      {field("address_line1", t("Street address"), false, true)}
      {field("address_line2", t("Apartment, unit, suite"), false, true)}
      <div className="full">
        <details>
          <summary>{t("Contact details")}</summary>
          <p className="muted">{sandbox ? t("Loomis uses the shown test defaults for empty street, contact, and phone fields in sandbox.") : t("Loomis requires a street address, contact name or company, and phone number.")}</p>
          <div className="field-grid" style={{ marginTop: 14 }}>
            {field("contact_name", t("Contact name"))}
            {field("company", t("Company"))}
            {field("phone", t("Phone"))}
            {field("email", t("Email"))}
          </div>
        </details>
      </div>
    </div>
  );
}
