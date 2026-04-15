"use client";
import { useInventory } from "@/hooks/use-inventory";

export default function InventoryDashboard() {
  const { items, loading } = useInventory();

  if (loading) return <p>Loading Warehouse Data...</p>;

  return (
    <div className="grid gap-4">
      {items.map((item) => {
        const availableToSell =
          item.total_quantity -
          item.committed_quantity -
          item.safety_floor_quantity;

        return (
          <div key={item.id} className="p-4 border rounded shadow-sm bg-white">
            <h3 className="font-bold">{item.sku || item.shopify_product_id}</h3>
            <div className="flex justify-between mt-2 text-sm">
              <span>On-Hand: {item.total_quantity}</span>
              <span className="text-blue-600">
                Committed: {item.committed_quantity}
              </span>
              <span className="text-green-600 font-bold">
                Available: {availableToSell}
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Safety Floor: {item.safety_floor_quantity} | Flash Mode:{" "}
              {item.flash_mode_enabled ? "On" : "Off"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
