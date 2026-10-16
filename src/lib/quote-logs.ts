import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Store } from "./db";
import { AppError } from "./errors";
import type { AppMode } from "./app-routes";
import type { Shipment } from "./schemas";
import type { Comparison } from "./carriers/types";
import type { QuoteLog, QuoteLogSummary } from "./quote-log-types";

type Row = { id: string; mode: AppMode; shipment_json: string; comparison_json: string; created_at: string };
const parse = (row: Row): QuoteLog => {
  const shipment: Shipment = JSON.parse(row.shipment_json), comparison: Comparison = JSON.parse(row.comparison_json);
  const location = (address: Shipment["ship_from"]) => ({ city: address.city, region: address.region, postal_code: address.postal_code });
  const pending = comparison.carrierStatuses.some(status => status.status === "quoting");
  const failure = comparison.carrierStatuses.some(status => status.status !== "success");
  return { id: row.id, mode: row.mode, created_at: row.created_at, shipment, comparison, ship_from: location(shipment.ship_from), ship_to: location(shipment.ship_to), shipDate: shipment.shipDate,
    quantity: shipment.packages[0].quantity ?? 1, weight: shipment.packages[0].weight, weightUnit: shipment.packages[0].weightUnit, rateCount: comparison.results.length,
    status: pending ? "comparing" : !comparison.results.length ? "no_rates" : failure ? "partial" : "completed" };
};
// Save normalized prices/statuses; upstream response blobs are transient and may contain account details.
const publicComparison = (value: Comparison): Comparison => ({ ...value, results: value.results.map(row => {
  const { apiResult: _apiResult, withCoverage, ...rest } = row;
  const { apiResult: _coveredApiResult, ...covered } = withCoverage;
  void _apiResult; void _coveredApiResult;
  return { ...rest, withCoverage: covered };
}) });
export class QuoteLogs {
  constructor(private groupId: string, private store: Store = db()) {}
  async start(owner: string, shipment: Shipment, initial: Comparison, requestedId: string = randomUUID()) {
    const snapshot = JSON.stringify(shipment);
    await this.store.transaction(async tx => {
      await tx.query("INSERT INTO quote_logs(id,group_id,user_id,mode,shipment_json,comparison_json,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING", [requestedId, this.groupId, owner, shipment.carrierMode, snapshot, JSON.stringify(publicComparison({ ...initial, requestId: requestedId })), initial.quotedAt]);
      const [existing] = await tx.query<{ shipment_json: string }>("SELECT shipment_json FROM quote_logs WHERE id=? AND group_id=? AND user_id=? AND mode=?", [requestedId, this.groupId, owner, shipment.carrierMode]);
      if (!existing || existing.shipment_json !== snapshot) throw new AppError(409, "COMPARISON_CONFLICT", "Start a new comparison for changed shipment details.");
    });
    return requestedId;
  }
  async complete(id: string, owner: string, response: Comparison) {
    await this.store.transaction(async tx => {
      const [row] = await tx.query<{ comparison_json: string }>(`SELECT comparison_json FROM quote_logs WHERE id=? AND group_id=? AND user_id=?${this.store.provider === "postgresql" ? " FOR UPDATE" : ""}`, [id, this.groupId, owner]);
      if (!row) throw new AppError(404, "NOT_FOUND", "Rate log not found");
      const current: Comparison = JSON.parse(row.comparison_json), next = publicComparison(response);
      const carriers = new Set(next.carrierStatuses.map(status => status.carrier));
      const merged: Comparison = { ...current, quotedAt: next.quotedAt, results: [...current.results.filter(row => !carriers.has(row.carrier)), ...next.results], carrierStatuses: current.carrierStatuses.map(status => next.carrierStatuses.find(item => item.carrier === status.carrier) ?? status) };
      await tx.query("UPDATE quote_logs SET comparison_json=? WHERE id=? AND group_id=?", [JSON.stringify(merged), id, this.groupId]);
    });
  }
  async delete(mode: AppMode, id: string) {
    await this.store.transaction(async tx => {
      const [row] = await tx.query<{ comparison_json: string; created_at: string }>(`SELECT comparison_json,created_at FROM quote_logs WHERE id=? AND group_id=? AND mode=?${this.store.provider === "postgresql" ? " FOR UPDATE" : ""}`, [id, this.groupId, mode]);
      if (!row) throw new AppError(404, "NOT_FOUND", "Rate log not found");
      const comparison: Comparison = JSON.parse(row.comparison_json);
      if (comparison.carrierStatuses.some(status => status.status === "quoting") && Date.now() - Date.parse(row.created_at) < 90000)
        throw new AppError(409, "COMPARISON_IN_PROGRESS", "This comparison is still running. Wait for it to finish before deleting its log.");
      await tx.query("DELETE FROM quote_logs WHERE id=? AND group_id=? AND mode=?", [id, this.groupId, mode]);
    });
  }
  async list(mode: AppMode, requestedPage = 1, pageSize = 20) {
    const [count] = await this.store.query<{ total: number | string }>("SELECT COUNT(*) AS total FROM quote_logs WHERE group_id=? AND mode=?", [this.groupId, mode]);
    const total = Number(count.total), totalPages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(requestedPage, totalPages);
    const rows = await this.store.query<Row>("SELECT id,mode,shipment_json,comparison_json,created_at FROM quote_logs WHERE group_id=? AND mode=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", [this.groupId, mode, pageSize, (page - 1) * pageSize]);
    const logs: QuoteLogSummary[] = rows.map(row => { const { shipment: _shipment, comparison: _comparison, ...summary } = parse(row); void _shipment; void _comparison; return summary; });
    return { logs, total, totalPages, page, pageSize };
  }
  async get(mode: AppMode, id: string) {
    const [row] = await this.store.query<Row>("SELECT id,mode,shipment_json,comparison_json,created_at FROM quote_logs WHERE id=? AND group_id=? AND mode=?", [id, this.groupId, mode]);
    if (!row) throw new AppError(404, "NOT_FOUND", "Rate log not found");
    return parse(row);
  }
}
