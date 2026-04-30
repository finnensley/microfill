/**
 * Fishbowl Inventory — payload shape stubs.
 *
 * Fishbowl uses a REST API or CSV exports rather than real-time webhooks,
 * so these types represent the data structures MicroFill would receive
 * after a polling/push integration layer normalises Fishbowl events.
 *
 * Fill in the real field names when the integration is wired up.
 * Reference: https://www.fishbowlinventory.com/api/
 */

export interface FishbowlReceivingEvent {
  event_type: "receiving";
  po_number: string;
  warehouse: string;
  items: FishbowlReceivingLineItem[];
}

export interface FishbowlReceivingLineItem {
  part_number: string;
  quantity_received: number;
}

export interface FishbowlShipmentEvent {
  event_type: "shipment";
  so_number: string;
  warehouse: string;
  items: FishbowlShipmentLineItem[];
}

export interface FishbowlShipmentLineItem {
  part_number: string;
  quantity_shipped: number;
}

export type FishbowlWebhookPayload =
  | FishbowlReceivingEvent
  | FishbowlShipmentEvent;
