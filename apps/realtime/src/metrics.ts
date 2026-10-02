/**
 * Basic metrics in the Prometheus text format (OBS-04), served at /metrics behind a bearer token:
 * connections, events by type and result, rate-limit hits, messages, event-loop delay and memory.
 * Counts only: no user IDs, no content.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly loopDelay = monitorEventLoopDelay({ resolution: 20 });
  private readonly startedMs = Date.now();
  connections = 0;

  constructor() {
    this.loopDelay.enable();
  }

  increment(name: string, labels: Record<string, string> = {}, by = 1): void {
    const key = `${name}${formatLabels(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  /** Current value of a counter (for tests). */
  value(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(`${name}${formatLabels(labels)}`) ?? 0;
  }

  render(): string {
    const lines = [
      '# HELP ss_connections Open Socket.IO connections on this instance.',
      '# TYPE ss_connections gauge',
      `ss_connections ${String(this.connections)}`,
      '# HELP ss_uptime_seconds Seconds since this instance started.',
      '# TYPE ss_uptime_seconds gauge',
      `ss_uptime_seconds ${String(Math.round((Date.now() - this.startedMs) / 1000))}`,
      '# HELP ss_event_loop_delay_p99_ms 99th percentile event-loop delay.',
      '# TYPE ss_event_loop_delay_p99_ms gauge',
      `ss_event_loop_delay_p99_ms ${(this.loopDelay.percentile(99) / 1e6).toFixed(2)}`,
      '# HELP ss_memory_rss_bytes Resident memory of the process.',
      '# TYPE ss_memory_rss_bytes gauge',
      `ss_memory_rss_bytes ${String(process.memoryUsage().rss)}`,
    ];
    const byName = new Map<string, string[]>();
    for (const [key, value] of [...this.counters.entries()].sort()) {
      const name = key.split('{')[0] ?? key;
      const entries = byName.get(name) ?? [];
      entries.push(`${key} ${String(value)}`);
      byName.set(name, entries);
    }
    for (const [name, entries] of byName) {
      lines.push(`# TYPE ${name} counter`, ...entries);
    }
    return `${lines.join('\n')}\n`;
  }

  close(): void {
    this.loopDelay.disable();
  }
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, '_')}"`).join(',')}}`;
}
