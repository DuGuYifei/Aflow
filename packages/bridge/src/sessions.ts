import { uuidv7 } from "@specflow/shared";

export interface BridgeSession {
  id: string;
  createdAt: Date;
}

export class SessionRegistry {
  readonly #sessions = new Map<string, BridgeSession>();

  create(): BridgeSession {
    const session = {
      id: uuidv7(),
      createdAt: new Date(),
    };

    this.#sessions.set(session.id, session);
    return session;
  }

  list(): BridgeSession[] {
    return Array.from(this.#sessions.values());
  }
}
