import { Controller, Get, Inject } from "@nestjs/common";
import { Public, RequireScopes, SkipRateLimit } from "../common/decorators";
import { STATUS_PROBES } from "../tokens";
import type { ComponentStatus, StatusProbe } from "./probes";

const PROBE_TIMEOUT_MS = 2_000;

export interface StatusReport {
  status: "ok" | "degraded";
  components: ComponentStatus[];
}

function withTimeout(probe: StatusProbe): Promise<ComponentStatus> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ name: probe.name, ok: false, detail: { error: "probe timed out" } }),
      PROBE_TIMEOUT_MS,
    );
    probe
      .probe()
      .then((status) => resolve(status))
      .catch(() => resolve({ name: probe.name, ok: false }))
      .finally(() => clearTimeout(timer));
  });
}

/** Liveness: the process answers. No auth, no dependencies touched. */
@Controller()
export class HealthController {
  @Public()
  @SkipRateLimit()
  @Get("health")
  health(): { status: "ok" } {
    return { status: "ok" };
  }
}

/** Readiness: every infrastructure dependency, probed live with a timeout. */
@Controller("v1/status")
export class StatusController {
  constructor(@Inject(STATUS_PROBES) private readonly probes: StatusProbe[]) {}

  @RequireScopes("read")
  @Get()
  async status(): Promise<StatusReport> {
    const components = await Promise.all(this.probes.map(withTimeout));
    return {
      status: components.every((component) => component.ok) ? "ok" : "degraded",
      components,
    };
  }
}
