export const MAX_SKILL_BYTES = 32_768;
export const MAX_SKILLS_PER_AGENT = 8;
export const MAX_SKILL_PROMPT_CHARS = 4_000;
export const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9-]{2,62}$/;

const FORBIDDEN =
  /<script|javascript:|\b(grant tools?|filesystem access|execute commands?|private keys?|ignore (the )?system)\b/i;

export class UnsafeSkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeSkillError";
  }
}

export function assertSkillSlug(slug: string): string {
  if (!SKILL_SLUG_RE.test(slug)) {
    throw new UnsafeSkillError("Skill slug must be lowercase letters, digits, and hyphens.");
  }
  return slug;
}

export function assertSafeSkillMarkdown(markdown: string): string {
  if (markdown.length > MAX_SKILL_BYTES) {
    throw new UnsafeSkillError(`Skill markdown exceeds ${MAX_SKILL_BYTES} bytes.`);
  }
  if (FORBIDDEN.test(markdown)) {
    throw new UnsafeSkillError(
      "Skills cannot grant tools, filesystem, secrets, or override system policy.",
    );
  }
  return markdown.replace(/\0/g, "");
}
