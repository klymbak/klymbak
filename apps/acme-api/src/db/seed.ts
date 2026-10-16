import type { DatabaseSync } from "node:sqlite";
import { shipmentProgress, trackingNumber } from "carrier-mcp/rules";

const DAY = 86_400_000;
const HISTORY_DAYS = 120;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRODUCTS: [string, string, number, number, string][] = [
  // name, category, price, popularity, supplier
  ["Ridgeline 2P Tent", "Tents", 329, 9, "Northpeak Gear Co."],
  ["Ridgeline 3P Tent", "Tents", 389, 6, "Northpeak Gear Co."],
  ["Basecamp 6P Family Tent", "Tents", 549, 3, "Northpeak Gear Co."],
  ["Featherlite Solo Tent", "Tents", 279, 4, "Alpenwerk GmbH"],
  ["Storm Shelter Bivy", "Tents", 189, 2, "Alpenwerk GmbH"],
  ["Alpine 20°F Down Bag", "Sleeping", 289, 6, "Cascade Textiles"],
  ["Trailhead 35°F Synthetic Bag", "Sleeping", 129, 8, "Cascade Textiles"],
  ["Cloudrest Inflatable Pad", "Sleeping", 119, 9, "Cascade Textiles"],
  ["Foam Trail Pad", "Sleeping", 39, 7, "Ironwood Outdoor"],
  ["Pillowpack Camp Pillow", "Sleeping", 34, 6, "Cascade Textiles"],
  ["Summit 65L Pack", "Backpacks", 249, 6, "TrailForge Ltd"],
  ["Ridge 45L Pack", "Backpacks", 189, 8, "TrailForge Ltd"],
  ["Daytripper 24L Pack", "Backpacks", 99, 12, "TrailForge Ltd"],
  ["Hydra 12L Running Vest", "Backpacks", 119, 5, "TrailForge Ltd"],
  ["Kids Explorer 18L Pack", "Backpacks", 59, 4, "TrailForge Ltd"],
  ["Summit Down Jacket", "Jackets", 279, 11, "Cascade Textiles"],
  ["Stormline Rain Shell", "Jackets", 199, 10, "Cascade Textiles"],
  ["Granite Softshell", "Jackets", 159, 6, "Cascade Textiles"],
  ["Firelight Fleece", "Jackets", 89, 10, "Cascade Textiles"],
  ["Sherpa Insulated Vest", "Jackets", 119, 5, "Cascade Textiles"],
  ["Trailblazer Hiking Boot", "Footwear", 189, 10, "Alpenwerk GmbH"],
  ["Ridgerunner Trail Shoe", "Footwear", 139, 11, "Alpenwerk GmbH"],
  ["Basecamp Camp Sandal", "Footwear", 59, 5, "Alpenwerk GmbH"],
  ["Merino Hiking Socks (3-pack)", "Footwear", 36, 14, "Cascade Textiles"],
  ["Glacier Gaiters", "Footwear", 49, 4, "Ironwood Outdoor"],
  ["Granite Climbing Harness", "Climbing", 79, 4, "Ironwood Outdoor"],
  ["Dynamic Rope 60m", "Climbing", 219, 3, "Ironwood Outdoor"],
  ["Locking Carabiner Set", "Climbing", 64, 5, "Ironwood Outdoor"],
  ["Chalk Bag & Brush", "Climbing", 29, 5, "Ironwood Outdoor"],
  ["Summit Climbing Helmet", "Climbing", 89, 3, "Ironwood Outdoor"],
  ["Basecamp Stove", "Cooking", 74, 7, "Northpeak Gear Co."],
  ["Titanium Cook Pot 900ml", "Cooking", 59, 6, "Northpeak Gear Co."],
  ["Fuel Canister 230g", "Cooking", 7.5, 13, "Northpeak Gear Co."],
  ["Trail Water Filter", "Cooking", 49, 9, "Northpeak Gear Co."],
  ["Insulated Camp Mug", "Cooking", 29, 8, "Northpeak Gear Co."],
  ["Headlamp 400lm", "Accessories", 49, 12, "TrailForge Ltd"],
  ["Trekking Poles (pair)", "Accessories", 119, 7, "TrailForge Ltd"],
  ["Solar Power Bank", "Accessories", 79, 6, "TrailForge Ltd"],
  ["First Aid Kit Pro", "Accessories", 45, 7, "Ironwood Outdoor"],
  ["Dry Bag 20L", "Accessories", 29, 8, "Ironwood Outdoor"],
];

