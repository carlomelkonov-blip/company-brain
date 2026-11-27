// Load the repo's .env for local runs; CI provides the same variables directly.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
} catch {
  // no .env: rely on the environment
}
process.env.SESSION_SECRET ??= "test-only-session-secret-0123456789";
// Tests are deterministic: never call the AI provider.
process.env.ANTHROPIC_API_KEY = "";
