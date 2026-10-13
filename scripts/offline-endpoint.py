"""The model endpoint of an offline sandbox run (scripts/sandbox.sh without --live-model).

Serves on an ephemeral loopback port, prints the port, and answers every request
with a non-retryable error naming the opt-in, so the sandboxed Claude Code never
reaches CLIProxyAPI and a typed prompt fails at once instead of retrying.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BODY = json.dumps({"type": "error", "error": {
    "type": "invalid_request_error",
    "message": "Kor sandbox is offline: fixture runs make no model calls. Rerun scripts/sandbox.sh with --live-model for model calls through the gateway.",
}}).encode()


class Offline(BaseHTTPRequestHandler):
    def reply(self):
        self.rfile.read(int(self.headers.get("content-length") or 0))
        self.send_response(400)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(BODY)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(BODY)

    do_GET = do_POST = do_HEAD = reply

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Offline)
print(server.server_port, flush=True)
server.serve_forever()
