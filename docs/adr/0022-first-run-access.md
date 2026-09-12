# First-run access

Compose publishes the dashboard at `127.0.0.1:8080` on the machine that runs
Docker. From another machine, use an SSH tunnel to that address and the same
four-step wizard.

Letting other devices open the URL without SSH is an explicit start flag.
Setup then requires the setup code printed at start. Setup stays closed until
that code is accepted. Unused codes expire after 15 minutes; print a new one
from the machine that runs Docker. The code also stops working after Finish.

A command on that machine runs the same four steps in a terminal.

Windows uses `scripts/riddlr-up.ps1` for the same three paths.

**Status:** accepted
