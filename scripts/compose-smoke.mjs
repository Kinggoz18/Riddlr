const origin = process.env.RIDDLR_PUBLIC_URL ?? "http://127.0.0.1:8080";

const deadline = Date.now() + 120_000;
let lastError = "not started";

while (Date.now() < deadline) {
  try {
    const response = await fetch(`${origin}/api/v1/setup/status`);
    if (response.ok) {
      const body = await response.json();
      if (
        body.stepCount === 4 &&
        Array.isArray(body.domains) &&
        body.domains.length === 5 &&
        body.setupAccess === "local"
      ) {
        console.log("Compose smoke passed:", origin);
        process.exit(0);
      }
      lastError = `unexpected setup payload: ${JSON.stringify(body)}`;
    } else {
      lastError = `HTTP ${response.status}`;
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

console.error(`Compose smoke failed against ${origin}: ${lastError}`);
process.exit(1);
