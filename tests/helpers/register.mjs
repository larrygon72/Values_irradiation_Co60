import { register } from "node:module";
register("./loader.mjs", import.meta.url);
process.env.AUTH_SECRET ||= "test-secret-test-secret-test-secret-123456";
process.env.SUPABASE_URL ||= "http://fake";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "fake";
