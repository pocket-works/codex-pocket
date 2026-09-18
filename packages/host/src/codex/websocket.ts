import WebSocket from "ws";

// Open a WebSocket to a Codex app-server. Works for both transports:
//   ws://127.0.0.1:PORT/      (`--listen ws://…`)
//   ws+unix:///path.sock:/    (`--listen unix://…`)
//
// The app-server rejects the permessage-deflate extension by hanging up, so
// compression must stay off. A Host header is required for unix upgrades.
export function openAppServerWebSocket(url: string, timeoutMs = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
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

export function unixSocketUrl(socketPath: string): string {
  return `ws+unix://${socketPath}:/`;
}
