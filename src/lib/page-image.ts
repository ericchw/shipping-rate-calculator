function captureClone(page: HTMLElement) {
  const clone = page.cloneNode(true) as HTMLElement;
  const originals = page.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
  const copies = clone.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
  originals.forEach((original, index) => {
    const copy = copies[index];
    if (original instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
      copy.value = original.value;
      copy.setAttribute("value", original.value);
      if (original.type === "checkbox" || original.type === "radio") {
        copy.checked = original.checked;
        copy.toggleAttribute("checked", original.checked);
      }
    } else if (original instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) {
      [...copy.options].forEach((option, i) => {
        option.selected = original.options[i].selected;
        option.toggleAttribute("selected", original.options[i].selected);
      });
      if (!original.multiple) copy.selectedIndex = original.selectedIndex;
    } else if (original instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) {
      copy.value = original.value;
      copy.textContent = original.value;
    }
  });
  return clone;
}
export async function downloadPageImage() {
  const page = document.querySelector<HTMLElement>("[data-page-capture]");
  if (!page) throw new Error("Could not find the page to capture.");
  await document.fonts.ready;
  const { toJpeg } = await import("html-to-image");
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const stage = document.createElement("div");
  stage.style.cssText = `position:fixed;left:-100000px;top:0;width:${page.scrollWidth}px;pointer-events:none;`;
  stage.setAttribute("aria-hidden", "true");
  stage.inert = true;
  const clone = captureClone(page);
  stage.appendChild(clone);
  document.body.appendChild(stage);
  try {
    const dataUrl = await toJpeg(clone, {
      backgroundColor: "#f3f8fc", quality: 0.95,
      width: clone.scrollWidth, height: clone.scrollHeight,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2), skipFonts: true,
      filter: (node) => !(node instanceof HTMLElement && (node.hasAttribute("data-capture-ignore") || node.tagName === "NEXTJS-PORTAL")),
    });
    if (!dataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("Could not create the page image.");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = "shipping-calculator.jpg";
    document.body.appendChild(link);
    try { link.click(); } finally { link.remove(); }
  } finally { stage.remove(); }
}
