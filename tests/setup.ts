import { afterEach } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54323";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.SHOPIFY_WEBHOOK_SECRET ??= "test-shopify-secret";
process.env.SHIPHERO_WEBHOOK_SECRET ??= "test-shiphero-secret";

afterEach(() => {
  delete process.env.DEFAULT_TENANT_ID;
});
