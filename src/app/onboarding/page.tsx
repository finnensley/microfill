import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/forms/logout-button";
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
    .from("tenants")
    .select("id, name, slug")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Unable to load tenant options: ${error.message}`);
  }

  const tenantOptions = (data ?? []).map((tenant) => ({
    tenantId: tenant.id,
    label: tenant.slug ? `${tenant.name} (${tenant.slug})` : tenant.name,
  }));

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-12">
      <div className="w-full max-w-xl space-y-4">
        <div className="flex justify-end">
          <LogoutButton />
        </div>

        <TenantOnboardingForm
          defaultTenantId={getDefaultTenantId()}
          email={user.email ?? null}
          tenantOptions={tenantOptions}
        />
      </div>
    </main>
  );
}
