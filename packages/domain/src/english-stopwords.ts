import { MAX_ENGLISH_STOPWORDS, takeBounded } from "./limits.js";

/**
 * Bounded English function words plus common-prose tokens that collide with
 * CoinGecko symbols and names (DATA, CAP, NOT, PEOPLE, TRUMP, …).
 */
const STOPWORD_TEXT = `
a about after again against all also am an and any are aren't as at
back be because been before being below between both but by
came can cannot could couldn't
did didn't do does doesn't doing don't down during
each
few for from further
get got
had hadn't has hasn't have haven't having he her here hers herself him himself his how
i if in into is isn't it it's its itself
just
like
many may me might more most much must my myself
no nor not now
of off on once only or other our ours ourselves out over own
same shall she should shouldn't so some such
than that the their theirs them themselves then there these they this those through to too
under until up us
very
was wasn't we were weren't what when where which while who whom why will with would wouldn't
you your yours yourself yourselves
able according across actually additional almost already although always among amount another
around asked away
based became become becomes becoming best better big billion billions both
business businesses buy
call called capital case cases ceo change changes claimed claiming claims come comes coming
comment comments companies company compared complete comprehensive cost costs country court
current currently customer customers
data day days deal deals demand despite developer developers didn direct director disclosed
document documents
early east economic energy even event events ever every example exclusive executive
face fact facts fall falls family far federal fees felt few filed filing filings final
financial first following foreign former found
general generally given going good government group groups
head high higher home hour hours however
include included includes including increase increased index industry information initial
instead interest interested into investment investments investor investors
job jobs
keep kept key know known
large last late later latest law laws lead leader least legal less let level levels life
likely line listed listing listings little local long look looking low
made make makes making man management manager market markets matter may mean means media
might million millions money month months move moved movement
name named names national near need needed never new news next north
offering offerings office officer official officials often old once one ones online open
operating operation operations order orders original other others over
part parts party people percent period place plan plans point points police policy political
possible post posted potential president press previous price prices private probably
problem process product products program project projects proposed public publicly put
rate rates rather real really recent recently related report reported reports
research result results return review right rights rise rose
sale sales same say saying says school second sector see sell senior several share shares
short show showed since small so sold some someone something source sources south staff
start started state states still stock stocks street study such support
take taken takes taking tax team technology than that their then there they thing things
think third those though thousand time times today told too top total toward towards trade
trading tuesday monday wednesday thursday friday saturday sunday
under unit united until upon used using
value values versus via
want wanted week weeks well west whether while white whole whose win without woman work
worked working world would
year years yes yet york
act action actions administration agency agreement ai air america american americans
apple baby ban beam cap core dog edge fun gas hot hype id link mask meme move near not
one ordinals party people render safe story sun trump usd yeti
`;

const STOPWORD_LIST = takeBounded(
  [
    ...new Set(
      STOPWORD_TEXT.split(/\s+/)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean),
    ),
  ],
  MAX_ENGLISH_STOPWORDS,
);

export const ENGLISH_RESOLVER_STOPWORDS: ReadonlySet<string> = new Set(STOPWORD_LIST);

export function isEnglishStopword(value: string): boolean {
  const key = value.trim().toLowerCase();
  if (!key) {
    return false;
  }
  return ENGLISH_RESOLVER_STOPWORDS.has(key);
}

export function aliasIsWeakProse(alias: string): boolean {
  const key = alias.trim().toLowerCase();
  if (!key) {
    return true;
  }
  if (key.startsWith("$") || key.includes("/") || /^0x[a-f0-9]{40}$/.test(key)) {
    return false;
  }
  if (isEnglishStopword(key)) {
    return true;
  }
  if (!key.includes(" ")) {
    return false;
  }
  const tokens = key.split(/\s+/).filter(Boolean);
  return tokens.every(
    (token) => token.length < 3 || isEnglishStopword(token) || /^\d+$/.test(token),
  );
}
