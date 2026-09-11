#!/bin/sh
set -e
mkdir -p /var/lib/riddlr
chown -R riddlr:riddlr /var/lib/riddlr
exec setpriv --reuid=riddlr --regid=riddlr --init-groups -- "$@"
