"use client";
import { copyText } from "@/lib/rate-table";
import { useToast } from "./ToastProvider";

export function CopyCode({ value, label = "Copy" }: { value: string; label?: string }) {
  const notify = useToast();
  return <span className="api-copy"><button type="button" onClick={async () => {
    try {
      await copyText(value);
      notify("Copied to clipboard.");
    } catch { notify("Could not copy. Select the text to copy manually.", "error"); }
  }}>{label}</button></span>;
}
export default function ApiCode({ value, title = "Example", language = "JSON" }: { value: string; title?: string; language?: string }) {
  return <div className="api-code"><div className="api-code-heading"><span>{title} <small>{language}</small></span><CopyCode value={value} /></div><pre><code>{value}</code></pre></div>;
}
