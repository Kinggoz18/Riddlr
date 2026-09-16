import { MAX_RELEVANCE_TERMS, takeBounded } from "@riddlr/domain";

export const EQUITIES_RELEVANCE_TERMS = [
  "earnings",
  "dividend",
  "buyback",
  "guidance",
  "10-k",
  "10-q",
  "8-k",
  "form 4",
  "insider",
  "nasdaq",
  "nyse",
  "s&p",
  "dow jones",
  "prospectus",
  "sec filing",
] as const;

export function equitiesRelevanceTerms(): string[] {
  return takeBounded([...EQUITIES_RELEVANCE_TERMS], MAX_RELEVANCE_TERMS);
}
