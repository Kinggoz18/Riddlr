export function pathDisallowedByRobots(robotsTxt: string, pathname: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let applies = false;
  const disallowed: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) {
      continue;
    }
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (!field) {
      continue;
    }
    if (field.toLowerCase() === "user-agent") {
      applies = value === "*";
      continue;
    }
    if (applies && field.toLowerCase() === "disallow" && value) {
      disallowed.push(value);
    }
  }
  return disallowed.some(
    (rule) =>
      pathname === rule ||
      pathname.startsWith(rule.endsWith("/") ? rule : `${rule}/`) ||
      pathname.startsWith(rule),
  );
}

export async function robotsDenied(input: {
  origin: string;
  pathname: string;
  fetchImpl?: typeof fetch;
  lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  timeoutMs?: number;
}): Promise<boolean> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(new URL("/robots.txt", input.origin), {
      signal: AbortSignal.timeout(input.timeoutMs ?? 5_000),
      redirect: "manual",
    });
    if (response.status === 404 || response.status >= 500) {
      return false;
    }
    if (!response.ok) {
      return false;
    }
    const text = (await response.text()).slice(0, 20_000);
    return pathDisallowedByRobots(text, input.pathname);
  } catch {
    return false;
  }
}
