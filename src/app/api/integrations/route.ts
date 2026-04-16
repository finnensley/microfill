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

async function getResolvedTenantId(req: Request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      tenantId: null,
    };
  }

  const resolvedTenantId = await getTenantIdForUser(user);

  if (!resolvedTenantId) {
    return {
      error: NextResponse.json(
        {
          error:
            "No tenant is configured for this user. Complete onboarding or assign app_metadata.tenant_id for the user.",
        },
        { status: 409 },
      ),
      tenantId: null,
    };
  }

  const requestUrl = new URL(req.url);
  const requestedTenantId = requestUrl.searchParams.get("tenantId");

  if (requestedTenantId && requestedTenantId !== resolvedTenantId) {
    return {
      error: NextResponse.json(
        { error: "Requested tenant does not match the signed-in user." },
        { status: 403 },
      ),
      tenantId: null,
    };
  }

  return { error: null, tenantId: resolvedTenantId };
}

export async function GET(req: Request) {
  const tenantResult = await getResolvedTenantId(req);

  if (tenantResult.error || !tenantResult.tenantId) {
    return tenantResult.error;
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

  if (tenantResult.error || !tenantResult.tenantId) {
    return tenantResult.error;
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
    .select("id")
    .eq("tenant_id", tenantResult.tenantId)
    .eq("provider", provider)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }

  const payload = {
    api_key: normalizeOptionalText(body.apiKey),
    api_secret: normalizeOptionalText(body.apiSecret),
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
