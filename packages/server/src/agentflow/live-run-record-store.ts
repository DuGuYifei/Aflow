import type { RunRecord } from "./run-store";
import { loadRun } from "./run-store";

export class LiveRunRecordStore {
  readonly #records = new Map<string, RunRecord>();

  register(record: RunRecord): void {
    this.#records.set(record.id, record);
  }

  get(id: string): RunRecord | undefined {
    return this.#records.get(id);
  }

  delete(id: string): void {
    this.#records.delete(id);
  }

  async loadAuthoritative(id: string, root: string): Promise<RunRecord> {
    return this.#records.get(id) ?? await loadRun(id, root);
  }
}
