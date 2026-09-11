import { Button } from "@riddlr/ui";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toastFail, useToast } from "./Toast.js";

function groupedSecret(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export function TotpEnroll(props: {
  otpauth: string;
  secret: string;
  token: string;
  onToken: (value: string) => void;
  onVerify: () => Promise<void>;
  busy?: boolean;
  verifyLabel?: string;
}) {
  const toast = useToast();
  const [qr, setQr] = useState<string>();
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(props.otpauth, {
      margin: 1,
      width: 212,
      errorCorrectionLevel: "M",
      color: { dark: "#050807", light: "#ffffff" },
    }).then((url) => {
      if (active) {
        setQr(url);
      }
    });
    return () => {
      active = false;
    };
  }, [props.otpauth]);

  return (
    <div className="totp-enroll">
      <div className="totp-enroll-visual">
        {qr ? (
          <img
            className="totp-qr"
            src={qr}
            width={212}
            height={212}
            alt="Google Authenticator QR code"
          />
        ) : (
          <p>Preparing QR code…</p>
        )}
        <div>
          <p className="ui-field-label">Setup key</p>
          <p className="field-note">Can’t scan? Enter this in your authenticator app.</p>
          <p className="totp-secret" translate="no">
            {groupedSecret(props.secret)}
          </p>
          <p className="ui-actions">
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(props.secret);
                  toast("Copied to clipboard");
                } catch (err) {
                  toast(toastFail(err, "Couldn’t copy"), "danger");
                }
              }}
            >
              Copy key
            </Button>
          </p>
        </div>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          await props.onVerify();
        }}
      >
        <label className="ui-field" htmlFor="authenticator-code">
          <span className="ui-field-label">Authenticator code</span>
          <input
            id="authenticator-code"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            value={props.token}
            onChange={(event) => props.onToken(event.target.value)}
            required
            minLength={6}
            maxLength={8}
          />
        </label>
        <p className="ui-actions">
          <Button type="submit" busy={props.busy}>
            {props.verifyLabel ?? "Verify and enable"}
          </Button>
        </p>
      </form>
    </div>
  );
}
