import { MAX_ROBOTS_TXT_CHARS } from "@riddlr/domain";
import { RIDDLR_HTTP_USER_AGENT, RIDDLR_ROBOTS_PRODUCT } from "./user-agent.js";

type RobotsRuleKind = "allow" | "disallow";

type RobotsRule = {
  kind: RobotsRuleKind;
  path: string;
};

type RobotsGroup = {
  agents: string[];
  rules: RobotsRule[];
};

export type RobotsTxtLoad = {
  text: string;
  status: number;
  fromCache: boolean;
};

function parseRobotsGroups(robotsTxt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let seenRule = false;

  const flush = () => {
    if (agents.length === 0 && rules.length === 0) {
      return;
    }
    groups.push({ agents, rules });
    agents = [];
    rules = [];
    seenRule = false;
  };

  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) {
      continue;
    }
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (seenRule) {
        flush();
      }
      if (value) {
        agents.push(value.toLowerCase());
      }
      continue;
    }
    if (field === "allow" || field === "disallow") {
      seenRule = true;
      rules.push({ kind: field === "allow" ? "allow" : "disallow", path: value });
    }
  }
  flush();
  return groups;
}

function agentMatchScore(group: RobotsGroup, product: string): number {
  const needle = product.toLowerCase();
  let best = 0;
  for (const agent of group.agents) {
    if (agent === "*") {
      best = Math.max(best, 1);
      continue;
    }
    if (needle === agent || needle.startsWith(`${agent}/`) || agent.startsWith(`${needle}/`)) {
      best = Math.max(best, agent.length);
    }
  }
  return best;
}

function pathMatchesRobotsRule(pathname: string, rulePath: string): boolean {
  if (!rulePath) {
    return false;
  }
  let path = rulePath;
  const anchored = path.endsWith("$");
  if (anchored) {
    path = path.slice(0, -1);
  }
  if (path === "/") {
    return !anchored || pathname === "/" || pathname === "";
  }
  if (anchored) {
    return pathname === path;
  }
  if (pathname === path) {
    return true;
  }
  const prefix = path.endsWith("/") ? path : `${path}/`;
  return pathname.startsWith(prefix);
}

function ruleLength(path: string): number {
  if (!path || path === "/") {
    return 1;
  }
  return path.endsWith("$") ? path.length - 1 : path.length;
}

function selectGroup(groups: readonly RobotsGroup[], product: string): RobotsGroup | undefined {
  let selected: RobotsGroup | undefined;
  let score = 0;
  for (const group of groups) {
    const match = agentMatchScore(group, product);
    if (match > score) {
      score = match;
      selected = group;
    }
  }
  return selected;
}

export function pathDisallowedByRobots(
  robotsTxt: string,
  pathname: string,
  userAgent = RIDDLR_ROBOTS_PRODUCT,
): boolean {
  const product = userAgent.split(/[/\s]/)[0] || RIDDLR_ROBOTS_PRODUCT;
  const group = selectGroup(parseRobotsGroups(robotsTxt), product);
  if (!group) {
    return false;
  }
  let best: { kind: RobotsRuleKind; length: number } | undefined;
  for (const rule of group.rules) {
    if (!rule.path) {
      continue;
    }
    if (!pathMatchesRobotsRule(pathname, rule.path)) {
      continue;
    }
    const length = ruleLength(rule.path);
    if (
      !best ||
      length > best.length ||
      (length === best.length && rule.kind === "allow" && best.kind === "disallow")
    ) {
      best = { kind: rule.kind, length };
    }
  }
  return best?.kind === "disallow";
}

export async function loadRobotsTxt(input: {
  origin: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cachedText?: string;
  cachedStatus?: number;
}): Promise<RobotsTxtLoad> {
  if (input.cachedText !== undefined) {
    return {
      text: input.cachedText,
      status: input.cachedStatus ?? 200,
      fromCache: true,
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(new URL("/robots.txt", input.origin), {
      signal: AbortSignal.timeout(input.timeoutMs ?? 5_000),
      redirect: "manual",
      headers: { "user-agent": RIDDLR_HTTP_USER_AGENT },
    });
    if (response.status === 404 || response.status >= 500) {
      return { text: "", status: response.status, fromCache: false };
    }
    if (!response.ok) {
      return { text: "", status: response.status, fromCache: false };
    }
    const text = (await response.text()).slice(0, MAX_ROBOTS_TXT_CHARS);
    return { text, status: response.status, fromCache: false };
  } catch {
    return { text: "", status: 0, fromCache: false };
  }
}

export async function robotsDenied(input: {
  origin: string;
  pathname: string;
  fetchImpl?: typeof fetch;
  lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  timeoutMs?: number;
  cachedText?: string;
  cachedStatus?: number;
  userAgent?: string;
}): Promise<boolean> {
  const loaded = await loadRobotsTxt(input);
  if (loaded.status === 404 || loaded.status >= 500 || loaded.status === 0) {
    return false;
  }
  if (loaded.status !== 200 && input.cachedText === undefined) {
    return false;
  }
  return pathDisallowedByRobots(loaded.text, input.pathname, input.userAgent);
}
