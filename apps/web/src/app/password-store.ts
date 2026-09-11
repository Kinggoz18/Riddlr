type PasswordCredentialInit = { id: string; password: string; name?: string };

type PasswordCredentialLike = Credential & { password?: string };

export function passwordManagerLabel() {
  const apple = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const android = /Android/.test(navigator.userAgent);
  if (apple) {
    return "Save to Keychain";
  }
  if (android) {
    return "Save to Google Password Manager";
  }
  return "Save to password manager";
}

export async function storeInPasswordManager(email: string, password: string): Promise<boolean> {
  const ctor = (
    window as Window & { PasswordCredential?: new (init: PasswordCredentialInit) => Credential }
  ).PasswordCredential;
  if (!ctor || !navigator.credentials?.store) {
    return false;
  }
  try {
    await navigator.credentials.store(new ctor({ id: email, password, name: "Riddlr" }));
    return true;
  } catch {
    return false;
  }
}

export async function loadFromPasswordManager(): Promise<{ id: string; password: string } | null> {
  if (!navigator.credentials?.get) {
    return null;
  }
  try {
    const cred = (await navigator.credentials.get({
      password: true,
      mediation: "optional",
    } as CredentialRequestOptions)) as PasswordCredentialLike | null;
    if (!cred?.id || typeof cred.password !== "string" || cred.password.length === 0) {
      return null;
    }
    return { id: cred.id, password: cred.password };
  } catch {
    return null;
  }
}
