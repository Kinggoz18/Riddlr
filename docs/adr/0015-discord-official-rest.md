# Discord official REST polling

Discord evidence is collected with the official bot HTTP API. The bot token is
encrypted at rest. Least privilege is VIEW_CHANNEL and READ_MESSAGE_HISTORY
(permission integer 66560). Channel text requires the MESSAGE_CONTENT
privileged intent. Lookback is recent channel messages (max 100 per request),
not archive search. Administrator is not requested.

**Status:** accepted
