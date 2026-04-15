"use client";
import { useInventory } from "@/hooks/use-inventory";

interface InventoryDashboardProps {
  tenantId: string | null;
}

export default function InventoryDashboard({
  tenantId,
}: InventoryDashboardProps) {
  const { items, loading, error } = useInventory(tenantId || undefined);

  if (loading) return <p>Loading Warehouse Data...</p>;

  if (error) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
        <p className="font-semibold">Inventory unavailable</p>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-slate-700">
        No inventory records found for tenant {tenantId}.
      </div>
    );
  }

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
