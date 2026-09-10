import { Button, Field } from "@riddlr/ui";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api.js";

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [stage, setStage] = useState<"password" | "totp">("password");
  const [error, setError] = useState<string>();
  return (
    <main className="page" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1>Sign in</h1>
      {error ? <p role="alert">{error}</p> : null}
      {stage === "password" ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/auth/login", {
                method: "POST",
                body: JSON.stringify({ email, password }),
              });
              setStage("totp");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed");
            }
          }}
        >
          <Field label="Email or username">
            <input
              id="email-or-username"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit">Continue</Button>
        </form>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/auth/2fa", { method: "POST", body: JSON.stringify({ token }) });
              window.location.assign("/");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed");
            }
          }}
        >
          <Field label="Authenticator or recovery code">
            <input
              id="authenticator-or-recovery-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </Field>
          <Button type="submit">Verify</Button>
        </form>
      )}
      <p>
        <NavLink to="/reset">Forgot password</NavLink>
      </p>
    </main>
  );
}
export { LoginPage };
