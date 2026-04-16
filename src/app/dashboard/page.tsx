import InventoryDashboard from "@/components/ui/dashboard";
import { LogoutButton } from "@/components/forms/logout-button";
import { redirect } from "next/navigation";
import {
  getTenantIdForUser,
  requireAuthenticatedUser,
} from "@/lib/supabase-auth-server";

export default async function DashboardPage() {
  const user = await requireAuthenticatedUser();
  const tenantId = await getTenantIdForUser(user);

  if (!tenantId) {
    redirect("/onboarding");
  }

  return (
    <main className="min-h-screen bg-slate-100 px-6 py-10 text-slate-950">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">
              Protected Dashboard
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Inventory Overview
            </h1>
            <p className="text-sm text-slate-600">Signed in as {user.email}</p>
            <p className="text-sm text-slate-600">Tenant: {tenantId}</p>
          </div>

          <LogoutButton />
        </header>

        <InventoryDashboard tenantId={tenantId} />
      </div>
    </main>
  );
}
