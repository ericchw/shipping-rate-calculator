import "server-only";
import { requireGroup } from "./groups";
import { randomUUID } from "node:crypto";
import { db, type Store } from "./db";
import { AppError } from "./errors";
import type { AppMode } from "./app-routes";
import type { Shipment } from "./schemas";
import type { SavedLabel, LabelSummary } from "./label-types";

type RecordRow = LabelSummary & { shipment_json: string; labels_json: string };
export class Labels {
  constructor(private store: Store = db(), private groupId?: string) {}
  async list(owner: string, mode: AppMode, requestedPage = 1, pageSize = 20) {
    const groupId = this.groupId ?? await requireGroup(owner, this.store);
    const count = (await this.store.query<{ total: number | string }>("SELECT COUNT(*) AS total FROM company_labels WHERE group_id=? AND mode=?", [groupId, mode]))[0];
    const total = Number(count.total);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const rows = await this.store.query<LabelSummary & { shipment_json: string }>("SELECT id,mode,service_code,label_id,shipment_number,created_at,shipment_json FROM company_labels WHERE group_id=? AND mode=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", [groupId, mode, pageSize, (page - 1) * pageSize]);
    const labels = rows.map(({ shipment_json, ...summary }) => {
      const shipment = JSON.parse(shipment_json) as Shipment;
      const location = (address: Shipment["ship_from"]) => ({ city: address.city, region: address.region, postal_code: address.postal_code });
      return { ...summary, ship_from: location(shipment.ship_from), ship_to: location(shipment.ship_to), ship_date: shipment.shipDate };
    });
    return { labels, total, page, pageSize, totalPages };
  }
  async get(owner: string, mode: AppMode, id: string): Promise<SavedLabel> {
    const groupId = this.groupId ?? await requireGroup(owner, this.store);
    const row = (await this.store.query<RecordRow>("SELECT id,mode,service_code,label_id,shipment_number,created_at,shipment_json,labels_json FROM company_labels WHERE group_id=? AND mode=? AND id=?", [groupId, mode, id]))[0];
    if (!row) throw new AppError(404, "NOT_FOUND", "Label not found");
    const { shipment_json, labels_json, ...summary } = row;
    return { ...summary, shipment: JSON.parse(shipment_json), labels: JSON.parse(labels_json) };
  }
  async save(owner: string, input: Omit<SavedLabel, "id" | "created_at">): Promise<SavedLabel> {
    const groupId = this.groupId ?? await requireGroup(owner, this.store);
    const record = { ...input, id: randomUUID(), created_at: new Date().toISOString() };
    await this.store.query("INSERT INTO company_labels (id,group_id,user_id,mode,service_code,label_id,shipment_number,shipment_json,labels_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [record.id, groupId, owner, record.mode, record.service_code, record.label_id, record.shipment_number, JSON.stringify(record.shipment), JSON.stringify(record.labels), record.created_at]);
    return record;
  }
}
