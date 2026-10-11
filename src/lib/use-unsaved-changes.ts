"use client";
import { useEffect } from "react";

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const message = "You have unsaved carrier settings. Leave this page and discard your changes?";
    let approvedUntil = 0;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (Date.now() < approvedUntil) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (!["http:", "https:"].includes(destination.protocol)) return;
      if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (window.confirm(message)) approvedUntil = Date.now() + 1000;
      else { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    // Modern browsers also allow cancellation of same-document back/forward navigation.
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    const departure = (event: Event) => {
      if (window.confirm(message)) approvedUntil = Date.now() + 1000;
      else event.preventDefault();
    };
    const navigate = (event: Event) => {
      if ((event as Event & { navigationType?: string }).navigationType !== "traverse" || !event.cancelable) return;
      departure(event);
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("shipping:before-leave", departure);
    document.addEventListener("click", click, true);
    navigation?.addEventListener("navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("shipping:before-leave", departure);
      document.removeEventListener("click", click, true);
      navigation?.removeEventListener("navigate", navigate);
    };
  }, [dirty]);
}
