import { Banner, Button, Field } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { AuthShell } from "../Brand.js";
import { toastFail, useToast } from "../Toast.js";

function ResetPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const token = search.get("token") ?? "";
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [delivered, setDelivered] = useState<boolean>();

  useEffect(() => {
    if (token) {
      return;
    }
    void api<{ delivered: boolean }>("/api/v1/auth/reset/status")
      .then((body) => setDelivered(body.delivered))
      .catch(() => setDelivered(undefined));
  }, [token]);

  return (
    <AuthShell title="Reset password">
      <p>
        <NavLink to="/login">Back to sign in</NavLink>
      </p>
      {token ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await api("/api/v1/auth/reset/complete", {
                method: "POST",
                body: JSON.stringify({ token, newPassword: password }),
              });
              navigate("/login");
            } catch (err) {
              toast(toastFail(err, "Couldn’t reset password"), "danger");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="New password">
            <input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={password}
              minLength={12}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit" busy={busy}>
              Set new password
            </Button>
          </p>
        </form>
      ) : (
        <>
          {delivered === false ? (
            <Banner tone="danger">
              This instance has no email transport, so it cannot send a reset link. Use an
              authenticator recovery code if you enabled 2FA. On the host, print a one-hour link
              with{" "}
              <code>docker compose exec -T api node apps/server/dist/cmd/reset-password.js</code>.
              Local Compose also delivers mail to /mailpit when SMTP is on.
            </Banner>
          ) : null}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                const result = await api<{ delivered: boolean }>("/api/v1/auth/reset/request", {
                  method: "POST",
                  body: JSON.stringify({ email }),
                });
                setDelivered(result.delivered);
                toast(
                  result.delivered
                    ? "If that email is this instance’s administrator, check the inbox."
                    : "This instance has no email transport.",
                  result.delivered ? undefined : "danger",
                );
              } catch (err) {
                toast(toastFail(err, "Couldn’t send reset email"), "danger");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Email">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <p className="ui-actions">
              <Button type="submit" busy={busy} disabled={delivered === false}>
                Send reset link
              </Button>
            </p>
          </form>
        </>
      )}
    </AuthShell>
  );
}
export { ResetPage };
