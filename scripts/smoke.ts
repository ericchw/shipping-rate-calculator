if (process.env.RUN_SANDBOX_SMOKE !== "true") {
  console.log(
    "SKIP: set RUN_SANDBOX_SMOKE=true to explicitly opt into sandbox carrier traffic.",
  );
  process.exit(0);
}
if (process.env.MOCK_CARRIERS !== "false") {
  throw new Error("Sandbox API testing requires MOCK_CARRIERS=false.");
}
const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Origin: origin,
};
{
  const email = process.env.USER_EMAIL ?? process.env.CREATE_USER_EMAIL;
  const password = process.env.USER_PASSWORD ?? process.env.CREATE_USER_PASSWORD;
  if (!email || !password) throw new Error("Configure a login account locally, then save carrier credentials in the web UI.");
  const login = await fetch(`${origin}/sandbox/api/v1/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15000),
  });
  if (!login.ok) throw new Error(`Sandbox sign-in failed (HTTP ${login.status}).`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Sandbox sign-in did not return a session.");
  headers.Cookie = cookie;
}
const shipDay = new Date();
do { shipDay.setDate(shipDay.getDate() + 1); } while ([0, 6].includes(shipDay.getDay()));
const response = await fetch(
  `${origin}/sandbox/api/v1/rates`,
  {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      ship_from: {
        address_line1: "700 W Georgia St",
        contact_name: "Sandbox Sender",
        phone: "6045550100",
        city: "Vancouver",
        region: "BC",
        postal_code: "V6B1A1",
        country_code: "CA",
      },
      ship_to: {
        address_line1: "301 Front St W",
        contact_name: "Sandbox Recipient",
        phone: "4165550100",
        city: "Toronto",
        region: "ON",
        postal_code: "M5V2T6",
        country_code: "CA",
      },
      shipDate: shipDay.toISOString().slice(0, 10),
      packages: [
        {
          length: 30,
          width: 20,
          height: 15,
          dimensionUnit: "cm",
          weight: 2.5,
          weightUnit: "kg",
        },
      ],
      carrierMode: "sandbox",
      carriers: ["canada_post", "loomis", "fedex"],
    }),
  },
);
const data = await response.json();
if (!response.ok)
  throw new Error(`Sandbox smoke failed (HTTP ${response.status})`);
console.log(
  data.carrierStatuses.map(
    (s: { carrier: string; status: string; source: string; message?: string }) => ({
      carrier: s.carrier,
      status: s.status,
      source: s.source,
      message: s.message,
    }),
  ),
);
if (
  data.carrierStatuses.some((s: { source: string }) => s.source !== "live_carrier") ||
  data.results.some((r: { source: string }) => r.source !== "live_carrier")
) throw new Error("Unexpected synthetic rate data in sandbox API test.");
console.log(`Carrier API rate rows: ${data.results.length}`);
if (data.carrierStatuses.some((s: { status: string }) => s.status !== "success")) {
  process.exitCode = 1;
}
export {};
