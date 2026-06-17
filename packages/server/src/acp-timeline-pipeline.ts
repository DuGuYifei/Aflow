import {
  reduceAcpTimelineEvents,
  type AcpTimelineEvent,
  type AcpTimelineSource,
  type AcpTimelineStatus,
} from "@specflow/shared";
import { uuidv7 } from "@specflow/shared";
import { resolveSpecflowLogger, type SpecflowLogger, type SpecflowLoggerOption } from "./logger";

export interface AcpTimelinePipelineOptions {
  source: AcpTimelineSource;
  scopeId: string;
  initialEvents?: AcpTimelineEvent[];
  append: (event: AcpTimelineEvent) => Promise<void>;
  emit?: (event: AcpTimelineEvent) => void;
  base?: Partial<Pick<
    AcpTimelineEvent,
    "runId" | "designSessionId" | "agentServerId" | "specflowSessionId" | "sessionId" | "phase"
  >>;
  logger?: SpecflowLoggerOption;
}

export class AcpTimelinePipeline {
  readonly #source: AcpTimelineSource;
  readonly #scopeId: string;
  readonly #append: (event: AcpTimelineEvent) => Promise<void>;
  readonly #emit: ((event: AcpTimelineEvent) => void) | undefined;
  readonly #base: AcpTimelinePipelineOptions["base"];
  readonly #logger: SpecflowLogger;
  readonly #events: AcpTimelineEvent[];
  #write = Promise.resolve();

  constructor(options: AcpTimelinePipelineOptions) {
    this.#source = options.source;
    this.#scopeId = options.scopeId;
    this.#append = options.append;
    this.#emit = options.emit;
    this.#base = options.base;
    this.#logger = resolveSpecflowLogger(options.logger);
    this.#events = [...(options.initialEvents ?? [])];
  }

  get events(): AcpTimelineEvent[] {
    return this.#events;
  }

  record(input: Record<string, unknown> & {
    kind: AcpTimelineEvent["kind"];
    id?: string;
    at?: string;
  }): AcpTimelineEvent {
    const event = {
      type: "acp_timeline",
      id: input.id ?? uuidv7(),
      at: input.at ?? new Date().toISOString(),
      source: this.#source,
      scopeId: this.#scopeId,
      ...this.#base,
      ...input,
    } as AcpTimelineEvent;
    this.#events.push(event);
    this.#write = this.#write
      .then(async () => {
        await this.#append(event);
        if (event.kind !== "timeline_snapshot") this.#emit?.(event);
      })
      .catch((error) => {
        this.#logger.error("Failed to append ACP timeline event", error);
      });
    return event;
  }

  snapshot(input: {
    status: AcpTimelineStatus;
    turnId?: string;
    metadata?: Record<string, unknown>;
  }): AcpTimelineEvent {
    const rawEvents = this.#events.filter((event) => event.kind !== "timeline_snapshot");
    const blocks = reduceAcpTimelineEvents(this.#events);
    return this.record({
      kind: "timeline_snapshot",
      status: input.status,
      turnId: input.turnId,
      blocks,
      rawEventCount: rawEvents.length,
      metadata: input.metadata,
    });
  }

  async flush(): Promise<void> {
    await this.#write;
  }
}
