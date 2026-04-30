import { Database } from "@/types/supabase";
import type { WmsProvider } from "@/services/wms-adapters/types";

export type { WmsProvider };

/**
 * Subset of WmsProvider values that are actively managed through the dashboard UI.
 * Not all registered WMS adapters need a managed integration record.
 */
export type ManagedIntegrationProvider = Extract<
  WmsProvider,
  "shopify" | "shiphero"
>;

export const managedIntegrationProviders: ManagedIntegrationProvider[] = [
  "shopify",
  "shiphero",
];

type IntegrationRow = Database["public"]["Tables"]["integrations"]["Row"];

export type ManagedIntegrationRecord = Omit<IntegrationRow, "provider"> & {
  provider: ManagedIntegrationProvider;
};
