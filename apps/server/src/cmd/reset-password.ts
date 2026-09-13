import { parseEnv } from "@riddlr/config";
import { hashToken, randomToken } from "@riddlr/crypto";
import { createDb, passwordResetTokens, users } from "@riddlr/db";
import { eq } from "drizzle-orm";

const config = parseEnv();
const { db, client } = createDb(config.RIDDLR_DATABASE_URL);

try {
  const rows = await db.select().from(users).where(eq(users.isAdmin, true)).limit(1);
  const user = rows[0];
  if (!user) {
    process.stderr.write("No administrator exists. Complete first-run setup.\n");
    process.exitCode = 1;
  } else {
    const token = randomToken();
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const resetUrl = new URL("/reset", config.RIDDLR_PUBLIC_URL);
    resetUrl.searchParams.set("token", token);
    process.stdout.write(`${resetUrl.toString()}\n`);
  }
} finally {
  await client.end();
}
