import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  getAuthenticatedUser,
  getTenantIdForUser,
} from "@/lib/supabase-auth-server";
import {
  managedIntegrationProviders,
  ManagedIntegrationProvider,
  ManagedIntegrationRecord,
} from "@/types/integrations";

type IntegrationStatus = "draft" | "active" | "disabled" | "error";

type IntegrationUpdateBody = {
  apiKey?: string;
  apiSecret?: string;
  displayName?: string;
  externalAccountId?: string;
  externalShopDomain?: string;
  provider?: ManagedIntegrationProvider;
  shopifyLocationId?: string;
  status?: IntegrationStatus;
  webhookSecret?: string;
};

const validStatuses: IntegrationStatus[] = [
  "draft",
  "active",
  "disabled",
  "error",
];

function normalizeOptionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeShopDomain(value?: string) {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.toLowerCase() : null;
}

type ResolvedTenantResult =
  | {
      ok: true;
      tenantId: string;
    }
  | {
      ok: false;
      response: NextResponse<{ error: string }>;
    };

async function getResolvedTenantId(
  req: Request,
): Promise<ResolvedTenantResult> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const resolvedTenantId = await getTenantIdForUser(user);

  if (!resolvedTenantId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "No tenant is configured for this user. Complete onboarding or assign app_metadata.tenant_id for the user.",
        },
        { status: 409 },
      ),
    };
  }

  const requestUrl = new URL(req.url);
  const requestedTenantId = requestUrl.searchParams.get("tenantId");

  if (requestedTenantId && requestedTenantId !== resolvedTenantId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Requested tenant does not match the signed-in user." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    tenantId: resolvedTenantId,
  };
}

export async function GET(req: Request) {
  const tenantResult = await getResolvedTenantId(req);

  if (!tenantResult.ok) {
    return tenantResult.response;
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("tenant_id", tenantResult.tenantId)
    .in("provider", managedIntegrationProviders)
    .order("provider", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    integrations: (data ?? []) as ManagedIntegrationRecord[],
    tenantId: tenantResult.tenantId,
  });
}

export async function PATCH(req: Request) {
  const tenantResult = await getResolvedTenantId(req);

  if (!tenantResult.ok) {
    return tenantResult.response;
  }

  const body = (await req.json()) as IntegrationUpdateBody;

  if (!body.provider || !managedIntegrationProviders.includes(body.provider)) {
    return NextResponse.json(
      { error: "provider must be either shopify or shiphero." },
      { status: 400 },
    );
  }

  if (!body.status || !validStatuses.includes(body.status)) {
    return NextResponse.json(
      { error: "status must be draft, active, disabled, or error." },
      { status: 400 },
    );
  }

  const provider = body.provider as ManagedIntegrationProvider;
  const normalizedExternalAccountId = normalizeOptionalText(
    body.externalAccountId,
  );
  const normalizedShopDomain = normalizeShopDomain(body.externalShopDomain);

  if (
    provider === "shopify" &&
    body.status === "active" &&
    !normalizedShopDomain
  ) {
    return NextResponse.json(
      { error: "Active Shopify integrations require an external shop domain." },
      { status: 400 },
    );
  }

  if (
    provider === "shiphero" &&
    body.status === "active" &&
    !normalizedExternalAccountId
  ) {
    return NextResponse.json(
      { error: "Active ShipHero integrations require an external account ID." },
      { status: 400 },
    );
  }

  const supabase = createServerSupabaseClient();
  const { data: existingIntegration, error: lookupError } = await supabase
    .from("integrations")
    .select("id, config")
    .eq("tenant_id", tenantResult.tenantId)
    .eq("provider", provider)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }

  // Merge provider-specific config fields into the existing config JSONB
  const existingConfig =
    (existingIntegration?.config as Record<string, unknown> | null) ?? {};
  const mergedConfig: Record<string, unknown> = { ...existingConfig };

  if (provider === "shopify" && body.shopifyLocationId !== undefined) {
    const locationId = body.shopifyLocationId?.trim();
    mergedConfig.shopifyLocationId = locationId || null;
  }

  const payload = {
    api_key: normalizeOptionalText(body.apiKey),
    api_secret: normalizeOptionalText(body.apiSecret),
    config: mergedConfig,
    display_name: normalizeOptionalText(body.displayName),
    external_account_id: normalizedExternalAccountId,
    external_shop_domain: provider === "shopify" ? normalizedShopDomain : null,
    provider,
    status: body.status,
    tenant_id: tenantResult.tenantId,
    webhook_secret: normalizeOptionalText(body.webhookSecret),
  };

  const builder = existingIntegration
    ? supabase
        .from("integrations")
        .update(payload)
        .eq("id", existingIntegration.id)
        .eq("tenant_id", tenantResult.tenantId)
    : supabase.from("integrations").insert(payload);

  const { data, error } = await builder.select("*").single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    integration: data as ManagedIntegrationRecord,
    tenantId: tenantResult.tenantId,
  });
}
