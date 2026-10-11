import "server-only";
import { XMLParser, XMLValidator } from "fast-xml-parser";
export class CarrierApiError extends Error {
  constructor(status: number, operation: string, code?: string) {
    super(`${operation} failed (HTTP ${status}${code ? `; ${code}` : ""}).`);
  }
}
export class CarrierResponseError extends Error {}
function errorCode(text: string) {
  try {
    const data = text.trim().startsWith("{") ? JSON.parse(text) : xml(text);
    const code = data.errors?.[0]?.code ?? array(data.messages?.message)[0]?.code;
    return typeof code === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? code : undefined;
  } catch { return undefined; }
}
async function responseText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty carrier response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.length;
    if (size > 2000000) {
      await reader.cancel();
      throw new Error("Carrier response too large");
    }
    chunks.push(item.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function xml(text: string): Record<string, unknown> {
  if (
    text.length > 2000000 ||
    /<!DOCTYPE|<!ENTITY/i.test(text) ||
    XMLValidator.validate(text) !== true
  )
    throw new Error("Invalid carrier XML");
  return new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
  }).parse(text);
}
export const escapeXml = (s: unknown) =>
  String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export async function request(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const response = await fetch(url, {
      ...init,
      signal,
      redirect: "error",
      cache: "no-store",
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await response.body?.cancel();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            signal.removeEventListener("abort", abort);
            resolve();
          },
          250 * 2 ** attempt,
        );
        const abort = () => {
          clearTimeout(timer);
          reject(new Error("Carrier timeout"));
        };
        signal.addEventListener("abort", abort, { once: true });
      });
      continue;
    }
    if (!response.ok) {
      const text = await responseText(response).catch(() => "");
      const operation = new URL(url).pathname.includes("oauth") ? "Authentication" : "Rate request";
      throw new CarrierApiError(response.status, operation, errorCode(text));
    }
    return responseText(response);
  }
  throw new Error("Carrier unavailable");
}
export function array<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
