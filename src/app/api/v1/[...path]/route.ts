import { QuoteLogs } from "@/lib/quote-logs";
import { listGroups, saveGroup, deleteGroup, userGroup, requireGroup, managedGroup } from "@/lib/groups";
import { generationEnabled, saveGenerationSetting } from "@/lib/generation-settings";
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
import { requestMode, type AppMode } from "@/lib/app-routes";
import { listAccounts, saveAccount, deleteAccount } from "@/lib/accounts";
import { postalSuggestions } from "@/lib/postal-suggestions";
import { Labels } from "@/lib/labels";
import { generateLoomisLabel, sandboxLabelShipment } from "@/lib/carriers/loomis-labels";
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
      const group = user ? await userGroup(user.id) : null;
      return json({
        user,
        group,
        generationEnabled: allowedModes(user).includes(areaMode) && await generationEnabled(areaMode, group?.id),
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
    assertMode(areaMode, user);
    if (req.method !== "GET") sameOrigin(req);
    rateLimit(`user:${user.id}`);
    if (parts[0] === "admin" && parts[1] === "groups") {
      assertAdmin(user);
      if (parts.length === 2 && req.method === "GET") return json({ groups: await listGroups(user) });
      if (parts.length === 2 && req.method === "POST") return json(await saveGroup(user, await body(req)), 201);
      if (parts.length === 3 && req.method === "DELETE") {
        await deleteGroup(user, z.string().uuid().parse(parts[2]));
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }
      if (parts.length === 3 && req.method === "PATCH") return json(await saveGroup(user, await body(req), z.string().uuid().parse(parts[2])));
    }
    if (route === "admin/generation-settings") {
      assertAdmin(user);
      assertMode(areaMode, user);
      const groupId = await managedGroup(user, new URL(req.url).searchParams.get("groupId"));
      if (req.method === "GET") return json({ enabled: await generationEnabled(areaMode, groupId) });
      if (req.method === "PUT") {
        const input = z.object({ enabled: z.boolean() }).strict().parse(await body(req));
        return json(await saveGenerationSetting(user, areaMode, input.enabled, groupId));
      }
    }
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
      const requestedGroup = new URL(req.url).searchParams.get("groupId");
      if (req.method !== "GET" || requestedGroup) assertAdmin(user);
      const groupId = requestedGroup ? await managedGroup(user, requestedGroup) : (await userGroup(owner))?.id;
      const settings = new CarrierSettings(undefined, undefined, groupId);
      const publicSettings = async (carrier: typeof carrierIds[number], mode: AppMode) => {
        const saved = await settings.get(owner, carrier, mode);
        return user.role === "admin" && user.channel === "web" ? saved : { carrier, mode, enabled: saved.enabled, configured: saved.configured };
      };
      if (parts.length === 1 && req.method === "GET") {
        const mode = z.enum(["sandbox", "production"]).parse(new URL(req.url).searchParams.get("mode") ?? areaMode);
        assertArea(mode);
        return json({ settings: await Promise.all(carrierIds.map((carrier) => publicSettings(carrier, mode))) });
      }
      if (parts.length === 3) {
        const mode = z.enum(["sandbox", "production"]).parse(parts[1]);
        assertArea(mode);
        const carrier = z.enum(carrierIds).parse(parts[2]);
        if (req.method === "PUT") return json(await settings.save(owner, carrier, mode, await body(req), user));
        if (req.method === "DELETE") {
          await settings.delete(owner, carrier, mode, user);
          return json(await settings.get(owner, carrier, mode));
        }
      }
      if (parts.length === 4 && parts[3] === "test" && req.method === "POST") {
        const mode = z.enum(["sandbox", "production"]).parse(parts[1]);
        const carrier = z.enum(carrierIds).parse(parts[2]);
        assertArea(mode);
        rateLimit(`carrier-test:${owner}:${mode}:${carrier}`, 5);
        return json(await testCarrierConnection(owner, carrier, mode, groupId));
      }
    }
    if (route === "postal-suggestions" && req.method === "GET") {
      assertMode(areaMode, user);
      const query = new URL(req.url).searchParams;
      return json(await postalSuggestions({ country: query.get("country"), postalCode: query.get("postalCode") }));
    }
    if (parts[0] === "labels" && req.method === "GET") {
      assertMode(areaMode, user);
      const groupId = await managedGroup(user, new URL(req.url).searchParams.get("groupId"));
      const labels = new Labels(undefined, groupId);
      if (parts.length === 1) {
        const query = new URL(req.url).searchParams;
        const page = z.coerce.number().int().min(1).max(1000000).parse(query.get("page") ?? 1);
        const pageSize = z.coerce.number().refine((value) => [10, 20, 50, 100].includes(value), "Choose a page size of 10, 20, 50 or 100").parse(query.get("pageSize") ?? 20);
        return json(await labels.list(user.id, areaMode, page, pageSize));
      }
      if (parts.length === 2) return json(await labels.get(user.id, areaMode, z.string().uuid().parse(parts[1])));
    }
    if (route === "loomis/labels" && req.method === "POST") {
      if (areaMode !== "sandbox") throw new AppError(400, "SANDBOX_ONLY", "Label generation is available in sandbox only.");
      assertMode("sandbox", user);
      const groupId = await requireGroup(user.id);
      if (!await generationEnabled(areaMode, groupId)) throw new AppError(403, "GENERATION_DISABLED", "Tracking and label generation is disabled by an administrator.");
      rateLimit(`loomis-label:${user.id}`, 5);
      const input = z.object({ shipment: shipmentSchema, serviceCode: z.enum(["DD", "DE", "DN", "D9"]) }).strict().parse(await body(req));
      const generated = await generateLoomisLabel(user.id, input.shipment, input.serviceCode, groupId);
      const saved = await new Labels(undefined, groupId).save(user.id, { mode: "sandbox", service_code: input.serviceCode, label_id: generated.labelId, shipment_number: generated.shipmentNumber, shipment: sandboxLabelShipment(input.shipment), labels: generated.labels });
      return json({ ...generated, id: saved.id }, 201);
    }
    if (parts[0] === "rate-logs" && ["GET", "DELETE"].includes(req.method)) {
      assertMode(areaMode, user);
      const query = new URL(req.url).searchParams;
      const logs = new QuoteLogs(await managedGroup(user, query.get("groupId")));
      if (parts.length === 2 && req.method === "DELETE") {
        await logs.delete(areaMode, z.string().uuid().parse(parts[1]));
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }
      if (parts.length === 2 && req.method === "GET") return json(await logs.get(areaMode, z.string().uuid().parse(parts[1])));
      if (parts.length === 1 && req.method === "GET") {
        const page = z.coerce.number().int().min(1).max(1000000).parse(query.get("page") ?? 1);
        const pageSize = z.coerce.number().refine(value => [10,20,50,100].includes(value), "Choose 10, 20, 50 or 100 rows").parse(query.get("pageSize") ?? 20);
        return json(await logs.list(areaMode, page, pageSize));
      }
    }
    if (route === "rates" && req.method === "POST") {
      if (!user) throw new AppError(403, "USER_REQUIRED", "Sign in to use your account's carrier credentials");
      const input = shipmentSchema.extend({ carrierMode: z.enum(["sandbox", "production"]).default(areaMode), comparisonId: z.string().uuid().optional(), comparisonCarriers: z.array(z.enum(carrierIds)).min(1).max(carrierIds.length).refine(value => new Set(value).size === value.length, "Duplicate carriers").optional() }).parse(await body(req));
      const { comparisonId, comparisonCarriers, ...s } = input;
      if (!!comparisonId !== !!comparisonCarriers || comparisonCarriers && s.carriers.some(carrier => !comparisonCarriers.includes(carrier))) throw new AppError(400, "INVALID_COMPARISON", "Provide a comparison ID and all selected carriers together.");
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
      const groupId = await requireGroup(user.id), logs = new QuoteLogs(groupId);
      const snapshot = { ...s, carriers: comparisonCarriers ?? s.carriers };
      const initial = { requestId: "", quotedAt: new Date().toISOString(), mode: areaMode, appEnvironment: process.env.APP_ENV ?? "development", results: [], carrierStatuses: snapshot.carriers.map(carrier => ({ carrier, mode: areaMode, source: mockEnabled(areaMode) ? "mock" as const : "live_carrier" as const, status: "quoting", message: null })) };
      const logId = await logs.start(user.id, snapshot, initial, comparisonId);
      try {
        const comparison = await compare(s, user.id, groupId);
        await logs.complete(logId, user.id, comparison);
        return json({ ...comparison, quoteLogId: logId });
      } catch (error) {
        await logs.complete(logId, user.id, { ...initial, carrierStatuses: initial.carrierStatuses.filter(status => s.carriers.includes(status.carrier)).map(status => ({ ...status, status: "error", message: "Could not complete this carrier comparison." })) });
        throw error;
      }
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
