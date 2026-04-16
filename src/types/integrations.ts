import { Database } from "@/types/supabase";

export type ManagedIntegrationProvider = "shopify" | "shiphero";

export const managedIntegrationProviders: ManagedIntegrationProvider[] = [
  "shopify",
  "shiphero",
];

type IntegrationRow = Database["public"]["Tables"]["integrations"]["Row"];

export type ManagedIntegrationRecord = Omit<IntegrationRow, "provider"> & {
  provider: ManagedIntegrationProvider;
};