/** Stock overrides that make the inventory story interesting: [name, stock, reorder level]. */
const STOCK_STORY: Record<string, [number, number]> = {
  "Headlamp 400lm": [0, 30],
  "Glacier Gaiters": [0, 10],
  "Summit Down Jacket": [6, 25],
  "Fuel Canister 230g": [14, 80],
  "Trail Water Filter": [9, 20],
  "Ridgerunner Trail Shoe": [11, 20],
};

const FIRST = ["Olivia", "Liam", "Emma", "Noah", "Ava", "Elijah", "Sophia", "Lucas", "Mia", "Mateo", "Amara", "Kenji", "Isabella", "Omar", "Freya", "Hugo", "Lena", "Arjun", "Chloe", "Diego", "Yuki", "Sven", "Nora", "Theo", "Maya", "Felix", "Ines", "Kai", "Zara", "Jonas", "Leila", "Ravi", "Astrid", "Mason", "Elena", "Tariq", "Camille", "Ben", "Hana", "Oscar"];
const LAST = ["Garcia", "Novak", "Kim", "Okafor", "Schmidt", "Rossi", "Nguyen", "Andersson", "Martin", "Patel", "Dubois", "Tanaka", "Brown", "Silva", "Müller", "Jansen", "Walsh", "Cohen", "Haddad", "Lindqvist", "Moreau", "Fischer", "Reyes", "Sato", "Kowalski", "Bauer", "Murphy", "Ivanova", "Larsen", "Costa"];

const PLACES: [string, string[], number, string][] = [
  // country, cities, weight, phone prefix
  ["US", ["Denver", "Seattle", "Portland", "Austin", "Boston", "Salt Lake City", "Minneapolis"], 45, "+1 555-01"],
  ["CA", ["Vancouver", "Calgary", "Toronto"], 10, "+1 555-01"],
  ["UK", ["London", "Manchester", "Edinburgh"], 12, "+44 20 7946 0"],
  ["DE", ["Munich", "Berlin", "Hamburg"], 10, "+49 30 5550 0"],
  ["FR", ["Lyon", "Grenoble", "Paris"], 7, "+33 1 5550 0"],
  ["NL", ["Amsterdam", "Utrecht"], 5, "+31 20 555 0"],
  ["SE", ["Stockholm", "Gothenburg"], 4, "+46 8 555 0"],
  ["AU", ["Melbourne", "Sydney", "Brisbane"], 7, "+61 3 5550 0"],
];

const TICKET_TEMPLATES: [string, string, string][] = [
  ["Where is my order?", "Hi, my order #{order} hasn't arrived yet and the tracking hasn't updated in a few days. Can you check?", "high"],
  ["Wrong size", "I ordered the wrong size on order #{order}. Can I exchange it for one size up?", "normal"],
  ["Discount code not working", "The code TRAIL15 says it's invalid at checkout. Is it still active?", "low"],
  ["Zipper broke after one trip", "The main zipper on my purchase from order #{order} broke on the first trip. Is this covered by warranty?", "normal"],
  ["Cancel my order", "Please cancel order #{order}, I ordered twice by mistake.", "high"],
  ["Invoice for my company", "Could you send a VAT invoice for order #{order}? Our accounting needs it this week.", "low"],
  ["Item missing from package", "My package for order #{order} arrived but one item is missing.", "high"],
];

