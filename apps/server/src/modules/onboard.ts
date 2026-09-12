import {
  completeSetupSchema,
  llmSetupSchema,
  setupAdminSchema,
  setupUnlockSchema,
} from "@riddlr/api-contract";
import { needsSetupCode } from "@riddlr/domain";

export type OnboardStatus = {
  completed: boolean;
  currentStep: string;
  setupAccess?: "local" | "code";
  canContinue?: boolean;
};

export type OnboardClient = {
  getStatus(): Promise<OnboardStatus>;
  unlock(code: string): Promise<void>;
  createAdmin(input: { email: string; password: string; username?: string }): Promise<void>;
  skipTotp(): Promise<void>;
  startTotp(): Promise<{ otpauth: string; secret: string }>;
  verifyTotp(token: string): Promise<{ recoveryCodes: string[] }>;
  skipLlm(): Promise<void>;
  saveLlm(input: {
    provider: "openai_compatible" | "anthropic_compatible";
    baseUrl: string;
    model: string;
    apiKey: string;
  }): Promise<void>;
  complete(input: {
    marketDomainIds: string[];
    telegramBotToken?: string;
    telegramChatId?: string;
  }): Promise<void>;
};

export type OnboardIo = {
  read(prompt: string): Promise<string>;
  write(text: string): void;
};

export type OnboardFlags = {
  nonInteractive?: boolean;
  email?: string;
  password?: string;
  passwordEnv?: string;
  username?: string;
  setupCode?: string;
  skipTotp?: boolean;
  totpToken?: string;
  skipLlm?: boolean;
  llmProvider?: "openai_compatible" | "anthropic_compatible";
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiKey?: string;
  marketDomainIds?: string[];
  telegramBotToken?: string;
  telegramChatId?: string;
};

export class OnboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardError";
  }
}

function requireValue(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new OnboardError(`${label} is required.`);
  }
  return trimmed;
}

function passwordFromFlags(flags: OnboardFlags): string {
  if (flags.passwordEnv) {
    const fromEnv = process.env[flags.passwordEnv];
    return requireValue(fromEnv, `Environment ${flags.passwordEnv}`);
  }
  return requireValue(flags.password, "Password");
}

export async function runOnboard(
  flags: OnboardFlags,
  client: OnboardClient,
  io: OnboardIo,
): Promise<{ ok: true; recoveryCodes?: string[] }> {
  const status = await client.getStatus();
  if (status.completed) {
    throw new OnboardError("Setup is already complete.");
  }

  if (needsSetupCode(status)) {
    const code = flags.nonInteractive
      ? requireValue(flags.setupCode, "Setup code")
      : requireValue(
          flags.setupCode ?? (await io.read("Setup code from first start")),
          "Setup code",
        );
    setupUnlockSchema.parse({ code });
    await client.unlock(code);
  }

  const email = flags.nonInteractive
    ? requireValue(flags.email, "Email")
    : requireValue(flags.email ?? (await io.read("Administrator email")), "Email");
  const password = flags.nonInteractive
    ? passwordFromFlags(flags)
    : requireValue(flags.password ?? (await io.read("Administrator password")), "Password");
  const parsedAdmin = setupAdminSchema.parse({
    email,
    password,
    username: flags.username,
  });
  await client.createAdmin(parsedAdmin);

  let recoveryCodes: string[] | undefined;
  if (flags.skipTotp) {
    await client.skipTotp();
  } else if (flags.nonInteractive) {
    throw new OnboardError("Non-interactive setup must skip authenticator (--skip-totp).");
  } else {
    const enrollment = await client.startTotp();
    io.write(`Authenticator key: ${enrollment.secret}`);
    io.write(enrollment.otpauth);
    const token = requireValue(
      flags.totpToken ?? (await io.read("6-digit authenticator code")),
      "Authenticator code",
    );
    const verified = await client.verifyTotp(token);
    recoveryCodes = verified.recoveryCodes;
    io.write("Recovery codes (save these now; each works once):");
    for (const code of verified.recoveryCodes) {
      io.write(code);
    }
    await io.read("Type yes after you have saved the recovery codes");
  }

  if (flags.skipLlm || (!flags.llmApiKey && flags.nonInteractive)) {
    await client.skipLlm();
  } else if (flags.llmApiKey) {
    const llm = llmSetupSchema.parse({
      provider: flags.llmProvider ?? "openai_compatible",
      baseUrl: flags.llmBaseUrl ?? "https://api.openai.com",
      model: flags.llmModel ?? "gpt-4.1-mini",
      apiKey: flags.llmApiKey,
    });
    await client.saveLlm(llm);
  } else {
    const skip = (await io.read("Connect a model now? (yes/skip)")).trim().toLowerCase();
    if (skip === "skip") {
      await client.skipLlm();
    } else {
      const llm = llmSetupSchema.parse({
        provider: (flags.llmProvider ??
          (await io.read("Provider (openai_compatible or anthropic_compatible)"))) as
          | "openai_compatible"
          | "anthropic_compatible",
        baseUrl: flags.llmBaseUrl ?? (await io.read("Base URL")),
        model: flags.llmModel ?? (await io.read("Model")),
        apiKey: flags.llmApiKey ?? (await io.read("API key")),
      });
      await client.saveLlm(llm);
    }
  }

  const marketDomainIds = flags.marketDomainIds ?? ["crypto"];
  const complete = completeSetupSchema.parse({
    marketDomainIds,
    telegramBotToken: flags.telegramBotToken,
    telegramChatId: flags.telegramChatId,
  });
  await client.complete(complete);
  io.write("Setup complete. Sign in at the dashboard.");
  return { ok: true, recoveryCodes };
}

