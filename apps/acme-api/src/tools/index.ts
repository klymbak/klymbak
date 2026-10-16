import type { ToolDefinition } from "@klymbak/server";
import { adjustInventory, listProducts } from "./inventory.ts";
import { createDiscountCode, getAuditLog, notifyTeam } from "./admin.ts";
import { getCustomer, searchCustomers } from "./customers.ts";
import { getOrder, listOrders, refundOrder, updateOrderStatus } from "./orders.ts";
import { queryDatabase, salesReport } from "./analytics.ts";
import { getTicket, listTickets, replyToTicket } from "./support.ts";

/** Everything the old admin panel could do, as tools. */
export const tools: ToolDefinition<any>[] = [
  searchCustomers,
  getCustomer,
  listOrders,
  getOrder,
  refundOrder,
  updateOrderStatus,
  listProducts,
  adjustInventory,
  salesReport,
  queryDatabase,
  listTickets,
  getTicket,
  replyToTicket,
  createDiscountCode,
  notifyTeam,
  getAuditLog,
];
