import { Button, Card, Field } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api, type Domain } from "../api.js";
import { AuthShell } from "../Brand.js";
import { passwordManagerLabel, storeInPasswordManager } from "../password-store.js";
import { toastFail, useToast } from "../Toast.js";
import { TotpEnroll } from "../TotpEnroll.js";

const STEPS = [
  ["admin", "Account"],
  ["security", "Security"],
  ["llm", "Model"],
  ["domains_sources", "Sources"],
] as const;

function SetupPage() {
  const [status, setStatus] = useState<{ currentStep: string; domains: Domain[] } | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string>();
  const [passwordSavePending, setPasswordSavePending] = useState(false);
  const [otpauth, setOtpauth] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [totp, setTotp] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [savedCodes, setSavedCodes] = useState(false);
  const [provider, setProvider] = useState("openai_compatible");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [apiKey, setApiKey] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChat, setTelegramChat] = useState("");

  async function refreshStatus() {
    const value = await api<{ currentStep: string; completed: boolean; domains: Domain[] }>(
      "/api/v1/setup/status",
    );
    setStatus(value);
    if (value.completed) {
      window.location.assign("/");
    }
    return value;
  }

  useEffect(() => {
    void refreshStatus().catch((err: unknown) => {
      toast(toastFail(err, "Couldn’t load setup"), "danger");
    });
  }, []);

  useEffect(() => {
    if (status?.currentStep !== "security" || passwordSavePending || otpauth || codes.length > 0) {
      return;
    }
    void api<{ otpauth: string; secret: string }>("/api/v1/setup/totp/start", { method: "POST" })
      .then((result) => {
        setOtpauth(result.otpauth);
        setSecret(result.secret);
      })
      .catch((err: unknown) => {
        toast(toastFail(err, "Couldn’t start authenticator setup"), "danger");
      });
  }, [status?.currentStep, passwordSavePending, otpauth, codes.length]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast(toastFail(err, "Couldn’t save"), "danger");
    } finally {
      setBusy(false);
    }
  }

  const stepNumber = Math.max(1, STEPS.findIndex(([id]) => id === status?.currentStep) + 1);

  return (
    <AuthShell title="Set up Riddlr">
      <ol className="stepper" aria-label="Setup steps">
        {STEPS.map(([id, label]) => (
          <li key={id} aria-current={status?.currentStep === id ? "step" : undefined}>
            {label}
          </li>
        ))}
      </ol>

      {status?.currentStep === "admin" ? (
        <Card>
          <header>
            <p className="step-count">Step {stepNumber} of 4</p>
            <h2>Create your account</h2>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (password !== passwordConfirm) {
                setPasswordError("Passwords don’t match");
                return;
              }
              setPasswordError(undefined);
              void run(async () => {
                await api("/api/v1/setup/admin", {
                  method: "POST",
                  body: JSON.stringify({ email, password }),
                });
                setPasswordSavePending(true);
                await refreshStatus();
              });
            }}
          >
            <Field label="Email">
              <input
                id="email"
                name="username"
                type="email"
                autoComplete="username"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field
              label="Password"
              hint="At least 12 characters. Store it somewhere you can recover it."
            >
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(undefined);
                }}
                minLength={12}
                required
              />
            </Field>
            <Field label="Confirm password" error={passwordError}>
              <input
                id="confirm-password"
                name="passwordConfirm"
                type="password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={(e) => {
                  setPasswordConfirm(e.target.value);
                  setPasswordError(undefined);
                }}
                minLength={12}
                required
              />
            </Field>
            <p className="ui-actions">
              <Button type="submit" busy={busy}>
                Create administrator
              </Button>
            </p>
          </form>
        </Card>
      ) : null}

      {status?.currentStep === "security" || (codes.length > 0 && !savedCodes) ? (
        <Card>
          <header>
            <p className="step-count">Step {stepNumber} of 4</p>
            <h2>{passwordSavePending ? "Save your password" : "Add an authenticator"}</h2>
          </header>
          {passwordSavePending ? (
            <>
              <p className="field-note">Riddlr cannot recover this password.</p>
              <p className="ui-actions">
                <Button
                  busy={busy}
                  onClick={() => {
                    void run(async () => {
                      const stored = await storeInPasswordManager(email, password);
                      if (stored) {
                        toast("Saved to your password manager");
                      } else {
                        try {
                          await navigator.clipboard.writeText(password);
                          toast("Copied. Paste it into your password manager");
                        } catch {
                          toast("Couldn’t save. Copy the password yourself", "danger");
                        }
                      }
                      setPassword("");
                      setPasswordConfirm("");
                      setPasswordSavePending(false);
                    });
                  }}
                >
                  {passwordManagerLabel()}
                </Button>
              </p>
              <p className="skip-row">
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    setPassword("");
                    setPasswordConfirm("");
                    setPasswordSavePending(false);
                  }}
                >
                  Skip for now
                </Button>
              </p>
            </>
          ) : codes.length > 0 ? (
            <aside>
              <h2>Recovery codes</h2>
              <p>Save these now. Each code works once.</p>
              <ul className="recovery-codes">
                {codes.map((code) => (
                  <li key={code} translate="no">
                    {code}
                  </li>
                ))}
              </ul>
              <p className="ui-actions">
                <Button
                  onClick={() => {
                    setSavedCodes(true);
                  }}
                >
                  I have saved these codes
                </Button>
              </p>
            </aside>
          ) : (
            <>
              {otpauth && secret ? (
                <TotpEnroll
                  otpauth={otpauth}
                  secret={secret}
                  token={totp}
                  onToken={setTotp}
                  busy={busy}
                  verifyLabel="Verify 2FA"
                  onVerify={async () => {
                    await run(async () => {
                      const result = await api<{ recoveryCodes: string[] }>(
                        "/api/v1/setup/totp/verify",
                        {
                          method: "POST",
                          body: JSON.stringify({ token: totp }),
                        },
                      );
                      setCodes(result.recoveryCodes);
                      await refreshStatus();
                    });
                  }}
                />
              ) : (
                <p>Preparing authenticator…</p>
              )}
              <p className="skip-row">
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      await api("/api/v1/setup/totp/skip", { method: "POST" });
                      await refreshStatus();
                    });
                  }}
                >
                  Skip for now
                </Button>
              </p>
            </>
          )}
        </Card>
      ) : null}

      {status?.currentStep === "llm" && (savedCodes || codes.length === 0) ? (
        <Card>
          <header>
            <p className="step-count">Step {stepNumber} of 4</p>
            <h2>Connect a model</h2>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api("/api/v1/setup/llm", {
                  method: "POST",
                  body: JSON.stringify({ provider, baseUrl, model, apiKey }),
                });
                await refreshStatus();
              });
            }}
          >
            <Field label="Provider">
              <select
                id="provider"
                name="provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="openai_compatible">OpenAI-compatible</option>
                <option value="anthropic_compatible">Anthropic-compatible</option>
              </select>
            </Field>
            <Field label="Base URL">
              <input
                id="base-url"
                name="baseUrl"
                type="url"
                autoComplete="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
              />
            </Field>
            <Field label="Model">
              <input
                id="model"
                name="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                required
              />
            </Field>
            <Field label="API key" hint="Stored encrypted. Never shown again.">
              <input
                id="api-key"
                name="apiKey"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
              />
            </Field>
            <p className="ui-actions">
              <Button type="submit" busy={busy}>
                Save provider
              </Button>
            </p>
          </form>
          <p className="skip-row">
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  await api("/api/v1/setup/llm/skip", { method: "POST" });
                  await refreshStatus();
                });
              }}
            >
              Skip for now
            </Button>
          </p>
        </Card>
      ) : null}

      {status?.currentStep === "domains_sources" ? (
        <Card>
          <header>
            <p className="step-count">Step {stepNumber} of 4</p>
            <h2>Choose markets</h2>
          </header>
          <div className="domain-options">
            {(status.domains ?? []).map((domain) => (
              <label key={domain.id} className="ui-field domain-option">
                <input
                  type="checkbox"
                  checked={domain.id === "crypto"}
                  disabled={!domain.selectable}
                  readOnly
                />
                <span>
                  {domain.name}{" "}
                  {domain.comingSoon ? (
                    <span className="badge soon">Coming soon</span>
                  ) : (
                    <span className="badge">Supported</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <Field label="Telegram bot token" hint="Optional notification destination.">
            <input
              id="telegram-bot-token"
              name="telegramBotToken"
              autoComplete="off"
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
            />
          </Field>
          <Field label="Telegram chat ID">
            <input
              id="telegram-chat-id"
              name="telegramChatId"
              autoComplete="off"
              value={telegramChat}
              onChange={(e) => setTelegramChat(e.target.value)}
            />
          </Field>
          <p className="ui-actions">
            <Button
              busy={busy}
              onClick={() => {
                void run(async () => {
                  await api("/api/v1/setup/complete", {
                    method: "POST",
                    body: JSON.stringify({
                      marketDomainIds: ["crypto"],
                      telegramBotToken: telegramToken || undefined,
                      telegramChatId: telegramChat || undefined,
                    }),
                  });
                  window.location.assign("/");
                });
              }}
            >
              Finish setup
            </Button>
          </p>
        </Card>
      ) : null}
    </AuthShell>
  );
}
export { SetupPage };
