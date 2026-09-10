# X official recent search

X evidence is collected with `GET /2/tweets/search/recent` and a bearer token
encrypted at rest. Lookback is at most seven days. Archive search is not
called. 401 is authentication failure. 403/402 means the token's plan does not
include recent search.

**Status:** accepted
