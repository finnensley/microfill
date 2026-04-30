#!/usr/bin/env node
/**
 * Pre-deploy environment variable check.
 * Fails with a non-zero exit code and a clear list of missing vars
 * so that CI or manual deploy steps catch misconfig before deployment.
 *
 * Usage:
 *   node scripts/check-deploy-env.mjs
 *   npm run deploy:check
 */

const REQUIRED_VARS = [
  // Supabase
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  // Webhook HMAC secrets
  "SHOPIFY_WEBHOOK_SECRET",
  "SHIPHERO_WEBHOOK_SECRET",
  // Queue worker auth
  "CRON_SECRET",
];

const missing = REQUIRED_VARS.filter((v) => !process.env[v]);

if (missing.length > 0) {
  console.error("❌  Missing required environment variables:\n");
  missing.forEach((v) => console.error(`   • ${v}`));
  console.error(
    "\nSet these in your Vercel project settings (or .env.local for local dev) before deploying.",
  );
  process.exit(1);
}

console.log("✅  All required environment variables are set.");
