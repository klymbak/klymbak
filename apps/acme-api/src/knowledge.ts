import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { knowledge, knowledgeTools, openAIEmbeddings, type KnowledgeTicket } from "@klymbak/server";
import { DATA_DIR, getDb, type Row } from "./db/database.ts";

const env = process.env;
const folder = fileURLToPath(new URL("../knowledge", import.meta.url));

/** Closed tickets with their conversation, for the knowledge base to show how a problem was handled before. */
function resolvedTickets(): KnowledgeTicket[] {
  const db = getDb();
  const tickets = db
    .prepare(
      `SELECT t.id, t.subject, t.body, t.order_id, t.updated_at, c.name, c.email, c.phone, c.city, o.tracking_number
       FROM tickets t JOIN customers c ON c.id = t.customer_id LEFT JOIN orders o ON o.id = t.order_id
       WHERE t.status = 'closed' ORDER BY t.updated_at DESC LIMIT 500`,
    )
    .all() as Row[];
  const replies = db.prepare("SELECT author, body FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at");
  return tickets.map((ticket) => ({
    id: ticket.id,
    subject: ticket.subject,
    messages: [
      { from: "customer", text: ticket.body },
      ...(replies.all(ticket.id) as Row[]).map((reply) => ({ from: reply.author === ticket.name ? "customer" : reply.author, text: reply.body })),
    ],
    // What identifies the customer is removed before the ticket is indexed.
    customer: { name: ticket.name, email: ticket.email, phone: ticket.phone, address: ticket.city },
    private: [ticket.order_id, ticket.tracking_number].filter(Boolean),
    closedAt: ticket.updated_at,
  }));
}

/**
 * Semantic search, when a local embeddings model is set: KNOWLEDGE_EMBEDDINGS_MODEL=text-embedding-nomic-embed-text-v1.5
 * with LM Studio, for instance. Keyword search works without it.
 */
const model = env.KNOWLEDGE_EMBEDDINGS_MODEL;
const embeddings = model
  ? openAIEmbeddings({
      baseUrl: env.KNOWLEDGE_EMBEDDINGS_URL ?? env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
      model,
      // nomic-embed-text is trained with these prefixes.
      ...(model.includes("nomic") ? { queryPrefix: "search_query: ", documentPrefix: "search_document: " } : {}),
    })
  : undefined;

export const knowledgeBase = knowledgeTools({
  description: "Acme's knowledge base: policies, product information, the tent manual, a parts fitment table and resolved support tickets",
  sources: [
    knowledge.folder(folder, {
      name: "handbook",
      title: "Support handbook",
      description: "Policies (returns and refunds, shipping, warranty, discount codes), product information and manuals.",
    }),
    knowledge.table({
      name: "parts",
      title: "Parts fitment",
      description: "Which spare parts (rainflies, footprints, pole sets, hip belts, filter cartridges…) fit which product, with prices.",
      file: join(folder, "tables", "parts-fitment.csv"),
    }),
    knowledge.tickets({ load: async () => resolvedTickets(), roles: ["admin", "support"] }),
  ],
  synonyms: { refund: ["money back"], broken: ["defect", "faulty"], late: ["delay", "stuck"], ripped: ["torn", "tear"], torn: ["tear", "ripped"] },
  embeddings,
  cacheDir: join(DATA_DIR, "knowledge"),
});
