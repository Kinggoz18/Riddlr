import { Button, Card, EmptyState, Field } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { api, CLIENT_LIST_CAP, takeBoundedClient } from "../api.js";

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
  const [message, setMessage] = useState<string>();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [rotatePassword, setRotatePassword] = useState("");
  const [rotateTotp, setRotateTotp] = useState("");
  const [minRisk, setMinRisk] = useState("moderate");
  const [cooldownMinutes, setCooldownMinutes] = useState("30");
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
      <h1>Settings</h1>
      <p>LLM: {data?.llmConfigured ? "configured" : "missing"}</p>
      <p>Telegram: {data?.telegramConfigured ? "configured" : "not configured"}</p>
      <p>WhatsApp: {data?.whatsappConfigured ? "configured" : "not configured"}</p>
      <p>
        Encryption: {data?.encryption.alg} · Key version {data?.encryption.keyVersion}
        {data?.encryption.previousKeyConfigured ? " · previous key configured" : ""}
      </p>
      {data?.sessionPolicy ? (
        <p>
          Sessions expire after {data.sessionPolicy.absoluteHours} hours, idle{" "}
          {data.sessionPolicy.idleMinutes} minutes, max {data.sessionPolicy.maxSessions} devices.
        </p>
      ) : null}
      {message ? <output>{message}</output> : null}

      <Card>
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
                }),
              });
              await refresh();
              setMessage("Notification policy saved.");
            } catch (err) {
              setMessage(err instanceof Error ? err.message : "Failed");
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
          <Button type="submit">Save notification policy</Button>
        </form>
      </Card>

      <Card>
        <h2>WhatsApp Cloud API</h2>
        <p style={{ color: "var(--muted)" }}>
          Official Graph API only. Session text requires an inbound message in the last 24 hours.
          Otherwise Riddlr sends an approved template. Configure the webhook at
          /api/v1/webhooks/whatsapp.
        </p>
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
              setMessage("WhatsApp Cloud API saved. The access token is not shown again.");
            } catch (err) {
              setMessage(err instanceof Error ? err.message : "Failed");
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

      <Card>
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
                        setMessage("Session revoked.");
                      } catch (err) {
                        setMessage(err instanceof Error ? err.message : "Failed");
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
              setMessage("Other sessions signed out.");
            } catch (err) {
              setMessage(err instanceof Error ? err.message : "Failed");
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
            <ul>
              {recoveryCodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
            <Button onClick={() => setSavedCodes(true)}>I have saved these codes</Button>
          </>
        ) : (
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
                setMessage("New recovery codes generated.");
              } catch (err) {
                setMessage(err instanceof Error ? err.message : "Failed");
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
                setMessage(err instanceof Error ? err.message : "Failed");
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
              const body = await api<{ keyVersion: number }>("/api/v1/settings/encryption/rotate", {
                method: "POST",
                body: JSON.stringify({ currentPassword: rotatePassword, token: rotateTotp }),
              });
              setRotatePassword("");
              setRotateTotp("");
              await refresh();
              setMessage(`Encryption key version is now ${body.keyVersion}.`);
            } catch (err) {
              setMessage(err instanceof Error ? err.message : "Failed");
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
          <Field label="Authenticator code for key rotation">
            <input
              id="authenticator-code-for-key-rotation"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={rotateTotp}
              onChange={(e) => setRotateTotp(e.target.value)}
              required
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
              setMessage("Password updated. Other sessions were signed out.");
            } catch (err) {
              setMessage(err instanceof Error ? err.message : "Failed");
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
