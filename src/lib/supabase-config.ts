const missingEnvMessage =
  'Missing Supabase environment variables. For local Docker development, run "npm run supabase:start", then "npm run supabase:env" and copy the printed values into .env.local.';

const publicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(missingEnvMessage);
  }

  return value;
}

export function getSupabaseUrl() {
  if (!publicSupabaseUrl) {
    throw new Error(missingEnvMessage);
  }

  return publicSupabaseUrl;
}

export function getSupabaseAnonKey() {
  if (!publicSupabaseAnonKey) {
    throw new Error(missingEnvMessage);
  }

  return publicSupabaseAnonKey;
}

export function getSupabaseServiceRoleKey() {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function getShopifyWebhookSecret() {
  return requireEnv("SHOPIFY_WEBHOOK_SECRET");
}

export function getShipHeroWebhookSecret() {
  return requireEnv("SHIPHERO_WEBHOOK_SECRET");
}
