"use client";
import { useInventory } from "@/hooks/use-inventory";

export default function InventoryDashboard() {
  const { items, loading } = useInventory();

  if (loading) return <p>Loading Warehouse Data...</p>;

  return (
    <div className="grid gap-4">
      {items.map((item) => (
        <div key={item.id} className="p-4 border rounded shadow-sm bg-white">
          <h3 className="font-bold">{item.product_id}</h3>
          <div className="flex justify-between mt-2 text-sm">
            <span>On-Hand: **{item.physical_quantity}**</span>
            <span className="text-blue-600">
              Committed: **{item.committed_quantity}**
            </span>
            <span className="text-green-600 font-bold">
              Available: **{item.available_to_sell}**
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
