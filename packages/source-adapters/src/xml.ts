export function xmlForbidsDtd(xml: string): boolean {
  return /<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml);
}

export function decodeXmlText(value: string): string {
  const withoutCdata = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const numeric = withoutCdata
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
  return numeric
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const openRe = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>`, "gi");
  let match = openRe.exec(xml);
  while (match) {
    const start = match.index + match[0].length;
    const closeRe = new RegExp(`</(?:[\\w.-]+:)?${tag}\\s*>`, "gi");
    closeRe.lastIndex = start;
    const close = closeRe.exec(xml);
    if (!close) {
      break;
    }
    blocks.push(xml.slice(start, close.index));
    openRe.lastIndex = close.index + close[0].length;
    match = openRe.exec(xml);
  }
  return blocks;
}

export function innerXmlText(block: string, localName: string): string | undefined {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}\\s*>`,
    "i",
  );
  const match = re.exec(block);
  if (!match?.[1]) {
    return undefined;
  }
  const text = decodeXmlText(match[1]);
  return text.length > 0 ? text : undefined;
}

export function atomHref(block: string): string | undefined {
  const re = /<(?:[\w.-]+:)?link\b([^>]*)\/?>/gi;
  let fallback: string | undefined;
  let match = re.exec(block);
  while (match) {
    const attrs = match[1] ?? "";
    const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const rel = /rel\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const url = href?.[2] ?? href?.[3];
    if (url) {
      const decoded = decodeXmlText(url);
      const relValue = (rel?.[2] ?? rel?.[3] ?? "alternate").toLowerCase();
      if (relValue === "alternate") {
        return decoded;
      }
      fallback ??= decoded;
    }
    match = re.exec(block);
  }
  return fallback;
}
