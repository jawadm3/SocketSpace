/**
 * Who is online (RT-03, PROF-02), kept in this server's memory, never in the database (apart
 * from "last seen", written when someone goes offline).
 *
 * Each open tab reports its own state: `online` while in use, `away` when hidden or idle, `dnd`
 * when the person chose "do not disturb". A person's status combines their tabs: `dnd` if any tab
 * says so, else `online` if any tab is in use, else `away`; with no tabs left they are `offline`.
 * In invisible mode everyone else always sees `offline`.
 *
 * Limitation: with several realtime servers (Redis adapter), each server only knows its own
 * connections. The free deployment runs one server, so this is exact there (D-038).
 */
export type TabStatus = 'online' | 'away' | 'dnd';
export type PresenceStatus = TabStatus | 'offline';

interface Person {
  tabs: Map<string, TabStatus>;
  visible: boolean;
}

export interface PresenceChange {
  userId: string;
  /** What other people should now see. */
  status: PresenceStatus;
}

export class PresenceTracker {
  private readonly people = new Map<string, Person>();

  private combined(person: Person | undefined): PresenceStatus {
    if (!person || person.tabs.size === 0) return 'offline';
    const states = new Set(person.tabs.values());
    if (states.has('dnd')) return 'dnd';
    if (states.has('online')) return 'online';
    return 'away';
  }

  /** What others see for this person right now. */
  visibleStatus(userId: string): PresenceStatus {
    const person = this.people.get(userId);
    return person?.visible ? this.combined(person) : 'offline';
  }

  private change(
    userId: string,
    update: (person: Person) => void,
    visible?: boolean,
  ): PresenceChange | null {
    const before = this.visibleStatus(userId);
    const person = this.people.get(userId) ?? { tabs: new Map(), visible: visible ?? true };
    update(person);
    if (person.tabs.size === 0) this.people.delete(userId);
    else this.people.set(userId, person);
    const after = this.visibleStatus(userId);
    return before === after ? null : { userId, status: after };
  }

  /** A tab connected. Returns the change others should see, if any. */
  connect(userId: string, socketId: string, visible: boolean): PresenceChange | null {
    return this.change(
      userId,
      (person) => {
        person.visible = visible;
        person.tabs.set(socketId, 'online');
      },
      visible,
    );
  }

  disconnect(userId: string, socketId: string): PresenceChange | null {
    return this.change(userId, (person) => {
      person.tabs.delete(socketId);
    });
  }

  /** A tab reports `online`, `away` or `dnd`. */
  set(userId: string, socketId: string, status: TabStatus): PresenceChange | null {
    if (!this.people.get(userId)?.tabs.has(socketId)) return null;
    return this.change(userId, (person) => {
      person.tabs.set(socketId, status);
    });
  }

  /** Invisible mode switched on or off. */
  setVisible(userId: string, visible: boolean): PresenceChange | null {
    if (!this.people.has(userId)) return null;
    return this.change(userId, (person) => {
      person.visible = visible;
    });
  }

  /** True while the person has at least one tab connected to this server. */
  isConnected(userId: string): boolean {
    return (this.people.get(userId)?.tabs.size ?? 0) > 0;
  }
}
