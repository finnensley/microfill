import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { Database } from "@/types/supabase";
import type { WmsProvider } from "@/services/wms-adapters/types";

/** All supported integration providers. Sourced from the WMS adapter registry. */
export type IntegrationProvider = WmsProvider;

type IntegrationRow = Database["public"]["Tables"]["integrations"]["Row"];

type IntegrationLookupParams = {
  provider: IntegrationProvider;
  tenantId?: string | null;
  externalAccountId?: string | null;
  externalShopDomain?: string | null;
  includeDraft?: boolean;
};

function normalizeShopDomain(domain?: string | null) {
  if (!domain) {
    return null;
  }

  return domain.trim().toLowerCase();
}

async function lookupIntegration(
  column: "tenant_id" | "external_account_id" | "external_shop_domain",
  value: string,
  provider: IntegrationProvider,
  includeDraft: boolean,
) {
  const supabase = createServerSupabaseClient();
  const statuses = includeDraft ? ["active", "draft"] : ["active"];

  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("provider", provider)
    .eq(column, value)
    .in("status", statuses)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to resolve integration: ${error.message}`);
  }

  return data;
}

export async function resolveIntegration(
  params: IntegrationLookupParams,
): Promise<IntegrationRow | null> {
  const includeDraft = params.includeDraft ?? false;

  if (params.tenantId) {
    const byTenant = await lookupIntegration(
      "tenant_id",
      params.tenantId,
      params.provider,
      includeDraft,
    );

    if (byTenant) {
      return byTenant;
    }
  }

  if (params.externalAccountId) {
    const byExternalAccountId = await lookupIntegration(
      "external_account_id",
      params.externalAccountId,
      params.provider,
      includeDraft,
    );

    if (byExternalAccountId) {
      return byExternalAccountId;
    }
  }

  const normalizedShopDomain = normalizeShopDomain(params.externalShopDomain);

  if (normalizedShopDomain) {
    const byShopDomain = await lookupIntegration(
      "external_shop_domain",
      normalizedShopDomain,
      params.provider,
      includeDraft,
    );

    if (byShopDomain) {
      return byShopDomain;
    }
  }

  return null;
}
