import { Button, Card, EmptyState, Field, PageHeader, StatusBadge } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api, CLIENT_LIST_CAP, takeBoundedClient } from "../api.js";
import { toastFail, useToast } from "../Toast.js";
import { TotpEnroll } from "../TotpEnroll.js";

type SessionRow = {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
};

type AuditRow = {
  id: string;
  action: string;
  resource: string | null;
  createdAt: string;
};

function SettingsPage() {
  const [data, setData] = useState<{
    llmConfigured: boolean;
    telegramConfigured: boolean;
    whatsappConfigured?: boolean;
    notificationPolicy?: {
      minRisk: string;
      cooldownMinutes: number;
      quietHours?: { startHour: number; endHour: number };
    };
    totpEnabled?: boolean;
    encryption: { alg: string; keyVersion: number; previousKeyConfigured: boolean };
    sessionPolicy?: { absoluteHours: number; idleMinutes: number; maxSessions: number };
  }>();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [remaining, setRemaining] = useState<number>();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedCodes, setSavedCodes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [otpauth, setOtpauth] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [rotatePassword, setRotatePassword] = useState("");
  const [rotateTotp, setRotateTotp] = useState("");
  const [minRisk, setMinRisk] = useState("moderate");
  const [cooldownMinutes, setCooldownMinutes] = useState("30");
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [llmProvider, setLlmProvider] = useState("openai_compatible");
  const [llmBaseUrl, setLlmBaseUrl] = useState("https://api.openai.com");
  const [llmModel, setLlmModel] = useState("gpt-4.1-mini");
  const [llmKey, setLlmKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [whatsappTo, setWhatsappTo] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateLanguage, setTemplateLanguage] = useState("en_US");
  const [verifyToken, setVerifyToken] = useState("");

  async function refresh() {
    const [settings, sessionBody, recovery, auditBody] = await Promise.all([
      api<NonNullable<typeof data>>("/api/v1/settings"),
      api<{ sessions: SessionRow[] }>("/api/v1/sessions"),
      api<{ remaining: number }>("/api/v1/auth/recovery"),
      api<{ audit: AuditRow[] }>("/api/v1/audit?limit=20"),
    ]);
    setData(settings);
    setSessions(sessionBody.sessions);
    setRemaining(recovery.remaining);
    setAudit(auditBody.audit);
    setAuditHasMore(auditBody.audit.length === 20);
    if (settings.notificationPolicy) {
      setMinRisk(settings.notificationPolicy.minRisk);
      setCooldownMinutes(String(settings.notificationPolicy.cooldownMinutes));
      setQuietStart(
        settings.notificationPolicy.quietHours
          ? String(settings.notificationPolicy.quietHours.startHour)
          : "",
      );
      setQuietEnd(
        settings.notificationPolicy.quietHours
          ? String(settings.notificationPolicy.quietHours.endHour)
          : "",
      );
    }
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p>Loading settings…</p>;
  }
  if (error) {
    return <EmptyState title="Unable to load settings" body={error} />;
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Model, notification policy, sessions, and encryption. Secrets are stored encrypted and never shown again."
      />
      <nav className="page-subnav" aria-label="Settings">
        <a href="#settings-model">Model</a>
        <a href="#settings-security">Security</a>
        <a href="#settings-notifications">Notifications</a>
        <a href="#settings-sessions">Sessions</a>
      </nav>
      <section className="config-strip" aria-label="Configuration status">
        <span>
          Model
          <StatusBadge label={data?.llmConfigured ? "Connected" : "Missing"} />
        </span>
        <span>
          Telegram
          <StatusBadge label={data?.telegramConfigured ? "Connected" : "Off"} />
        </span>
        <span>
          WhatsApp
          <StatusBadge label={data?.whatsappConfigured ? "Connected" : "Off"} />
        </span>
        <span>
          Authenticator
          <StatusBadge label={data?.totpEnabled ? "On" : "Off"} />
        </span>
        <span>
          Encryption
          <StatusBadge label={`Key ${data?.encryption.keyVersion ?? 1}`} />
        </span>
      </section>

      <Card id="settings-model">
        <h2>Model</h2>
        <p className="field-note">
          {data?.llmConfigured
            ? "A provider is connected. Saving a new key replaces it."
            : "Required for analysis. Scans still collect evidence without a model."}
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/settings/llm", {
                method: "POST",
                body: JSON.stringify({
                  provider: llmProvider,
                  baseUrl: llmBaseUrl,
                  model: llmModel,
                  apiKey: llmKey,
                }),
              });
              setLlmKey("");
              await refresh();
              toast("Model saved");
            } catch (err) {
              toast(toastFail(err, "Couldn’t save model"), "danger");
            }
          }}
        >
          <Field label="Provider">
            <select
              id="settings-provider"
              value={llmProvider}
              onChange={(e) => setLlmProvider(e.target.value)}
            >
              <option value="openai_compatible">OpenAI-compatible</option>
              <option value="anthropic_compatible">Anthropic-compatible</option>
            </select>
          </Field>
          <Field label="Base URL">
            <input
              id="settings-base-url"
              type="url"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              required
            />
          </Field>
          <Field label="Model">
            <input
              id="settings-model"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              required
            />
          </Field>
          <Field label="API key" hint="Stored encrypted. Never shown again.">
            <input
              id="settings-api-key"
              type="password"
              autoComplete="off"
              value={llmKey}
              onChange={(e) => setLlmKey(e.target.value)}
              required
            />
          </Field>
          <Button type="submit">Save provider</Button>
        </form>
      </Card>

      <Card id="settings-security">
        <h2>Authenticator</h2>
        {data?.totpEnabled ? (
          <StatusBadge label="Enabled" />
        ) : otpauth && secret ? (
          <TotpEnroll
            otpauth={otpauth}
            secret={secret}
            token={totp}
            onToken={setTotp}
            busy={enrollBusy}
            onVerify={async () => {
              setEnrollBusy(true);
              try {
                const body = await api<{ recoveryCodes: string[] }>(
                  "/api/v1/settings/totp/verify",
                  {
                    method: "POST",
                    body: JSON.stringify({ token: totp }),
                  },
                );
                setRecoveryCodes(body.recoveryCodes);
                setSavedCodes(false);
                setTotp("");
                setOtpauth(undefined);
                setSecret(undefined);
                await refresh();
                toast("Authenticator on");
              } catch (err) {
                toast(toastFail(err, "Couldn’t verify code"), "danger");
              } finally {
                setEnrollBusy(false);
              }
            }}
          />
        ) : (
          <p className="ui-actions">
            <Button
              onClick={async () => {
                try {
                  const result = await api<{ otpauth: string; secret: string }>(
                    "/api/v1/settings/totp/start",
                    { method: "POST" },
                  );
                  setOtpauth(result.otpauth);
                  setSecret(result.secret);
                } catch (err) {
                  toast(toastFail(err, "Couldn’t start setup"), "danger");
                }
              }}
            >
              Set up authenticator
            </Button>
          </p>
        )}
      </Card>

      <Card id="settings-notifications">
        <h2>Notification policy</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/settings/notifications", {
                method: "POST",
                body: JSON.stringify({
                  minRisk,
                  cooldownMinutes: Number(cooldownMinutes),
                  quietHours:
                    quietStart !== "" && quietEnd !== ""
                      ? { startHour: Number(quietStart), endHour: Number(quietEnd) }
                      : undefined,
                }),
              });
              await refresh();
              toast("Saved");
            } catch (err) {
              toast(toastFail(err, "Couldn’t save"), "danger");
            }
          }}
        >
          <Field label="Minimum risk">
            <select id="minimum-risk" value={minRisk} onChange={(e) => setMinRisk(e.target.value)}>
              <option value="low">low</option>
              <option value="moderate">moderate</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
          </Field>
          <Field label="Cooldown minutes">
            <input
              id="cooldown-minutes"
              type="number"
              min={0}
              max={1440}
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(e.target.value)}
            />
          </Field>
          <Field label="Quiet hours start" hint="Optional 0–23. Leave blank for no quiet hours.">
            <input
              id="quiet-hours-start"
              type="number"
              min={0}
              max={23}
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
            />
          </Field>
          <Field label="Quiet hours end">
            <input
              id="quiet-hours-end"
              type="number"
              min={0}
              max={23}
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
            />
          </Field>
          <Button type="submit">Save notification policy</Button>
        </form>
      </Card>

      <Card>
        <h2>WhatsApp Cloud API</h2>
        <code>/api/v1/webhooks/whatsapp</code>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/settings/whatsapp", {
                method: "POST",
                body: JSON.stringify({
                  accessToken,
                  phoneNumberId,
                  to: whatsappTo,
                  templateName,
                  templateLanguage,
                  verifyToken,
                }),
              });
              setAccessToken("");
              setVerifyToken("");
              await refresh();
              toast("WhatsApp saved");
            } catch (err) {
              toast(toastFail(err, "Couldn’t save WhatsApp"), "danger");
            }
          }}
        >
          <Field label="Access token">
            <input
              id="access-token"
              type="password"
              autoComplete="off"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              required
            />
          </Field>
          <Field label="Phone number id">
            <input
              id="phone-number-id"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              required
            />
          </Field>
          <Field label="Destination number">
            <input
              id="destination-number"
              value={whatsappTo}
              onChange={(e) => setWhatsappTo(e.target.value)}
              required
            />
          </Field>
          <Field label="Template name">
            <input
              id="template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              required
            />
          </Field>
          <Field label="Template language">
            <input
              id="template-language"
              value={templateLanguage}
              onChange={(e) => setTemplateLanguage(e.target.value)}
              required
            />
          </Field>
          <Field label="Webhook verify token">
            <input
              id="webhook-verify-token"
              type="password"
              autoComplete="off"
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              required
            />
          </Field>
          <Button type="submit">Save WhatsApp settings</Button>
        </form>
      </Card>

      <Card id="settings-sessions">
        <h2>Sessions</h2>
        {sessions.length === 0 ? (
          <EmptyState title="No sessions" body="Sign in to create a session." />
        ) : (
          sessions.map((row) => (
            <p key={row.id}>
              {row.current ? "Current session" : "Other session"} · last seen{" "}
              {new Date(row.lastSeenAt).toLocaleString()}
              {row.ip ? ` · ${row.ip}` : ""}
              {row.current ? null : (
                <>
                  {" "}
                  <Button
                    onClick={async () => {
                      try {
                        await api(`/api/v1/sessions/${row.id}/revoke`, { method: "POST" });
                        await refresh();
                        toast("Session ended");
                      } catch (err) {
                        toast(toastFail(err, "Couldn’t end session"), "danger");
                      }
                    }}
                  >
                    Revoke
                  </Button>
                </>
              )}
            </p>
          ))
        )}
        <Button
          onClick={async () => {
            try {
              await api("/api/v1/sessions/revoke-others", { method: "POST" });
              await refresh();
              toast("Signed out elsewhere");
            } catch (err) {
              toast(toastFail(err, "Couldn’t sign out other sessions"), "danger");
            }
          }}
        >
          Sign out other sessions
        </Button>
      </Card>

      <Card>
        <h2>Recovery codes</h2>
        <p>{remaining ?? 0} remaining</p>
        {recoveryCodes.length > 0 && !savedCodes ? (
          <>
            <p>Save these codes now. They are shown once.</p>
            <ul className="recovery-codes">
              {recoveryCodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
            <Button onClick={() => setSavedCodes(true)}>I have saved these codes</Button>
          </>
        ) : data?.totpEnabled ? (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                const body = await api<{ recoveryCodes: string[] }>(
                  "/api/v1/auth/recovery/rotate",
                  {
                    method: "POST",
                    body: JSON.stringify({ token: totp }),
                  },
                );
                setRecoveryCodes(body.recoveryCodes);
                setSavedCodes(false);
                setTotp("");
                await refresh();
                toast("New recovery codes");
              } catch (err) {
                toast(toastFail(err, "Couldn’t regenerate codes"), "danger");
              }
            }}
          >
            <Field label="Authenticator code to regenerate recovery codes">
              <input
                id="authenticator-code-to-regenerate-recovery-codes"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                required
              />
            </Field>
            <Button type="submit">Regenerate recovery codes</Button>
          </form>
        ) : (
          <p className="field-note">Enable authenticator to generate recovery codes.</p>
        )}
      </Card>

      <Card>
        <h2>Audit log</h2>
        {audit.length === 0 ? (
          <EmptyState
            title="No audit events yet"
            body="Security actions appear here after they run."
          />
        ) : (
          audit.map((row) => (
            <p key={row.id}>
              {new Date(row.createdAt).toLocaleString()} · {row.action}
              {row.resource ? ` · ${row.resource}` : ""}
            </p>
          ))
        )}
        {auditHasMore && audit.length < CLIENT_LIST_CAP ? (
          <Button
            onClick={async () => {
              const last = audit.at(-1);
              if (!last) {
                return;
              }
              try {
                const body = await api<{ audit: AuditRow[] }>(
                  `/api/v1/audit?limit=20&before=${encodeURIComponent(last.createdAt)}`,
                );
                setAudit((current) => takeBoundedClient(current, body.audit));
                setAuditHasMore(body.audit.length === 20);
              } catch (err) {
                toast(toastFail(err, "Couldn’t load audit log"), "danger");
              }
            }}
          >
            Load older
          </Button>
        ) : null}
      </Card>

      <Card>
        <h2>Encryption</h2>
        <p>
          Re-encrypt stored credentials with the current master key and increment the key version.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/settings/encryption/rotate", {
                method: "POST",
                body: JSON.stringify({
                  currentPassword: rotatePassword,
                  token: rotateTotp || undefined,
                }),
              });
              setRotatePassword("");
              setRotateTotp("");
              await refresh();
              toast("Key rotated");
            } catch (err) {
              toast(toastFail(err, "Couldn’t rotate key"), "danger");
            }
          }}
        >
          <Field label="Password for key rotation">
            <input
              id="password-for-key-rotation"
              type="password"
              value={rotatePassword}
              onChange={(e) => setRotatePassword(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Authenticator code for key rotation"
            hint={data?.totpEnabled ? undefined : "Not required until authenticator is enabled."}
          >
            <input
              id="authenticator-code-for-key-rotation"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={rotateTotp}
              onChange={(e) => setRotateTotp(e.target.value)}
              required={Boolean(data?.totpEnabled)}
            />
          </Field>
          <Button type="submit">Rotate encryption keys</Button>
        </form>
      </Card>

      <Card>
        <h2>Change password</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/auth/password", {
                method: "POST",
                body: JSON.stringify({ currentPassword, newPassword }),
              });
              setCurrentPassword("");
              setNewPassword("");
              await refresh();
              toast("Password updated");
            } catch (err) {
              toast(toastFail(err, "Couldn’t update password"), "danger");
            }
          }}
        >
          <Field label="Current password">
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </Field>
          <Field label="New password">
            <input
              id="new-password"
              type="password"
              minLength={12}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit">Update password</Button>
        </form>
      </Card>
    </>
  );
}
export { SettingsPage };
