import { redirect } from "next/navigation";
import { TenantOnboardingForm } from "@/components/forms/tenant-onboarding-form";
import {
  getDefaultTenantId,
  getTenantIdForUser,
  requireAuthenticatedUser,
} from "@/lib/supabase-auth-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export default async function OnboardingPage() {
  const user = await requireAuthenticatedUser();
  const tenantId = await getTenantIdForUser(user);

  if (tenantId) {
    redirect("/dashboard");
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_items")
    .select("tenant_id, sku, shopify_product_id")
    .order("tenant_id", { ascending: true });

  if (error) {
    throw new Error(`Unable to load tenant options: ${error.message}`);
  }

  const tenantOptions = Array.from(
    new Map(
      (data ?? []).map((item) => [
        item.tenant_id,
        {
          tenantId: item.tenant_id,
          label: `${item.tenant_id} (${item.sku || item.shopify_product_id})`,
        },
      ]),
    ).values(),
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-12">
      <TenantOnboardingForm
        defaultTenantId={getDefaultTenantId()}
        email={user.email ?? null}
        tenantOptions={tenantOptions}
      />
    </main>
  );
}
