"use client";
import { useState } from "react";

export function CopyCode({ value, label = "Copy" }: { value: string; label?: string }) {
  const [status, setStatus] = useState("");
  return <span className="api-copy"><button type="button" onClick={async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copied");
    } catch { setStatus("Select the text to copy"); }
  }}>{label}</button><span role="status">{status}</span></span>;
}
export default function ApiCode({ value, title = "Example", language = "JSON" }: { value: string; title?: string; language?: string }) {
  return <div className="api-code"><div className="api-code-heading"><span>{title} <small>{language}</small></span><CopyCode value={value} /></div><pre><code>{value}</code></pre></div>;
}
