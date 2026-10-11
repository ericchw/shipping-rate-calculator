"use client";
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
}: {
  value: Address;
  onChange: (a: Address) => void;
  prefix: string;
  sandbox?: boolean;
}) {
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
      {label}
      <input
        id={`${prefix}-${key}`}
        name={`${prefix}-${key}`}
        value={value[key]}
        required={required}
        placeholder={sandbox ? ({ address_line1: "1 Test Street", contact_name: prefix === "from" ? "Sandbox Sender" : "Sandbox Recipient", phone: "6045550100" } as Partial<Record<keyof Address, string>>)[key] : undefined}
        maxLength={key === "email" ? 200 : 200}
        type={key === "email" ? "email" : "text"}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="field-grid">
      <label>
        Country
        <select
          aria-label={`${prefix} country`}
          value={value.country_code}
          onChange={(e) => onChange({ ...value, country_code: e.target.value })}
        >
          <option value="CA">Canada</option>
          <option value="US">United States</option>
          <option value="GB">United Kingdom</option>
          <option value="AU">Australia</option>
        </select>
      </label>
      {field("postal_code", "Postal / ZIP code", true)}
      {field("city", "City", true)}
      {field("region", "Province / state", true)}
      {field("address_line1", "Street address", false, true)}
      {field("address_line2", "Apartment, unit, suite", false, true)}
      <div className="full">
        <details>
          <summary>Contact details</summary>
          <p className="muted">{sandbox ? "Loomis uses the shown test defaults for empty street, contact, and phone fields in sandbox." : "Loomis requires a street address, contact name or company, and phone number."}</p>
          <div className="field-grid" style={{ marginTop: 14 }}>
            {field("contact_name", "Contact name")}
            {field("company", "Company")}
            {field("phone", "Phone")}
            {field("email", "Email")}
          </div>
        </details>
      </div>
    </div>
  );
}
