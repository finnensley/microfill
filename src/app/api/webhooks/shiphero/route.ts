import { NextResponse } from "next/server";
import crypto from "crypto";
import { ShipHeroPOUpdate, ShipHeroShipmentUpdate } from "@/types/shiphero";
import {
  processSyncEventsBatch,
  InventoryEvent,
} from "@/services/inventory-sync";

// ShipHero Webhook Secret from ShipHero Dashboard
const SHIPHERO_WEBHOOK_SECRET = process.env.SHIPHERO_WEBHOOK_SECRET!;

/**
 * ShipHero Webhook Handler
 *
 * Normalizes ShipHero payloads and delegates to generic inventory sync service
 * This keeps the handler lightweight and allows all WMS to share sync logic
 */
export async function POST(req: Request) {
  try {
    // 1. Get raw body for HMAC verification
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("x-shiphero-webhook-signature");

    // 2. Verify HMAC signature - Prevent unauthorized webhook calls
    if (!hmacHeader) {
      console.error("Missing ShipHero HMAC header");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const generatedHash = crypto
      .createHmac("sha256", SHIPHERO_WEBHOOK_SECRET)
      .update(rawBody, "utf8")
      .digest("base64");

    // 3. Security Check: Compare hashes
    if (generatedHash !== hmacHeader) {
      console.error("Invalid ShipHero Webhook Signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 4. Parse and normalize based on webhook type
    const body = JSON.parse(rawBody);

    if (body.webhook_type === "PO Update") {
      return handlePOUpdate(body as ShipHeroPOUpdate);
    } else if (body.webhook_type === "Shipment Update") {
      return handleShipmentUpdate(body as ShipHeroShipmentUpdate);
    }

    return NextResponse.json(
      { message: "Webhook type not handled" },
      { status: 200 },
    );
  } catch (err) {
    console.error("ShipHero Webhook Error:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

/**
 * Normalize ShipHero PO Update to generic InventoryEvent
 */
async function handlePOUpdate(body: ShipHeroPOUpdate) {
  if (!body.line_items || body.line_items.length === 0) {
    return NextResponse.json(
      { message: "No items to process" },
      { status: 200 },
    );
  }

  // Transform ShipHero payload to generic events
  const events: InventoryEvent[] = body.line_items.map((item) => ({
    type: "stock_received" as const,
    sku: item.sku,
    quantity: item.quantity_received,
    source: "shiphero" as const,
    externalId: body.po_number,
  }));

  // Process using shared service
  const result = await processSyncEventsBatch(events);

  return NextResponse.json(
    {
      message: "PO synced",
      verified: true,
      po_number: body.po_number,
      ...result,
    },
    { status: 200 },
  );
}

/**
 * Normalize ShipHero Shipment Update to generic InventoryEvent
 */
async function handleShipmentUpdate(body: ShipHeroShipmentUpdate) {
  if (!body.line_items || body.line_items.length === 0) {
    return NextResponse.json(
      { message: "No items to process" },
      { status: 200 },
    );
  }

  // Transform ShipHero payload to generic events
  const events: InventoryEvent[] = body.line_items.map((item) => ({
    type: "stock_shipped" as const,
    sku: item.sku,
    quantity: item.quantity,
    source: "shiphero" as const,
    externalId: body.order_number,
  }));

  // Process using shared service
  const result = await processSyncEventsBatch(events);

  return NextResponse.json(
    {
      message: "Shipment synced",
      verified: true,
      tracking: body.tracking_number,
      ...result,
    },
    { status: 200 },
  );
}
