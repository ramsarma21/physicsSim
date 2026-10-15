"""Serves web/server.py's handler on a free port for ai/test/server.test.mjs (no engine workers are started).
Prints the port on stdout, then serves until killed. The tests run it with HOME pointing at a temp dir whose
.config/truefoundry/env holds a FAKE key and the mock gateway's URL, so the AI route's real command
(zsh -c 'source ~/.config/truefoundry/env && exec node ai/cli.mjs') runs unchanged against the mock."""
import os
import sys

PG = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(PG, "web"))
import server  # noqa: E402

srv = server.Server(("127.0.0.1", 0), server.Handler)
print(srv.server_address[1], flush=True)
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
