import { llmStructuredOutputNotes } from "@riddlr/domain/web";
import {
  Banner,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  StatusBadge,
} from "@riddlr/ui";
import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api, CLIENT_LIST_CAP, takeBoundedClient } from "../api.js";
import {
  auditActionLabel,
  auditResourceLabel,
  dateTime,
  editClockHour,
  formatClockHour,
  parseClockHour,
} from "../format.js";
import { PageSubnav } from "../PageSubnav.js";
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

function SettingsSubnav() {
  return (
    <PageSubnav
      label="Settings"
      items={[
        { to: "/settings", label: "Model", end: true },
        { to: "/settings/security", label: "Security" },
        { to: "/settings/notifications", label: "Notifications" },
        { to: "/settings/sessions", label: "Sessions" },
      ]}
    />
  );
}

function SettingsPage() {
  const [data, setData] = useState<{
    llmConfigured: boolean;
    llm?: {
      configured: boolean;
      provider?: string;
      baseUrl?: string;
      model?: string;
      structuredOutputWarning?: string;
    };
    telegramConfigured: boolean;
    whatsappConfigured?: boolean;
    notificationTargets?: Array<{
      id: string;
      channel: string;
      destination: string;
      name?: string | null;
      isPrimary: boolean;
      status: string;
    }>;
    observationAlertRules?: Array<{
      id: string;
      metric: string;
      op: string;
      threshold: number;
      windowMinutes?: number | null;
      subjectCanonicalId?: string | null;
      provider?: string | null;
      targetIds: string[];
      enabled: boolean;
    }>;
    notificationPolicy?: {
      minRisk: string;
      cooldownMinutes: number;
      quietHours?: { startHour: number; endHour: number };
      earlyWarnings?: boolean;
      shadowAssessments?: boolean;
    };
    totpEnabled?: boolean;
    email?: {
      configured: boolean;
      transport: "resend" | "smtp" | "none";
      from: string;
      resendSaved?: boolean;
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
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [otpauth, setOtpauth] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [rotatePassword, setRotatePassword] = useState("");
  const [rotateTotp, setRotateTotp] = useState("");
  const [minRisk, setMinRisk] = useState("moderate");
  const [cooldownMinutes, setCooldownMinutes] = useState("30");
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [earlyWarnings, setEarlyWarnings] = useState(false);
  const [shadowAssessments, setShadowAssessments] = useState(false);
  const [llmProvider, setLlmProvider] = useState("openai_compatible");
  const [llmBaseUrl, setLlmBaseUrl] = useState("https://api.openai.com");
  const [llmModel, setLlmModel] = useState("gpt-4.1-mini");
  const [llmKey, setLlmKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [whatsappTo, setWhatsappTo] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateLanguage, setTemplateLanguage] = useState("en_US");
  const [verifyToken, setVerifyToken] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChat, setTelegramChat] = useState("");
  const [discordWebhook, setDiscordWebhook] = useState("");
  const [discordUsername, setDiscordUsername] = useState("");
  const [discordAvatar, setDiscordAvatar] = useState("");
  const [discordPrimary, setDiscordPrimary] = useState(false);
  const [alertMetric, setAlertMetric] = useState("spot_price");
  const [alertOp, setAlertOp] = useState("gte");
  const [alertThreshold, setAlertThreshold] = useState("");
  const [alertWindow, setAlertWindow] = useState("1440");
  const [alertSubject, setAlertSubject] = useState("");
  const [resendKey, setResendKey] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [confirmClearAudit, setConfirmClearAudit] = useState(false);

  async function refresh() {
    const [settings, sessionBody, recovery, auditBody] = await Promise.all([
      api<NonNullable<typeof data>>("/api/v1/settings"),
      api<{ sessions: SessionRow[] }>("/api/v1/sessions"),
      api<{ remaining: number }>("/api/v1/auth/recovery"),
      api<{ audit: AuditRow[] }>("/api/v1/audit?limit=20"),
    ]);
    setData(settings);
    if (settings.llm?.configured) {
      if (settings.llm.provider) {
        setLlmProvider(settings.llm.provider);
      }
      if (settings.llm.baseUrl) {
        setLlmBaseUrl(settings.llm.baseUrl);
      }
      if (settings.llm.model) {
        setLlmModel(settings.llm.model);
      }
    }
    setSessions(sessionBody.sessions);
    setRemaining(recovery.remaining);
    setAudit(auditBody.audit);
    setAuditHasMore(auditBody.audit.length === 20);
    if (settings.notificationPolicy) {
      setMinRisk(settings.notificationPolicy.minRisk);
      setCooldownMinutes(String(settings.notificationPolicy.cooldownMinutes));
      setQuietStart(
        settings.notificationPolicy.quietHours
          ? formatClockHour(String(settings.notificationPolicy.quietHours.startHour))
          : "",
      );
      setQuietEnd(
        settings.notificationPolicy.quietHours
          ? formatClockHour(String(settings.notificationPolicy.quietHours.endHour))
          : "",
      );
      setEarlyWarnings(Boolean(settings.notificationPolicy.earlyWarnings));
      setShadowAssessments(Boolean(settings.notificationPolicy.shadowAssessments));
    }
    if (settings.email?.from) {
      setEmailFrom(settings.email.from);
    }
  }

  async function persist(ok: string, fail: string, action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      if (ok) {
        toast(ok);
      }
      await refresh().catch(() => undefined);
    } catch (err) {
      toast(toastFail(err, fail), "danger");
    } finally {
      setBusy(false);
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

  const llmNotes = llmStructuredOutputNotes({
    provider: llmProvider,
    baseUrl: llmBaseUrl,
    model: llmModel,
  });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Model, security, notifications, and sessions. Secrets are stored encrypted and never shown again."
      />
      <SettingsSubnav />
      <section className="config-strip" aria-label="Configuration status">
        <span className={data?.llmConfigured ? "config-chip-ok" : "config-chip-off"}>
          Model
          <StatusBadge
            label={data?.llmConfigured ? "Connected" : "Missing"}
            tone={data?.llmConfigured ? "ok" : "danger"}
          />
        </span>
        <span className={data?.telegramConfigured ? "config-chip-ok" : "config-chip-off"}>
          Telegram
          <StatusBadge
            label={data?.telegramConfigured ? "Connected" : "Off"}
            tone={data?.telegramConfigured ? "ok" : "danger"}
          />
        </span>
        <span className={data?.whatsappConfigured ? "config-chip-ok" : "config-chip-off"}>
          WhatsApp
          <StatusBadge
            label={data?.whatsappConfigured ? "Connected" : "Off"}
            tone={data?.whatsappConfigured ? "ok" : "danger"}
          />
        </span>
        <span className={data?.totpEnabled ? "config-chip-ok" : "config-chip-off"}>
          Authenticator
          <StatusBadge
            label={data?.totpEnabled ? "On" : "Off"}
            tone={data?.totpEnabled ? "ok" : "danger"}
          />
        </span>
        <span>
          Encryption
          <StatusBadge label={`Key ${data?.encryption.keyVersion ?? 1}`} />
        </span>
      </section>

      <Routes>
        <Route
          index
          element={
            <Card id="settings-model">
              <h2>Model</h2>
              <p className="field-note">
                {data?.llmConfigured
                  ? "A provider is connected. Provider, base URL, and model are shown. The API key is never returned. Saving a new key replaces it."
                  : "Required for analysis. Scans still collect evidence without a model."}
              </p>
              {llmNotes.map((note) => (
                <Banner key={note.message} tone={note.tone}>
                  {note.message}
                </Banner>
              ))}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void persist("Model saved", "Couldn’t save model", async () => {
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
                  });
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
                <Field
                  label="Base URL"
                  hint="https://api.openai.com, https://openrouter.ai/api/v1, or the full /chat/completions URL."
                >
                  <input
                    id="settings-base-url"
                    type="url"
                    value={llmBaseUrl}
                    onChange={(e) => setLlmBaseUrl(e.target.value)}
                    required
                  />
                </Field>
                <Field
                  label="Model"
                  hint="Structured claim extraction needs gpt-4.1-mini or Claude Sonnet class. 8B-class models are not sufficient."
                >
                  <input
                    id="settings-model"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    required
                  />
                </Field>
                <Field
                  label="API key"
                  hint="Stored encrypted. Never shown again. Riddlr checks that the model answers before saving."
                >
                  <input
                    id="settings-api-key"
                    type="password"
                    autoComplete="new-password"
                    value={llmKey}
                    onChange={(e) => setLlmKey(e.target.value)}
                    required
                  />
                </Field>
                <Button type="submit" busy={busy}>
                  Save provider
                </Button>
              </form>
            </Card>
          }
        />
        <Route
          path="security"
          element={
            <>
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
                    busy={busy}
                    onVerify={() => {
                      void persist("Authenticator on", "Couldn’t verify code", async () => {
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
                      });
                    }}
                  />
                ) : (
                  <p className="ui-actions">
                    <Button
                      busy={busy}
                      onClick={() => {
                        void persist("", "Couldn’t start setup", async () => {
                          const result = await api<{ otpauth: string; secret: string }>(
                            "/api/v1/settings/totp/start",
                            { method: "POST" },
                          );
                          setOtpauth(result.otpauth);
                          setSecret(result.secret);
                        });
                      }}
                    >
                      Set up authenticator
                    </Button>
                  </p>
                )}
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
                    onSubmit={(event) => {
                      event.preventDefault();
                      void persist("New recovery codes", "Couldn’t regenerate codes", async () => {
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
                      });
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
                    <Button type="submit" busy={busy}>
                      Regenerate recovery codes
                    </Button>
                  </form>
                ) : (
                  <p className="field-note">Enable authenticator to generate recovery codes.</p>
                )}
              </Card>

              <Card>
                <h2>Encryption</h2>
                <p>
                  Re-encrypt stored credentials with the current master key and increment the key
                  version.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void persist("Key rotated", "Couldn’t rotate key", async () => {
                      await api("/api/v1/settings/encryption/rotate", {
                        method: "POST",
                        body: JSON.stringify({
                          currentPassword: rotatePassword,
                          token: rotateTotp || undefined,
                        }),
                      });
                      setRotatePassword("");
                      setRotateTotp("");
                    });
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
                    hint={
                      data?.totpEnabled ? undefined : "Not required until authenticator is enabled."
                    }
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
                  <Button type="submit" busy={busy}>
                    Rotate encryption keys
                  </Button>
                </form>
              </Card>

              <Card>
                <h2>Change password</h2>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void persist("Password updated", "Couldn’t update password", async () => {
                      await api("/api/v1/auth/password", {
                        method: "POST",
                        body: JSON.stringify({ currentPassword, newPassword }),
                      });
                      setCurrentPassword("");
                      setNewPassword("");
                    });
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
                  <Button type="submit" busy={busy}>
                    Update password
                  </Button>
                </form>
              </Card>

              <Card>
                <h2>Email</h2>
                <p className="field-note">
                  Password reset and security mail. Local Compose uses Mailpit at /mailpit. A public
                  instance needs Resend here or RIDDLR_RESEND_API_KEY. Configure this while you can
                  still sign in. Authenticator recovery codes work without email. If both are
                  missing, print a reset link on the host with{" "}
                  <code>
                    docker compose exec -T api node apps/server/dist/cmd/reset-password.js
                  </code>
                  .
                </p>
                {data?.email?.configured ? (
                  <StatusBadge
                    label={
                      data.email.transport === "smtp"
                        ? "SMTP / Mailpit"
                        : data.email.transport === "resend"
                          ? "Resend"
                          : "Connected"
                    }
                  />
                ) : (
                  <StatusBadge label="Not configured" tone="danger" />
                )}
                <form
                  autoComplete="off"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void persist("Email saved", "Couldn’t save email", async () => {
                      await api("/api/v1/settings/email", {
                        method: "POST",
                        body: JSON.stringify({ apiKey: resendKey, from: emailFrom }),
                      });
                      setResendKey("");
                    });
                  }}
                >
                  <Field
                    label="Resend API key"
                    hint="Stored encrypted. Never shown again. Replaces the previous key."
                  >
                    <input
                      id="resend-api-key"
                      name="resend-api-key"
                      type="password"
                      autoComplete="new-password"
                      value={resendKey}
                      onChange={(e) => setResendKey(e.target.value)}
                      required
                    />
                  </Field>
                  <Field
                    label="From address"
                    hint="A verified Resend sender, for example Riddlr <alerts@example.com>."
                  >
                    <input
                      id="resend-from-address"
                      name="resend-from-address"
                      autoComplete="off"
                      value={emailFrom}
                      onChange={(e) => setEmailFrom(e.target.value)}
                      required
                    />
                  </Field>
                  <p className="ui-actions">
                    <Button type="submit" busy={busy}>
                      Save Resend
                    </Button>
                    {data?.email?.resendSaved ? (
                      <Button
                        variant="ghost"
                        busy={busy}
                        onClick={() => {
                          void persist("Resend removed", "Couldn’t remove Resend", async () => {
                            await api("/api/v1/settings/email", { method: "DELETE" });
                            setResendKey("");
                          });
                        }}
                      >
                        Remove Resend
                      </Button>
                    ) : null}
                  </p>
                </form>
              </Card>
            </>
          }
        />
        <Route
          path="notifications"
          element={
            <>
              <Card id="settings-notifications">
                <h2>Notification policy</h2>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void persist("Saved", "Couldn’t save", async () => {
                      await api("/api/v1/settings/notifications", {
                        method: "POST",
                        body: JSON.stringify({
                          minRisk,
                          cooldownMinutes: Number(cooldownMinutes),
                          quietHours: (() => {
                            const startHour = parseClockHour(quietStart);
                            const endHour = parseClockHour(quietEnd);
                            return startHour !== undefined && endHour !== undefined
                              ? { startHour, endHour }
                              : undefined;
                          })(),
                          earlyWarnings,
                          shadowAssessments,
                        }),
                      });
                    });
                  }}
                >
                  <Field label="Minimum risk">
                    <select
                      id="minimum-risk"
                      value={minRisk}
                      onChange={(e) => setMinRisk(e.target.value)}
                    >
                      <option value="low">low</option>
                      <option value="moderate">moderate</option>
                      <option value="high">high</option>
                      <option value="critical">critical</option>
                    </select>
                  </Field>
                  <Field
                    label="Cooldown minutes"
                    hint="Minimum wait before another delivery to the same destination."
                  >
                    <input
                      id="cooldown-minutes"
                      type="number"
                      min={0}
                      max={1440}
                      value={cooldownMinutes}
                      onChange={(e) => setCooldownMinutes(e.target.value)}
                    />
                  </Field>
                  <div className="quiet-hours">
                    <Field
                      label="Quiet hours start"
                      hint="24-hour clock, for example 22:00. Leave both empty to always allow delivery."
                    >
                      <input
                        id="quiet-hours-start"
                        inputMode="numeric"
                        placeholder="22:00"
                        autoComplete="off"
                        value={quietStart}
                        onChange={(e) => setQuietStart(editClockHour(e.target.value))}
                        onBlur={() => setQuietStart(formatClockHour(quietStart))}
                      />
                    </Field>
                    <Field
                      label="Quiet hours end"
                      hint="24-hour clock, for example 07:00. 22:00–07:00 is overnight."
                    >
                      <input
                        id="quiet-hours-end"
                        inputMode="numeric"
                        placeholder="07:00"
                        autoComplete="off"
                        value={quietEnd}
                        onChange={(e) => setQuietEnd(editClockHour(e.target.value))}
                        onBlur={() => setQuietEnd(formatClockHour(quietEnd))}
                      />
                    </Field>
                  </div>
                  <label className="check-row" htmlFor="early-warnings">
                    <input
                      id="early-warnings"
                      type="checkbox"
                      checked={earlyWarnings}
                      onChange={(e) => setEarlyWarnings(e.target.checked)}
                    />
                    Unverified early warnings
                  </label>
                  <p className="field-note">
                    Notify high-impact operator-trusted firsthand reports before independent
                    corroboration. They stay labelled unverified.
                  </p>
                  <label className="check-row" htmlFor="shadow-assessments">
                    <input
                      id="shadow-assessments"
                      type="checkbox"
                      checked={shadowAssessments}
                      onChange={(e) => setShadowAssessments(e.target.checked)}
                    />
                    Shadow assessments
                  </label>
                  <p className="field-note">
                    Persist reliability and impact without sending notifications. Use this while
                    comparing the new corroboration path.
                  </p>
                  <Button type="submit" busy={busy}>
                    Save notification policy
                  </Button>
                </form>
              </Card>

              <Card>
                <h2>Telegram</h2>
                <p className="field-note">
                  A bot token from BotFather and the chat ID that should receive signals. This is a
                  notification channel, not a source. Stored encrypted and never shown again.
                </p>
                {data?.telegramConfigured ? <StatusBadge label="Connected" /> : null}
                <form
                  autoComplete="off"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void persist("Telegram saved", "Couldn’t save Telegram", async () => {
                      await api("/api/v1/settings/telegram", {
                        method: "POST",
                        body: JSON.stringify({
                          botToken: telegramToken,
                          chatId: telegramChat,
                        }),
                      });
                      setTelegramToken("");
                    });
                  }}
                >
                  <Field
                    label="Bot token"
                    hint="From @BotFather. Stored encrypted. Never shown again."
                  >
                    <input
                      id="telegram-bot-token"
                      name="telegram-bot-token"
                      type="password"
                      autoComplete="new-password"
                      value={telegramToken}
                      onChange={(e) => setTelegramToken(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Chat ID" hint="The destination chat, group, or channel numeric ID.">
                    <input
                      id="telegram-chat-id"
                      name="telegram-chat-id"
                      autoComplete="off"
                      value={telegramChat}
                      onChange={(e) => setTelegramChat(e.target.value)}
                      required
                    />
                  </Field>
                  <p className="ui-actions">
                    <Button type="submit" busy={busy}>
                      Save Telegram
                    </Button>
                    {data?.telegramConfigured ? (
                      <Button
                        variant="ghost"
                        busy={busy}
                        onClick={() => {
                          void persist("Telegram removed", "Couldn’t remove Telegram", async () => {
                            await api("/api/v1/settings/telegram", { method: "DELETE" });
                            setTelegramToken("");
                            setTelegramChat("");
                          });
                        }}
                      >
                        Remove Telegram
                      </Button>
                    ) : null}
                  </p>
                </form>
              </Card>

              <Card>
                <h2>Discord webhook</h2>
                <p className="field-note">
                  Paste an incoming webhook URL from Channel settings → Integrations → Webhooks.
                  Riddlr stores it encrypted and shows only the channel id afterwards. Incoming
                  webhooks are a notification channel, not a source.
                </p>
                <form
                  autoComplete="off"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void persist(
                      "Discord webhook saved",
                      "Couldn’t save Discord webhook",
                      async () => {
                        await api("/api/v1/notification-targets", {
                          method: "POST",
                          body: JSON.stringify({
                            webhookUrl: discordWebhook,
                            username: discordUsername || undefined,
                            avatarUrl: discordAvatar || undefined,
                            primary: discordPrimary,
                          }),
                        });
                        setDiscordWebhook("");
                        setDiscordUsername("");
                        setDiscordAvatar("");
                        setDiscordPrimary(false);
                      },
                    );
                  }}
                >
                  <Field
                    label="Webhook URL"
                    hint="https://discord.com/api/webhooks/… Stored encrypted. Never shown again."
                  >
                    <input
                      id="discord-webhook-url"
                      name="discord-webhook-url"
                      type="password"
                      autoComplete="new-password"
                      value={discordWebhook}
                      onChange={(e) => setDiscordWebhook(e.target.value)}
                      required
                    />
                  </Field>
                  <Field
                    label="Username override"
                    hint="Optional. Display name on Discord messages."
                  >
                    <input
                      id="discord-webhook-username"
                      value={discordUsername}
                      onChange={(e) => setDiscordUsername(e.target.value)}
                    />
                  </Field>
                  <Field label="Avatar URL" hint="Optional HTTPS image URL.">
                    <input
                      id="discord-webhook-avatar"
                      value={discordAvatar}
                      onChange={(e) => setDiscordAvatar(e.target.value)}
                    />
                  </Field>
                  <label className="check-row" htmlFor="discord-webhook-primary">
                    <input
                      id="discord-webhook-primary"
                      type="checkbox"
                      checked={discordPrimary}
                      onChange={(e) => setDiscordPrimary(e.target.checked)}
                    />
                    Primary target
                  </label>
                  <Button type="submit" busy={busy}>
                    Save Discord webhook
                  </Button>
                </form>
                {(data?.notificationTargets ?? []).length > 0 ? (
                  <ul className="data-list">
                    {(data?.notificationTargets ?? []).map((target) => (
                      <li key={target.id}>
                        <span>
                          <strong>Channel {target.destination}</strong>
                          <small>
                            {target.status === "auth"
                              ? "Webhook deleted"
                              : target.name || "Discord"}
                            {target.isPrimary ? " · Primary" : ""}
                          </small>
                        </span>
                        <Button
                          variant="ghost"
                          busy={busy}
                          onClick={() => {
                            void persist(
                              "Discord webhook removed",
                              "Couldn’t remove webhook",
                              async () => {
                                await api(`/api/v1/notification-targets/${target.id}`, {
                                  method: "DELETE",
                                });
                              },
                            );
                          }}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>

              <Card>
                <h2>WhatsApp Cloud API</h2>
                <code>/api/v1/webhooks/whatsapp</code>
                <form
                  autoComplete="off"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void persist("WhatsApp saved", "Couldn’t save WhatsApp", async () => {
                      await api("/api/v1/settings/whatsapp", {
                        method: "POST",
                        body: JSON.stringify({
                          accessToken,
                          appSecret,
                          phoneNumberId,
                          to: whatsappTo,
                          templateName,
                          templateLanguage,
                          verifyToken,
                        }),
                      });
                      setAccessToken("");
                      setAppSecret("");
                      setVerifyToken("");
                    });
                  }}
                >
                  <Field
                    label="Access token"
                    hint="Meta Cloud API token. Stored encrypted. Never shown again."
                  >
                    <input
                      id="whatsapp-access-token"
                      name="whatsapp-access-token"
                      type="password"
                      autoComplete="new-password"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      required
                    />
                  </Field>
                  <Field
                    label="App secret"
                    hint="Used to verify webhook HMAC. Stored encrypted. Never shown again."
                  >
                    <input
                      id="whatsapp-app-secret"
                      name="whatsapp-app-secret"
                      type="password"
                      autoComplete="new-password"
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                      required
                    />
                  </Field>
                  <Field
                    label="Phone number ID"
                    hint="Numeric Cloud API phone-number ID, not a login email."
                  >
                    <input
                      id="whatsapp-phone-number-id"
                      name="whatsapp-phone-number-id"
                      inputMode="numeric"
                      autoComplete="off"
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Destination number" hint="E.164, for example +15551234567.">
                    <input
                      id="whatsapp-destination-number"
                      name="whatsapp-destination-number"
                      autoComplete="off"
                      value={whatsappTo}
                      onChange={(e) => setWhatsappTo(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Template name">
                    <input
                      id="whatsapp-template-name"
                      name="whatsapp-template-name"
                      autoComplete="off"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Template language">
                    <input
                      id="whatsapp-template-language"
                      name="whatsapp-template-language"
                      autoComplete="off"
                      value={templateLanguage}
                      onChange={(e) => setTemplateLanguage(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Webhook verify token">
                    <input
                      id="whatsapp-webhook-verify-token"
                      name="whatsapp-webhook-verify-token"
                      type="password"
                      autoComplete="new-password"
                      value={verifyToken}
                      onChange={(e) => setVerifyToken(e.target.value)}
                      required
                    />
                  </Field>
                  <Button type="submit" busy={busy}>
                    Save WhatsApp settings
                  </Button>
                </form>
              </Card>

              <Card>
                <h2>Observation alerts</h2>
                <p className="field-note">
                  Thresholds on observation series. Delivered as Observation, never as a signal.
                  Quiet hours and per-destination cooldown still apply. Minimum risk does not.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void persist(
                      "Observation alert saved",
                      "Couldn’t save observation alert",
                      async () => {
                        await api("/api/v1/observation-alert-rules", {
                          method: "POST",
                          body: JSON.stringify({
                            metric: alertMetric,
                            op: alertOp,
                            threshold: Number(alertThreshold),
                            windowMinutes:
                              alertOp === "pct_drop" || alertOp === "pct_move"
                                ? Number(alertWindow)
                                : undefined,
                            subjectCanonicalId: alertSubject || undefined,
                          }),
                        });
                        setAlertThreshold("");
                        setAlertSubject("");
                      },
                    );
                  }}
                >
                  <Field label="Metric">
                    <select
                      id="observation-alert-metric"
                      value={alertMetric}
                      onChange={(e) => setAlertMetric(e.target.value)}
                    >
                      <option value="spot_price">Spot price</option>
                      <option value="funding_rate_apr">Funding rate APR</option>
                      <option value="tvl_usd">TVL USD</option>
                      <option value="odds_yes">Prediction-market YES odds</option>
                    </select>
                  </Field>
                  <Field label="Operator">
                    <select
                      id="observation-alert-op"
                      value={alertOp}
                      onChange={(e) => setAlertOp(e.target.value)}
                    >
                      <option value="gte">At or above</option>
                      <option value="lte">At or below</option>
                      <option value="pct_drop">Percent drop</option>
                      <option value="pct_move">Percent move</option>
                    </select>
                  </Field>
                  <Field label="Threshold">
                    <input
                      id="observation-alert-threshold"
                      type="number"
                      step="any"
                      value={alertThreshold}
                      onChange={(e) => setAlertThreshold(e.target.value)}
                      required
                    />
                  </Field>
                  {alertOp === "pct_drop" || alertOp === "pct_move" ? (
                    <Field
                      label="Window minutes"
                      hint="Lookback for the percent change. Default 1440 (24h) for a drop."
                    >
                      <input
                        id="observation-alert-window"
                        type="number"
                        min={1}
                        max={10080}
                        value={alertWindow}
                        onChange={(e) => setAlertWindow(e.target.value)}
                        required
                      />
                    </Field>
                  ) : null}
                  <Field
                    label="Subject"
                    hint="Optional canonical id such as coingecko:bitcoin. Empty matches any subject."
                  >
                    <input
                      id="observation-alert-subject"
                      value={alertSubject}
                      onChange={(e) => setAlertSubject(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" busy={busy}>
                    Save observation alert
                  </Button>
                </form>
                {(data?.observationAlertRules ?? []).length > 0 ? (
                  <ul className="data-list">
                    {(data?.observationAlertRules ?? []).map((rule) => (
                      <li key={rule.id}>
                        <span>
                          <strong>
                            {rule.metric} {rule.op} {rule.threshold}
                          </strong>
                          <small>
                            {rule.subjectCanonicalId ?? "any subject"}
                            {rule.windowMinutes ? ` · ${rule.windowMinutes}m` : ""}
                          </small>
                        </span>
                        <Button
                          variant="ghost"
                          busy={busy}
                          onClick={() => {
                            void persist(
                              "Observation alert removed",
                              "Couldn’t remove alert",
                              async () => {
                                await api(`/api/v1/observation-alert-rules/${rule.id}`, {
                                  method: "DELETE",
                                });
                              },
                            );
                          }}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            </>
          }
        />
        <Route
          path="sessions"
          element={
            <>
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
                            busy={busy}
                            onClick={() => {
                              void persist("Session ended", "Couldn’t end session", async () => {
                                await api(`/api/v1/sessions/${row.id}/revoke`, { method: "POST" });
                              });
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
                  busy={busy}
                  onClick={() => {
                    void persist(
                      "Signed out elsewhere",
                      "Couldn’t sign out other sessions",
                      async () => {
                        await api("/api/v1/sessions/revoke-others", { method: "POST" });
                      },
                    );
                  }}
                >
                  Sign out other sessions
                </Button>
              </Card>

              <Card>
                <h2>Audit log</h2>
                <p className="field-note">
                  Security actions are listed newest first. Clearing deletes the history and records
                  that the log was wiped.
                </p>
                {audit.length === 0 ? (
                  <EmptyState
                    title="No audit events yet"
                    body="Security actions appear here after they run."
                  />
                ) : (
                  <ul className="data-list">
                    {audit.map((row) => (
                      <li key={row.id}>
                        <span>
                          {auditActionLabel(row.action)}
                          {auditResourceLabel(row.resource) ? (
                            <small>{auditResourceLabel(row.resource)}</small>
                          ) : null}
                        </span>
                        <time dateTime={row.createdAt}>
                          {dateTime.format(new Date(row.createdAt))}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="ui-actions">
                  {auditHasMore && audit.length < CLIENT_LIST_CAP ? (
                    <Button
                      variant="ghost"
                      busy={busy}
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
                  <Button variant="danger" onClick={() => setConfirmClearAudit(true)}>
                    Clear audit log
                  </Button>
                </p>
                {confirmClearAudit ? (
                  <Dialog
                    title="Clear audit log"
                    confirmLabel="Clear log"
                    confirmVariant="danger"
                    onClose={() => setConfirmClearAudit(false)}
                    onConfirm={() => {
                      setConfirmClearAudit(false);
                      void persist("Audit log cleared", "Couldn’t clear audit log", async () => {
                        await api("/api/v1/audit", { method: "DELETE" });
                      });
                    }}
                  >
                    <p>
                      This deletes every audit event. A single new row records that the log was
                      cleared.
                    </p>
                  </Dialog>
                ) : null}
              </Card>
            </>
          }
        />
      </Routes>
    </>
  );
}
export { SettingsPage };
