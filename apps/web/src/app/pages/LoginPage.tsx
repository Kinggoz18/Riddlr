import { Button, Field } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api.js";
import { AuthShell } from "../Brand.js";
import { loadFromPasswordManager } from "../password-store.js";
import { toastFail, useToast } from "../Toast.js";

function LoginPage() {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [stage, setStage] = useState<"password" | "totp">("password");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void loadFromPasswordManager().then((cred) => {
      if (!active || !cred) {
        return;
      }
      setEmail(cred.id);
      setPassword(cred.password);
    });
    return () => {
      active = false;
    };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast(toastFail(err, "Sign-in failed"), "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Welcome back">
      {stage === "password" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await api<{ requiresTwoFactor: boolean }>("/api/v1/auth/login", {
                method: "POST",
                body: JSON.stringify({ email, password }),
              });
              if (result.requiresTwoFactor) {
                setStage("totp");
                return;
              }
              window.location.assign("/");
            });
          }}
        >
          <Field label="Email or username">
            <input
              id="email-or-username"
              name="username"
              type="email"
              autoComplete="username"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit" busy={busy}>
              Continue
            </Button>
          </p>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api("/api/v1/auth/2fa", { method: "POST", body: JSON.stringify({ token }) });
              window.location.assign("/");
            });
          }}
        >
          <Field label="Authenticator or recovery code">
            <input
              id="authenticator-or-recovery-code"
              name="totp"
              autoComplete="one-time-code"
              inputMode="numeric"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </Field>
          <p className="ui-actions">
            <Button type="submit" busy={busy}>
              Verify
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setStage("password");
                setToken("");
              }}
            >
              Use a different account
            </Button>
          </p>
        </form>
      )}
      <p>
        <NavLink to="/reset">Forgot password</NavLink>
      </p>
    </AuthShell>
  );
}
export { LoginPage };
