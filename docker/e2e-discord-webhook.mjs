import http from "node:http";

const server = http.createServer((request, response) => {
  const path = request.url ?? "/";
  if (!path.startsWith("/api/webhooks/")) {
    response.writeHead(404);
    response.end();
    return;
  }
  if (request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ type: 1, channel_id: "e2e-channel", name: "e2e" }));
    return;
  }
  if (request.method === "POST") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: "e2e-msg-1" }));
    return;
  }
  response.writeHead(405);
  response.end();
});

server.listen(8080, "0.0.0.0");
