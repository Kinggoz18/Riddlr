import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  createHttpOnboardClient,
  OnboardError,
  onboardHelp,
  parseOnboardArgs,
  runOnboard,
} from "../modules/onboard.js";

const help = onboardHelp();

try {
  const flags = parseOnboardArgs(process.argv.slice(2));
  const origin =
    process.env.RIDDLR_ONBOARD_ORIGIN ??
    `http://127.0.0.1:${process.env.RIDDLR_HTTP_PORT ?? "3001"}`;
  const rl = flags.nonInteractive ? undefined : createInterface({ input, output });
  const io = {
    read: async (prompt: string) => {
      if (!rl) {
        throw new OnboardError("This command needs a terminal, or pass --non-interactive.");
      }
      return rl.question(`${prompt}: `);
    },
    write: (text: string) => {
      process.stdout.write(`${text}\n`);
    },
  };
  try {
    await runOnboard(flags, createHttpOnboardClient(origin), io);
  } finally {
    rl?.close();
  }
} catch (error) {
  if (error instanceof OnboardError && error.message === "help") {
    process.stdout.write(`${help}\n`);
    process.exit(0);
  }
  const message = error instanceof Error ? error.message : "Onboard failed.";
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
