import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ToastProvider";
import { SitePreferencesProvider } from "@/components/SitePreferences";
export const metadata: Metadata = {
  title: "Shipping Rate Calculator",
  description: "Compare Canada Post, Loomis Express, and FedEx shipping rates.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><SitePreferencesProvider><ToastProvider>{children}</ToastProvider></SitePreferencesProvider></body>
    </html>
  );
}
