import { Button, Card, Field } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api, type Domain } from "../api.js";

function SetupPage() {
  const [status, setStatus] = useState<{ currentStep: string; domains: Domain[] } | null>(null);
  const [error, setError] = useState<string>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpauth, setOtpauth] = useState<string>();
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
      setError(err instanceof Error ? err.message : "Failed to load setup");
    });
  }, []);

  return (
    <main id="main" className="page" style={{ maxWidth: 720, margin: "0 auto" }}>
      <p style={{ color: "var(--mint)", fontWeight: 800 }}>RIDDLR</p>
      <h1>First-run setup</h1>
      <p>Four steps. Crypto is operational. Other market domains are coming soon.</p>
      <ol aria-label="Setup steps">
        {[
          ["admin", "Administrator"],
          ["security", "Authenticator"],
          ["llm", "LLM provider"],
          ["domains_sources", "Domains and sources"],
        ].map(([id, label]) => (
          <li key={id} aria-current={status?.currentStep === id ? "step" : undefined}>
            {label}
          </li>
        ))}
      </ol>
      {error ? <p role="alert">{error}</p> : null}

      {status?.currentStep === "admin" ? (
        <Card>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api("/api/v1/setup/admin", {
                  method: "POST",
                  body: JSON.stringify({ email, password }),
                });
                await refreshStatus();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed");
              }
            }}
          >
            <Field label="Email">
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Password" hint="At least 12 characters.">
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={12}
                required
              />
            </Field>
            <p>
              <Button type="submit">Create administrator</Button>
            </p>
          </form>
        </Card>
      ) : null}

      {status?.currentStep === "security" || (codes.length > 0 && !savedCodes) ? (
        <Card>
          <Button
            onClick={async () => {
              try {
                const result = await api<{ otpauth: string }>("/api/v1/setup/totp/start", {
                  method: "POST",
                });
                setOtpauth(result.otpauth);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed");
              }
            }}
          >
            Generate authenticator secret
          </Button>
          {otpauth ? <p>Add this TOTP URL to your authenticator: {otpauth}</p> : null}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                const result = await api<{ recoveryCodes: string[] }>("/api/v1/setup/totp/verify", {
                  method: "POST",
                  body: JSON.stringify({ token: totp }),
                });
                setCodes(result.recoveryCodes);
                await refreshStatus();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed");
              }
            }}
          >
            <Field label="Authenticator code">
              <input
                id="authenticator-code"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                required
              />
            </Field>
            <p>
              <Button type="submit">Verify 2FA</Button>
            </p>
          </form>
          {codes.length > 0 ? (
            <aside>
              <h2>Recovery codes</h2>
              <p>Store these single-use codes before continuing. They will not be shown again.</p>
              <ul>
                {codes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <p>
                <Button
                  onClick={() => {
                    setSavedCodes(true);
                  }}
                >
                  I have saved these codes
                </Button>
              </p>
            </aside>
          ) : null}
        </Card>
      ) : null}

      {status?.currentStep === "llm" && (savedCodes || codes.length === 0) ? (
        <Card>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api("/api/v1/setup/llm", {
                  method: "POST",
                  body: JSON.stringify({ provider, baseUrl, model, apiKey }),
                });
                await refreshStatus();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed");
              }
            }}
          >
            <Field label="Provider">
              <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="openai_compatible">OpenAI-compatible</option>
                <option value="anthropic_compatible">Anthropic-compatible</option>
              </select>
            </Field>
            <Field label="Base URL">
              <input
                id="base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
              />
            </Field>
            <Field label="Model">
              <input id="model" value={model} onChange={(e) => setModel(e.target.value)} required />
            </Field>
            <Field label="API key" hint="Stored encrypted. Never shown again.">
              <input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
              />
            </Field>
            <p>
              <Button type="submit">Save provider</Button>
            </p>
          </form>
        </Card>
      ) : null}

      {status?.currentStep === "domains_sources" ? (
        <Card>
          <h2>What should Riddlr monitor?</h2>
          <p>
            Selecting Crypto activates the default Intelligence Agent. Other domains cannot be
            enabled yet.
          </p>
          <div>
            {(status.domains ?? []).map((domain) => (
              <label
                key={domain.id}
                style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}
              >
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
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
            />
          </Field>
          <Field label="Telegram chat ID">
            <input
              id="telegram-chat-id"
              value={telegramChat}
              onChange={(e) => setTelegramChat(e.target.value)}
            />
          </Field>
          <p>
            <Button
              onClick={async () => {
                try {
                  await api("/api/v1/setup/complete", {
                    method: "POST",
                    body: JSON.stringify({
                      marketDomainIds: ["crypto"],
                      telegramBotToken: telegramToken || undefined,
                      telegramChatId: telegramChat || undefined,
                    }),
                  });
                  window.location.assign("/");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed");
                }
              }}
            >
              Finish setup
            </Button>
          </p>
        </Card>
      ) : null}
    </main>
  );
}
export { SetupPage };
