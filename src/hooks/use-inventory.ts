import { useCallback, useEffect, useState } from "react";
import { InventoryItem } from "@/types/inventory";

const DEFAULT_PAGE_SIZE = 10;

/**
 * Hook to fetch and subscribe to inventory items with server-side pagination.
 */
export function useInventory(tenantId?: string) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = DEFAULT_PAGE_SIZE;

  const fetchInventory = useCallback(
    async (targetPage: number = 1) => {
      if (!tenantId) {
        setItems([]);
        setTotal(0);
        setError(
          "No tenant is configured for this account yet. Complete onboarding or assign app_metadata.tenant_id for the user.",
        );
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const url = new URL("/api/inventory", window.location.origin);
        url.searchParams.set("tenantId", tenantId);
        url.searchParams.set("page", String(targetPage));
        url.searchParams.set("pageSize", String(pageSize));

        const response = await fetch(url.toString());
        const responseText = await response.text();
        const payload = (responseText ? JSON.parse(responseText) : {}) as {
          error?: string;
          items?: InventoryItem[];
          total?: number;
          page?: number;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load inventory");
        }

        setItems(payload.items ?? []);
        setTotal(payload.total ?? 0);
        setPage(payload.page ?? targetPage);
        setError(null);
      } catch (err) {
        console.error("Error fetching inventory:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [tenantId, pageSize],
  );

  useEffect(() => {
    void fetchInventory(1);
  }, [fetchInventory]);

  const goToPage = useCallback(
    (nextPage: number) => {
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const clamped = Math.min(Math.max(1, nextPage), totalPages);
      setPage(clamped);
      void fetchInventory(clamped);
    },
    [fetchInventory, total, pageSize],
  );

  const refresh = useCallback(() => {
    void fetchInventory(page);
  }, [fetchInventory, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    items,
    loading,
    error,
    page,
    pageSize,
    total,
    totalPages,
    goToPage,
    refresh,
  };
}
