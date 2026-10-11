import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import {
  currentUser,
  assertAdmin,
  requireUser,
  login,
  logout,
  sessionCookie,
} from "@/lib/auth";
import {
  allowedModes,
  assertMode,
  mockEnabled,
} from "@/lib/config";
import { body, rateLimit, sameOrigin } from "@/lib/security";
import { AppError } from "@/lib/errors";
import { Profiles } from "@/lib/profiles";
import {
  carrierIds,
  shipmentSchema,
  profileSchema,
  addressSchema,
} from "@/lib/schemas";
import { compare } from "@/lib/quote-service";
import { CarrierSettings } from "@/lib/carrier-settings";
import { requestMode } from "@/lib/app-routes";
import { listAccounts, saveAccount, deleteAccount } from "@/lib/accounts";
import { testCarrierConnection } from "@/lib/carrier-connection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
type Context = { params: Promise<{ path: string[] }> };
async function handle(req: Request, ctx: Context) {
  const requestId = randomUUID();
  try {
    const parts = (await ctx.params).path;
    const route = parts.join("/");
    const areaMode = requestMode(req.url);
    const assertArea = (mode: string) => {
      if (mode !== areaMode) throw new AppError(400, "ENVIRONMENT_MISMATCH", `Use the ${mode} area for these credentials or quotes`);
    };
    if (route === "health" && req.method === "GET")
      return json({ status: "ok" });
    if (route === "auth/login" && req.method === "POST") {
      sameOrigin(req);
      rateLimit("login:global", 100);
      const value = z
        .object({
          email: z.string().email().max(200),
          password: z.string().min(1).max(256),
          channel: z.enum(["web", "api"]).default("api"),
        })
        .strict()
        .parse(await body(req));
      rateLimit(`login:${value.email.toLowerCase()}`, 5);
      const result = await login(value.email, value.password, value.channel);
      return json({ user: result.user }, 200, {
        "Set-Cookie": sessionCookie(result.token),
      });
    }
    if (route === "auth/logout" && req.method === "POST") {
      sameOrigin(req);
      await logout(req);
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
    }
    const user = await currentUser(req);
    if (route === "auth/session" && req.method === "GET") {
      return json({
        user,
        modes: allowedModes(user),
        mode: areaMode,
        source: mockEnabled(areaMode) ? "mock" : "live_carrier",
      });
    }
    if (route === "carriers" && req.method === "GET") {
      const owner = (await requireUser(req)).id;
      const mode = z
        .enum(["sandbox", "production"])
        .parse(new URL(req.url).searchParams.get("mode") ?? areaMode);
      assertArea(mode);
      assertMode(mode, user);
      return json({
        mode,
        source: mockEnabled(areaMode) ? "mock" : "live_carrier",
        carriers: await Promise.all(carrierIds.map(async (carrier) => {
          const settings = await new CarrierSettings().get(owner, carrier, mode);
          return { carrier, status: !settings.enabled ? "disabled" : settings.configured ? "configured" : "unconfigured" };
        })),
      });
    }
    if (!user)
      throw new AppError(401, "UNAUTHORIZED", "Sign in to continue");
    if (req.method !== "GET") sameOrigin(req);
    rateLimit(`user:${user.id}`);
    if (parts[0] === "admin" && parts[1] === "accounts") {
      assertAdmin(user);
      if (parts.length === 2) {
        if (req.method === "GET") return json({ accounts: await listAccounts(user) });
        if (req.method === "POST") return json(await saveAccount(user, await body(req)), 201);
      }
      if (parts.length === 3) {
        const id = z.string().uuid().parse(parts[2]);
        if (req.method === "PATCH") return json(await saveAccount(user, await body(req), id));
        if (req.method === "DELETE") {
          await deleteAccount(user, id);
          return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
        }
      }
    }
    if (parts[0] === "carrier-settings") {
      const owner = (await requireUser(req)).id;
      const settings = new CarrierSettings();
      if (parts.length === 1 && req.method === "GET") {
        const mode = z.enum(["sandbox", "production"]).parse(new URL(req.url).searchParams.get("mode") ?? areaMode);
        assertArea(mode);
        return json({ settings: await Promise.all(carrierIds.map((carrier) => settings.get(owner, carrier, mode))) });
      }
      if (parts.length === 3) {
        const mode = z.enum(["sandbox", "production"]).parse(parts[1]);
        assertArea(mode);
        const carrier = z.enum(carrierIds).parse(parts[2]);
        if (req.method === "PUT") return json(await settings.save(owner, carrier, mode, await body(req)));
        if (req.method === "DELETE") {
          await settings.delete(owner, carrier, mode);
          return json(await settings.get(owner, carrier, mode));
        }
      }
      if (parts.length === 4 && parts[3] === "test" && req.method === "POST") {
        const mode = z.enum(["sandbox", "production"]).parse(parts[1]);
        const carrier = z.enum(carrierIds).parse(parts[2]);
        assertArea(mode);
        rateLimit(`carrier-test:${owner}:${mode}:${carrier}`, 5);
        return json(await testCarrierConnection(owner, carrier, mode));
      }
    }
    if (route === "rates" && req.method === "POST") {
      if (!user) throw new AppError(403, "USER_REQUIRED", "Sign in to use your account's carrier credentials");
      const s = shipmentSchema.extend({ carrierMode: z.enum(["sandbox", "production"]).default(areaMode) }).parse(await body(req));
      assertArea(s.carrierMode);
      assertMode(s.carrierMode, user);
      if (s.ship_from_profile_id) {
        if (!user)
          throw new AppError(
            403,
            "USER_REQUIRED",
            "Profile references require a user session",
          );
        await new Profiles().get(user.id, s.ship_from_profile_id);
      }
      return json(await compare(s, user.id));
    }
    if (parts[0] === "ship-from-profiles") {
      const owner = (await requireUser(req)).id;
      const profiles = new Profiles();
      const id = parts[1];
      if (id) z.string().uuid().parse(id);
      if (parts.length === 1) {
        if (req.method === "GET")
          return json({ profiles: await profiles.list(owner) });
        if (req.method === "POST")
          return json(await profiles.save(owner, await body(req)), 201);
      }
      if (parts.length === 2 && id) {
        if (req.method === "GET") return json(await profiles.get(owner, id));
        if (req.method === "DELETE") {
          await profiles.delete(owner, id);
          return new Response(null, {
            status: 204,
            headers: { "Cache-Control": "no-store" },
          });
        }
        if (req.method === "PATCH") {
          const value = z
            .object({
              profile_name: z.string().trim().min(1).max(100).optional(),
              address: addressSchema.optional(),
              is_default: z.boolean().optional(),
            })
            .strict()
            .parse(await body(req));
          const old = await profiles.get(owner, id);
          const address = addressSchema.parse(
            Object.fromEntries(
              Object.keys(addressSchema.innerType().innerType().shape).map(
                (k) => [k, old[k as keyof typeof old]],
              ),
            ),
          );
          return json(
            await profiles.save(
              owner,
              profileSchema.parse({
                profile_name: value.profile_name ?? old.profile_name,
                address: value.address ?? address,
                is_default: value.is_default ?? old.is_default,
              }),
              id,
            ),
          );
        }
      }
      if (
        parts.length === 3 &&
        id &&
        parts[2] === "default" &&
        req.method === "PUT"
      )
        return json(await profiles.setDefault(owner, id));
    }
    throw new AppError(404, "NOT_FOUND", "Route not found");
  } catch (e) {
    if (e instanceof ZodError)
      return json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the highlighted input fields",
            details: e.issues.map((i) => ({
              path: i.path,
              message: i.message,
            })),
          },
          requestId,
        },
        400,
      );
    if (e instanceof AppError)
      return json(
        { error: { code: e.code, message: e.message, details: [] }, requestId },
        e.status,
      );
    return json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Request failed. Check server configuration.",
          details: [],
        },
        requestId,
      },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const PUT = handle;
