export type ConnectionCheck = { status: string; message: string; milliseconds?: number; checkedAt?: string };
const titles: Record<string, string> = {
  checking: "Checking connection", success: "Connected", error: "Connection failed",
  timeout: "Request timed out", unavailable: "Connected · no rates returned", unconfigured: "Credentials needed",
};
export default function ConnectionResult({ result }: { result: ConnectionCheck }) {
  const checking = result.status === "checking";
  const success = result.status === "success";
  const warning = result.status === "unavailable" || result.status === "unconfigured";
  return <div className={`connection-result ${success ? "success" : checking ? "checking" : warning ? "warning" : "error"}`} role="status" aria-live="polite" aria-busy={checking}>
    <span className="connection-result-icon" aria-hidden="true">{checking ? <span className="quote-spinner" /> : success ? "✓" : warning ? "!" : "×"}</span>
    <div className="connection-result-content"><strong>{titles[result.status] ?? "Connection result"}</strong><p>{success ? result.message.replace(/^Connected\s*·\s*/i, "") : result.message}</p>
      {!checking && <div className="connection-result-meta">
        {result.milliseconds !== undefined && <span>Response {(result.milliseconds / 1000).toFixed(2)}s</span>}
        {result.checkedAt && <time dateTime={result.checkedAt}>Checked {new Date(result.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}
      </div>}
    </div>
  </div>;
}
