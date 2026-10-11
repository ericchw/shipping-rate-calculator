import { afterEach, beforeEach, expect, it, vi } from "vitest";
const effects = vi.hoisted(() => ({ callback: undefined as (() => void | (() => void)) | undefined }));
vi.mock("react", () => ({ useEffect: (callback: () => void | (() => void)) => { effects.callback = callback; } }));
import { useUnsavedChanges } from "../src/lib/use-unsaved-changes";

class Anchor {
  target = "";
  constructor(public href: string) {}
  closest() { return this; }
  hasAttribute() { return false; }
}
let listeners: Map<string, (event: unknown) => void>, confirm: ReturnType<typeof vi.fn>, navigation: EventTarget;
beforeEach(() => {
  effects.callback = undefined; listeners = new Map(); confirm = vi.fn().mockReturnValue(false); navigation = new EventTarget();
  const events = { addEventListener: vi.fn((name, callback) => listeners.set(name, callback)), removeEventListener: vi.fn((name) => listeners.delete(name)) };
  vi.stubGlobal("window", { ...events, confirm, navigation, location: { origin: "http://localhost:3000", pathname: "/setting", search: "", href: "http://localhost:3000/setting" } });
  vi.stubGlobal("document", events); vi.stubGlobal("Element", Anchor); vi.stubGlobal("HTMLAnchorElement", Anchor);
});
afterEach(() => { vi.unstubAllGlobals(); });
function start(dirty = true) {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- The mocked effect harness tests browser event handlers without mounting React.
  useUnsavedChanges(dirty);
  return effects.callback?.();
}
function link(href: string, extras = {}) {
  const event = { target: new Anchor(href), button: 0, defaultPrevented: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...extras };
  listeners.get("click")?.(event); return event;
}
it("stays on settings when the user cancels leaving with unsaved changes", () => {
  start(); const event = link("http://localhost:3000/rate");
  expect(confirm).toHaveBeenCalledOnce(); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  confirm.mockReturnValue(true);
  expect(link("http://localhost:3000/home").preventDefault).not.toHaveBeenCalled();
});
it("does not interrupt same-page anchors or links opened in a new tab", () => {
  start(); link("http://localhost:3000/setting#credentials"); link("http://localhost:3000/rate", { ctrlKey: true });
  expect(confirm).not.toHaveBeenCalled();
});
it("warns on refresh/close and removes guards after settings are saved", () => {
  const cleanup = start(); const event = { preventDefault: vi.fn(), returnValue: "initial" };
  listeners.get("beforeunload")?.(event); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.returnValue).toBe("");
  if (typeof cleanup === "function") cleanup();
  expect(listeners.size).toBe(0);
  start(false); expect(listeners.size).toBe(0);
});
it("cancels supported browser history navigation when leaving is declined", () => {
  const cleanup = start();
  const event = new Event("navigate", { cancelable: true }); Object.assign(event, { navigationType: "traverse" });
  navigation.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); expect(confirm).toHaveBeenCalledOnce();
  if (typeof cleanup === "function") cleanup();
  const next = new Event("navigate", { cancelable: true }); Object.assign(next, { navigationType: "traverse" });
  navigation.dispatchEvent(next); expect(next.defaultPrevented).toBe(false);
});
it("protects unsaved settings before an explicit sign-out action", () => {
  start();
  const event = new Event("shipping:before-leave", { cancelable: true });
  listeners.get("shipping:before-leave")?.(event);
  expect(event.defaultPrevented).toBe(true);
});
