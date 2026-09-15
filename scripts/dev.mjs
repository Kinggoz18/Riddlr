#!/usr/bin/env node
import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;

function start(name, args, extraEnv = {}) {
  const child = spawn("pnpm", args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  child.on("exit", (code) => {
    if (shuttingDown) {
      return;
    }
    if (code !== 0 && code !== null) {
      console.error(`${name} exited with ${code}`);
    }
    shutdown(code ?? 1);
  });
  children.push(child);
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("api", ["--filter", "@riddlr/server", "dev"]);
start("worker", ["--filter", "@riddlr/server", "dev:worker"], { RIDDLR_PROCESS_ROLE: "worker" });
start("web", ["--filter", "@riddlr/web", "dev"]);
