import WebSocket from "ws";

// Open a WebSocket to an app-server listening on a unix socket
// (`codex app-server --listen unix://`).
//
// The app-server rejects the permessage-deflate extension by hanging up, so
// compression must stay off. A Host header is required for the HTTP upgrade.
export function openUnixWebSocket(socketPath: string, timeoutMs = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws+unix://${socketPath}:/`, {
      perMessageDeflate: false,
      headers: { Host: "localhost" },
      handshakeTimeout: timeoutMs,
    });
    const onError = (err: Error) => {
      ws.off("open", onOpen);
      reject(err);
    };
    const onOpen = () => {
      ws.off("error", onError);
      resolve(ws);
    };
    ws.once("error", onError);
    ws.once("open", onOpen);
  });
}