export function parseOnboardArgs(argv: string[]): OnboardFlags {
  const flags: OnboardFlags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new OnboardError(`Missing value for ${arg}.`);
      }
      index += 1;
      return value;
    };
    switch (arg) {
      case "--non-interactive":
        flags.nonInteractive = true;
        break;
      case "--email":
        flags.email = next();
        break;
      case "--password":
        flags.password = next();
        break;
      case "--password-env":
        flags.passwordEnv = next();
        break;
      case "--username":
        flags.username = next();
        break;
      case "--setup-code":
        flags.setupCode = next();
        break;
      case "--skip-totp":
        flags.skipTotp = true;
        break;
      case "--totp-token":
        flags.totpToken = next();
        break;
      case "--skip-llm":
        flags.skipLlm = true;
        break;
      case "--llm-provider":
        flags.llmProvider = next() as OnboardFlags["llmProvider"];
        break;
      case "--llm-base-url":
        flags.llmBaseUrl = next();
        break;
      case "--llm-model":
        flags.llmModel = next();
        break;
      case "--llm-api-key":
        flags.llmApiKey = next();
        break;
      case "--market-domain":
        flags.marketDomainIds = [next()];
        break;
      case "--telegram-bot-token":
        flags.telegramBotToken = next();
        break;
      case "--telegram-chat-id":
        flags.telegramChatId = next();
        break;
      case "--help":
      case "-h":
        throw new OnboardError("help");
      default:
        throw new OnboardError(`Unknown argument: ${arg}`);
    }
  }
  return flags;
}

export function onboardHelp(): string {
  return `Finish first-run from this host (same four steps as the browser).

  node apps/server/dist/cmd/onboard.js --non-interactive \\
    --email you@example.com --password-env RIDDLR_ADMIN_PASSWORD --skip-totp --skip-llm

On a published instance, pass --setup-code only if the start command showed one.
Skip authenticator in non-interactive mode; enable it later in Settings.`;
}

type HeaderMap = Record<string, string>;

export function createHttpOnboardClient(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): OnboardClient {
  let cookie = "";

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: HeaderMap = {};
    if (cookie) {
      headers.cookie = cookie;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    const response = await fetchImpl(`${origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    const fallback = response.headers.get("set-cookie");
    cookie = mergeCookies(cookie, setCookie.length > 0 ? setCookie : fallback ? [fallback] : []);
    const json = (await response.json().catch(() => ({}))) as T & {
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new OnboardError(json.error?.message ?? `Request failed (${response.status}).`);
    }
    return json;
  }

  return {
    getStatus: () => request<OnboardStatus>("GET", "/api/v1/setup/status"),
    unlock: async (code) => {
      await request("POST", "/api/v1/setup/unlock", { code });
    },
    createAdmin: async (input) => {
      await request("POST", "/api/v1/setup/admin", input);
    },
    skipTotp: async () => {
      await request("POST", "/api/v1/setup/totp/skip", {});
    },
    startTotp: () => request("POST", "/api/v1/setup/totp/start", {}),
    verifyTotp: (token) => request("POST", "/api/v1/setup/totp/verify", { token }),
    skipLlm: async () => {
      await request("POST", "/api/v1/setup/llm/skip", {});
    },
    saveLlm: async (input) => {
      await request("POST", "/api/v1/setup/llm", input);
    },
    complete: async (input) => {
      await request("POST", "/api/v1/setup/complete", input);
    },
  };
}

function mergeCookies(current: string, setCookie: string[]): string {
  const map = new Map<string, string>();
  for (const pair of current.split(";")) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
  }
  for (const line of setCookie) {
    const first = line.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq > 0) {
      map.set(first.slice(0, eq), first.slice(eq + 1));
    }
  }
  return [...map.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}
