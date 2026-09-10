import { Button, Field } from "@riddlr/ui";
import { useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";

function ResetPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const token = search.get("token") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  return (
    <main className="page" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1>Reset password</h1>
      <p>
        <NavLink to="/login">Back to sign in</NavLink>
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p>{notice}</p> : null}
      {token ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/auth/reset/complete", {
                method: "POST",
                body: JSON.stringify({ token, newPassword: password }),
              });
              navigate("/login");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed");
            }
          }}
        >
          <Field label="New password">
            <input
              id="new-password"
              type="password"
              value={password}
              minLength={12}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit">Set new password</Button>
        </form>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/api/v1/auth/reset/request", {
                method: "POST",
                body: JSON.stringify({ email }),
              });
              setNotice("If that account exists, a reset email is on its way.");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed");
            }
          }}
        >
          <Field label="Email">
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Button type="submit">Send reset link</Button>
        </form>
      )}
    </main>
  );
}
export { ResetPage };
