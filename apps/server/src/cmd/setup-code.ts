import { readOrRenewOperatorSetupCode } from "../modules/setup-gate.js";

const dir = process.env.RIDDLR_SECRETS_DIR ?? ".secrets";
const result = readOrRenewOperatorSetupCode(dir);
if (result.kind === "gone") {
  process.stderr.write(
    "No setup code is available. First-run is finished or this host is not waiting.\n",
  );
  process.exit(1);
}
if (result.kind === "in_progress") {
  process.stderr.write(
    "First-run is already in progress in a browser. Finish those four steps there.\n",
  );
  process.exit(1);
}
process.stdout.write(`${result.code}\n`);
