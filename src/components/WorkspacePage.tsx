import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { pagePath, type AppMode, type AppPage } from "@/lib/app-routes";
import ShippingApp from "./ShippingApp";

export default async function WorkspacePage({ mode, page }: { mode: AppMode; page: AppPage }) {
  const cookie = (await cookies()).toString();
  const user = await currentUser(new Request("http://localhost", { headers: { cookie } }));
  if (!user) redirect(`${pagePath(mode, "login")}?next=${encodeURIComponent(pagePath(mode, page))}`);
  if (user.webAccess === false || user.channel === "api") redirect(`${pagePath(mode, "login")}?next=${encodeURIComponent(pagePath(mode, page))}`);
  if (page === "admin" && user.role !== "admin") redirect(pagePath(mode, "home"));
  return <ShippingApp key={`${mode}:${page}`} initialMode={mode} page={page} />;
}
