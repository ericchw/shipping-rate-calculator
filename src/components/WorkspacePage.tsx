import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { pagePath, type AppMode, type AppPage } from "@/lib/app-routes";
import { allowedModes } from "@/lib/config";
import ShippingApp from "./ShippingApp";

export default async function WorkspacePage({ mode, page, labelId }: { mode: AppMode; page: AppPage; labelId?: string }) {
  const cookie = (await cookies()).toString();
  const user = await currentUser(new Request("http://localhost", { headers: { cookie } }));
  const destination = labelId ? `${pagePath(mode, "labels")}/${labelId}` : pagePath(mode, page);
  if (!user) redirect(`${pagePath(mode, "login")}?next=${encodeURIComponent(destination)}`);
  if (user.webAccess === false || user.channel === "api") redirect(`${pagePath(mode, "login")}?next=${encodeURIComponent(destination)}`);
  if (!allowedModes(user).includes(mode)) redirect(pagePath(allowedModes(user)[0]!, "home"));
  if (page === "admin" && user.role !== "admin") redirect(pagePath(mode, "home"));
  return <ShippingApp key={`${mode}:${page}`} initialMode={mode} page={page} labelId={labelId} />;
}
