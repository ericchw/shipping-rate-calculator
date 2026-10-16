import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ToastProvider";
import { UIPreferencesProvider } from "@/components/UIPreferences";
import { SitePreferencesProvider } from "@/components/SitePreferences";
export const metadata: Metadata = {
  title: "Shipping Rate Calculator",
  description: "Compare shipping rates and delivery estimates across your carriers.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var p=JSON.parse(localStorage.getItem("shipping:appearance")||"{}"),t=["light","dark"].includes(p.theme)?p.theme:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t;if(["en","fr","zh-TW","zh-CN"].includes(p.language))document.documentElement.lang=p.language;}catch(e){document.documentElement.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}})();` }} /></head>
      <body><UIPreferencesProvider><SitePreferencesProvider><ToastProvider>{children}</ToastProvider></SitePreferencesProvider></UIPreferencesProvider></body>
    </html>
  );
}
