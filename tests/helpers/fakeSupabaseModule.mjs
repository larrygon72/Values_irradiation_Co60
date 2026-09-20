import { createFakeDb } from "./fakeSupabase.mjs";
globalThis.__FAKE_DB__ ||= createFakeDb();
export function createClient() { return globalThis.__FAKE_DB__; }