const REFUND_REASONS = ["Item damaged in transit", "Wrong size", "Changed mind", "Arrived too late", "Defective zipper"];

export function seed(db: DatabaseSync, now = Date.now()) {
  const rand = mulberry32(20261016);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)]!;
  const weighted = <T>(items: readonly T[], weight: (item: T) => number) => {
    const total = items.reduce((sum, item) => sum + weight(item), 0);
    let roll = rand() * total;
    for (const item of items) {
      roll -= weight(item);
      if (roll <= 0) return item;
    }
    return items[items.length - 1]!;
  };
  const iso = (time: number) => new Date(time).toISOString();
  const money = (value: number) => Math.round(value * 100) / 100;

  db.exec("BEGIN");
  try {
    // Products -------------------------------------------------------------
    const insertProduct = db.prepare(
      "INSERT INTO products (id, sku, name, category, price, cost, stock, reorder_level, supplier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const products = PRODUCTS.map(([name, category, price, popularity, supplier], i) => {
      const id = i + 1;
      const sku = `${category.slice(0, 3).toUpperCase()}-${String(100 + id).padStart(4, "0")}`;
      const [stock, reorder] = STOCK_STORY[name] ?? [Math.round(30 + rand() * 150), Math.round(10 + popularity * 2)];
      insertProduct.run(id, sku, name, category, price, money(price * (0.42 + rand() * 0.12)), stock, reorder, supplier);
      return { id, name, category, price, popularity };
    });
    const productByName = (name: string) => products.find((p) => p.name === name)!;

    // Customers ----------------------------------------------------------------
    const insertCustomer = db.prepare(
      "INSERT INTO customers (id, name, email, phone, country, city, segment, marketing_opt_in, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    type Customer = { id: number; name: string; email: string; country: string; segment: string };
    const customers: Customer[] = [];
    const usedEmails = new Set<string>();
    const addCustomer = (name: string, email: string, country: string, city: string, segment: string, phonePrefix: string, createdAt: number) => {
      const id = customers.length + 1;
      const phone = `${phonePrefix}${String(Math.floor(rand() * 100)).padStart(2, "0")}${segment === "wholesale" ? "" : ""}`;
      insertCustomer.run(id, name, email, phone, country, city, segment, rand() < 0.6 ? 1 : 0, iso(createdAt));
      customers.push({ id, name, email, country, segment });
      usedEmails.add(email);
      return customers[customers.length - 1]!;
    };

    const jane = addCustomer("Jane Cooper", "jane.cooper@example.com", "US", "Denver", "vip", "+1 555-01", now - 600 * DAY);
    const liam = addCustomer("Liam Novak", "liam.novak@example.com", "DE", "Munich", "regular", "+49 30 5550 0", now - 300 * DAY);
    const coop = addCustomer("Peak Outfitters Co-op", "orders@peak-coop.example.org", "CA", "Calgary", "wholesale", "+1 555-01", now - 700 * DAY);

    while (customers.length < 160) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const [country, cities, , prefix] = weighted(PLACES, (p) => p[2]);
      const base = `${first}.${last}`.toLowerCase().normalize("NFD").replace(/[^a-z.]/g, "");
      let email = `${base}@${pick(["example.com", "example.org", "example.net"])}`;
      if (usedEmails.has(email)) email = `${base}${customers.length}@example.com`;
      const segment = weighted(["new", "regular", "vip", "wholesale"] as const, (s) => ({ new: 30, regular: 52, vip: 12, wholesale: 6 })[s]);
      const name = segment === "wholesale" ? `${last} ${pick(["Outdoor Supply", "Mountain Shop", "Trail Co."])}` : `${first} ${last}`;
      addCustomer(name, email, country, pick(cities), segment, prefix, now - Math.floor(rand() * 720) * DAY);
    }

    // Orders -------------------------------------------------------------------
    const insertOrder = db.prepare(
      `INSERT INTO orders (id, customer_id, status, channel, subtotal, shipping, discount, total, discount_code, shipping_country, carrier, tracking_number, created_at, shipped_at, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertItem = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)");
    const insertRefund = db.prepare("INSERT INTO refunds (order_id, amount, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)");

    type Order = { id: number; customer: Customer; status: string; createdAt: number; total: number };
    const orders: Order[] = [];
    let nextOrderId = 1001;

    const createOrder = (
      customer: Customer,
      createdAt: number,
      lines: { productId: number; quantity: number; price: number }[],
      forced?: { status?: string; carrier?: string },
    ): Order => {
      const id = nextOrderId++;
      const subtotal = money(lines.reduce((sum, l) => sum + l.price * l.quantity, 0));
      const shipping = subtotal >= 100 ? 0 : 9.95;
      const code = rand() < 0.1 ? pick(["WELCOME10", "TRAIL15"]) : null;
      const discount = code ? money(subtotal * (code === "WELCOME10" ? 0.1 : 0.15)) : 0;
      const total = money(subtotal + shipping - discount);
      const ageDays = (now - createdAt) / DAY;
      const channel = customer.segment === "wholesale" ? "web" : weighted(["web", "mobile", "marketplace"] as const, (c) => ({ web: 68, mobile: 22, marketplace: 10 })[c]);

      let status = forced?.status ?? "paid";
      let carrier: string | null = null;
      let tracking: string | null = null;
      let shippedAt: number | null = null;
      let deliveredAt: number | null = null;
      if (!forced?.status) {
        if (ageDays < 0.75) status = rand() < 0.25 ? "pending" : "paid";
        else if (ageDays < 1.5) status = "paid";
        else status = rand() < 0.03 ? "cancelled" : "shipped";
      }
      if (status === "shipped" || status === "delivered") {
        carrier = forced?.carrier ?? (customer.country === "US" ? weighted(["UPS", "FedEx", "USPS"], (c) => ({ UPS: 45, FedEx: 30, USPS: 25 })[c]!) : weighted(["DHL", "UPS", "FedEx"], (c) => ({ DHL: 55, UPS: 30, FedEx: 15 })[c]!));
        shippedAt = createdAt + DAY + Math.floor(rand() * 6) * 3_600_000;
        tracking = trackingNumber(carrier, shippedAt, Math.floor(rand() * 1_000_000), undefined, now);
        const progress = shipmentProgress(tracking, now)!;
        if (progress.deliveredAt) {
          status = "delivered";
          deliveredAt = progress.deliveredAt;
        } else status = "shipped";
      }

      insertOrder.run(id, customer.id, status, channel, subtotal, shipping, discount, total, code, customer.country, carrier, tracking, iso(createdAt), shippedAt ? iso(shippedAt) : null, deliveredAt ? iso(deliveredAt) : null);
      for (const line of lines) insertItem.run(id, line.productId, line.quantity, line.price);

      const order = { id, customer, status, createdAt, total };
      orders.push(order);
      return order;
    };

    type Plan = { customer: Customer; createdAt: number; lines: { productId: number; quantity: number; price: number }[]; forced?: { status?: string; carrier?: string }; story?: string };
    const plans: Plan[] = [];
    for (let day = HISTORY_DAYS; day >= 0; day--) {
      const dayStart = now - day * DAY;
      const weekday = new Date(dayStart).getUTCDay();
      const trend = 1 + (HISTORY_DAYS - day) * 0.003;
      const weekend = weekday === 0 || weekday === 6 ? 1.3 : 1;
      const count = Math.round((9 + rand() * 5) * trend * weekend);
      for (let n = 0; n < count; n++) {
        const createdAt = dayStart - Math.floor(rand() * DAY);
        if (createdAt > now) continue;
        const customer = weighted(customers, (c) => ({ new: 1, regular: 2, vip: 5, wholesale: 3 })[c.segment] ?? 1);
        const lineCount = weighted([1, 2, 3], (k) => ({ 1: 55, 2: 30, 3: 15 })[k]!);
        const chosen = new Set<number>();
        const lines = [];
        for (let l = 0; l < lineCount; l++) {
          const product = weighted(products, (p) => p.popularity);
          if (chosen.has(product.id)) continue;
          chosen.add(product.id);
          const quantity = customer.segment === "wholesale" ? 4 + Math.floor(rand() * 12) : product.price < 40 && rand() < 0.4 ? 2 : 1;
          lines.push({ productId: product.id, quantity, price: customer.segment === "wholesale" ? money(product.price * 0.7) : product.price });
        }
        plans.push({ customer, createdAt, lines });
      }
    }

    // Storylines -----------------------------------------------------------------
    plans.push(
      {
        story: "jane",
        customer: jane,
        createdAt: now - 4.5 * DAY,
        lines: [
          { productId: productByName("Ridgeline 2P Tent").id, quantity: 1, price: 329 },
          { productId: productByName("Cloudrest Inflatable Pad").id, quantity: 1, price: 119 },
        ],
        forced: { status: "delivered", carrier: "UPS" },
      },
      {
        story: "liam",
        customer: liam,
        createdAt: now - 5.2 * DAY,
        lines: [
          { productId: productByName("Summit 65L Pack").id, quantity: 1, price: 249 },
          { productId: productByName("Stormline Rain Shell").id, quantity: 1, price: 199 },
        ],
        forced: { status: "shipped", carrier: "DHL" },
      },
      {
        story: "coop",
        customer: coop,
        createdAt: now - 0.3 * DAY,
        lines: [
          { productId: productByName("Headlamp 400lm").id, quantity: 40, price: 34.3 },
          { productId: productByName("Fuel Canister 230g").id, quantity: 120, price: 5.25 },
          { productId: productByName("Trail Water Filter").id, quantity: 24, price: 34.3 },
        ],
        forced: { status: "paid" },
      },
    );

    // Insert in time order so order numbers increase with the date, like a real store.
    plans.sort((a, b) => a.createdAt - b.createdAt);
    const stories: Record<string, Order> = {};
    for (const plan of plans) {
      const order = createOrder(plan.customer, plan.createdAt, plan.lines, plan.forced);
      if (plan.story) stories[plan.story] = order;
    }
    const janeOrder = stories.jane!;
    const liamOrder = stories.liam!;

    // Refunds on some delivered orders
    for (const order of orders) {
      if (order.status !== "delivered" || order.customer === jane || rand() > 0.035) continue;
      db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(order.id);
      order.status = "refunded";
      insertRefund.run(order.id, order.total, pick(REFUND_REASONS), pick(["Olivia Hart", "Marcus Lee"]), iso(order.createdAt + 7 * DAY));
    }

    // Delivered roughly a day ago, before Jane wrote in. The carrier must agree.
    const janeShipped = now - 3.5 * DAY;
    const janeTracking = trackingNumber(
      "UPS",
      janeShipped,
      482_913,
      (p) => p.status === "delivered" && p.deliveredAt! <= now - 20 * 3_600_000 && p.deliveredAt! >= now - 40 * 3_600_000,
      now,
    );
    db.prepare("UPDATE orders SET status = 'delivered', carrier = 'UPS', tracking_number = ?, shipped_at = ?, delivered_at = ? WHERE id = ?").run(
      janeTracking,
      iso(janeShipped),
      iso(shipmentProgress(janeTracking, now)!.deliveredAt!),
      janeOrder.id,
    );

    const liamShipped = now - 4.1 * DAY;
    db.prepare("UPDATE orders SET carrier = 'DHL', tracking_number = ?, shipped_at = ?, delivered_at = NULL, status = 'shipped' WHERE id = ?").run(
      trackingNumber("DHL", liamShipped, 771_204, (p) => p.status === "delayed", now),
      iso(liamShipped),
      liamOrder.id,
    );

    // Tickets ---------------------------------------------------------------------
    const insertTicket = db.prepare(
      "INSERT INTO tickets (customer_id, order_id, subject, body, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertReply = db.prepare("INSERT INTO ticket_replies (ticket_id, author, body, created_at) VALUES (?, ?, ?, ?)");
    const eligible = orders.filter((o) => o.status !== "pending" && now - o.createdAt < 60 * DAY && o !== janeOrder && o !== liamOrder);
    for (let i = 0; i < 38; i++) {
      const order = pick(eligible);
      const [subject, body, priority] = pick(TICKET_TEMPLATES);
      const createdAt = Math.min(now - 0.1 * DAY, order.createdAt + (1 + rand() * 6) * DAY);
      const age = (now - createdAt) / DAY;
      const status = age > 6 ? (rand() < 0.85 ? "closed" : "pending") : weighted(["open", "pending", "closed"], (s) => ({ open: 50, pending: 25, closed: 25 })[s]!);
      const result = insertTicket.run(order.customer.id, order.id, subject, body.replace("{order}", String(order.id)), status, priority, iso(createdAt), iso(createdAt + (status === "open" ? 0 : DAY)));
      if (status !== "open") {
        insertReply.run(Number(result.lastInsertRowid), "Marcus Lee", "Thanks for reaching out! I'm looking into this now and will update you shortly.", iso(createdAt + 0.2 * DAY));
      }
    }
    insertTicket.run(
      jane.id,
      janeOrder.id,
      "Tent arrived with a torn rainfly",
      `Hi, my Ridgeline 2P tent from order #${janeOrder.id} arrived yesterday and the rainfly has a 10 cm tear along the seam. I'm leaving for a trip on Saturday. Can you send a replacement or refund it? Photos attached. Jane`,
      "open",
      "urgent",
      iso(now - 0.6 * DAY),
      iso(now - 0.6 * DAY),
    );
    insertTicket.run(
      liam.id,
      liamOrder.id,
      "Package stuck for days",
      `Hallo, order #${liamOrder.id} was shipped four days ago but DHL tracking still says "in transit, delayed". I need the backpack for a hike next week. Liam`,
      "open",
      "high",
      iso(now - 0.9 * DAY),
      iso(now - 0.9 * DAY),
    );

    // Discount codes, inventory history, audit log -----------------------------------
    const insertCode = db.prepare(
      "INSERT INTO discount_codes (code, percent, usage_limit, times_used, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    insertCode.run("WELCOME10", 10, 10000, 412, iso(now + 200 * DAY), "Olivia Hart", iso(now - 300 * DAY));
    insertCode.run("TRAIL15", 15, 500, 500, iso(now + 30 * DAY), "Olivia Hart", iso(now - 45 * DAY));
    insertCode.run("VIP20", 20, 200, 37, iso(now + 90 * DAY), "Olivia Hart", iso(now - 20 * DAY));
    insertCode.run("SUMMER25", 25, 1000, 655, iso(now - 25 * DAY), "Olivia Hart", iso(now - 120 * DAY));

    const insertMovement = db.prepare("INSERT INTO inventory_movements (product_id, delta, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)");
    insertMovement.run(productByName("Ridgeline 2P Tent").id, 60, "Restock PO-2291", "Olivia Hart", iso(now - 21 * DAY));
    insertMovement.run(productByName("Summit Down Jacket").id, 40, "Restock PO-2304", "Olivia Hart", iso(now - 34 * DAY));

    const insertAudit = db.prepare("INSERT INTO audit_log (at, actor, action, details, via) VALUES (?, ?, ?, ?, ?)");
    insertAudit.run(iso(now - 2 * DAY), "Olivia Hart", "create_discount_code", '{"code":"VIP20","percent":20}', "chat");
    insertAudit.run(iso(now - 1.2 * DAY), "Marcus Lee", "refund_order", `{"orderId":${orders[orders.length - 40]!.id},"amount":24.5}`, "chat");

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
