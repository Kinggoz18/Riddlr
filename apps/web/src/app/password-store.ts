type PasswordCredentialInit = { id: string; password: string; name?: string };

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
