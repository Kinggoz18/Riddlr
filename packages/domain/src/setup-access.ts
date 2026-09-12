export const SETUP_ACCESS_MODES = ["loopback", "public"] as const;
export type SetupAccessMode = (typeof SETUP_ACCESS_MODES)[number];

/** CSPRNG size for the generated setup code. 16 bytes = 128 bits = 32 hex chars. */
export const SETUP_CODE_BYTES = 16;
export const SETUP_CODE_HEX_LENGTH = SETUP_CODE_BYTES * 2;
/** Unclaimed setup codes stop working after this many minutes. */
export const SETUP_CODE_TTL_MINUTES = 15;
export const SETUP_CODE_TTL_MS = SETUP_CODE_TTL_MINUTES * 60 * 1000;

export function setupCodeIsExpired(createdAt: string, now = Date.now()): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) {
    return true;
  }
  return now - created >= SETUP_CODE_TTL_MS;
}

export const SETUP_ACCESS_VIEWS = ["local", "code"] as const;
export type SetupAccessView = (typeof SETUP_ACCESS_VIEWS)[number];

export function setupAccessView(mode: SetupAccessMode): SetupAccessView {
  return mode === "public" ? "code" : "local";
}

export function normalizeSetupCode(input: string): string {
  return input.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

export function formatSetupCode(hex: string): string {
  const normalized = normalizeSetupCode(hex);
  if (normalized.length === 0) {
    return "";
  }
  return (normalized.match(/.{1,4}/g) ?? [normalized]).join("-");
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  const ip = address.trim().replace(/^::ffff:/i, "");
  if (ip === "::1") {
    return true;
  }
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return false;
  }
  if (parts[0] !== "127") {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

export function sshTunnelCommand(input: { user?: string; host: string; port?: number }): string {
  const user = input.user?.trim() || "USER";
  const host = input.host.trim() || "HOST";
  const port = input.port ?? 8080;
  return `ssh -N -L ${port}:127.0.0.1:${port} ${user}@${host}`;
}

export function dashboardPublish(mode: SetupAccessMode): string {
  return mode === "public" ? "0.0.0.0:8080" : "127.0.0.1:8080";
}

export function publishRequiresSetupCode(publish: string): boolean {
  const value = publish.trim().toLowerCase();
  if (/^\d+$/.test(value)) {
    return true;
  }
  if (
    value.startsWith("127.0.0.1:") ||
    value.startsWith("localhost:") ||
    value.startsWith("[::1]:")
  ) {
    return false;
  }
  return true;
}

export function setupCanContinue(input: {
  completed: boolean;
  access: SetupAccessView;
  fromLoopback: boolean;
  hasSetupProof: boolean;
}): boolean {
  if (input.completed) {
    return true;
  }
  if (input.access === "local") {
    return true;
  }
  return input.fromLoopback || input.hasSetupProof;
}

export function needsSetupCode(input: { setupAccess?: string; canContinue?: boolean }): boolean {
  return input.setupAccess === "code" && input.canContinue === false;
}
