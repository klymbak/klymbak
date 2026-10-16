export interface SseMessage {
  event?: string;
  data: string;
  id?: string;
}

/**
 * Incremental parser for text/event-stream. Used instead of EventSource because
 * EventSource cannot send auth headers or POST bodies.
 */
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = "";
  let data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  const dispatch = () => {
    if (data.length > 0) onMessage({ event, data: data.join("\n"), id });
    data = [];
    event = undefined;
  };

  const handleLine = (line: string) => {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
    else if (field === "id") id = value;
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (!match) break;
        // A trailing \r may be the first half of \r\n split across chunks.
        if (match[0] === "\r" && match.index === buffer.length - 1) break;
        handleLine(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    },
    flush() {
      if (buffer) handleLine(buffer);
      buffer = "";
      dispatch();
    },
  };
}

/** Reads an SSE response body to the end, calling `onMessage` for each event. */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onMessage: (message: SseMessage) => void,
): Promise<void> {
  const parser = createSseParser(onMessage);
  const decoder = new TextDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.flush();
  } finally {
    reader.releaseLock();
  }
}
