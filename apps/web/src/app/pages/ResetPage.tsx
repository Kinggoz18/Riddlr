import { Button, Field } from "@riddlr/ui";
import { useState } from "react";
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
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await api("/api/v1/auth/reset/request", {
                method: "POST",
                body: JSON.stringify({ email }),
              });
              toast("Check your email");
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
            <Button type="submit" busy={busy}>
              Send reset link
            </Button>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
export { ResetPage };
