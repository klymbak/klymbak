import type { JsonRpcMessage } from "@earendil-works/pi-mcp";
import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing";

type Handler = (params: any) => unknown;

/**
 * A small MCP server for tests, on the far end of an in-memory transport. It answers `initialize` with these
 * capabilities and other requests with the handler for their method; a handler that throws answers with an error.
 */
export function fakeMcpServer(capabilities: Record<string, unknown>, handlers: Record<string, Handler>) {
  const { client, server } = createInMemoryTransportPair();
  const calls: { method: string; params: any }[] = [];
  server.onMessage(async (message) => {
    const request = message as { id?: string | number; method?: string; params?: any };
    if (request.id === undefined || !request.method) return;
    calls.push({ method: request.method, params: request.params });
    const reply = (body: Record<string, unknown>) => server.send({ jsonrpc: "2.0", id: request.id, ...body } as JsonRpcMessage);
    if (request.method === "initialize") {
      await reply({ result: { protocolVersion: request.params.protocolVersion, capabilities, serverInfo: { name: "fake", version: "1.0.0" } } });
      return;
    }
    const handler = handlers[request.method];
    if (!handler) {
      await reply({ error: { code: -32601, message: `Method not found: ${request.method}` } });
      return;
    }
    try {
      await reply({ result: await handler(request.params) });
    } catch (error) {
      await reply({ error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
    }
  });
  void server.start();
  return {
    transport: client,
    /** Every request the server received, in order. */
    calls,
    /** Sends the client a notification, such as notifications/resources/list_changed. */
    notify: (method: string) => server.send({ jsonrpc: "2.0", method } as JsonRpcMessage),
  };
}
