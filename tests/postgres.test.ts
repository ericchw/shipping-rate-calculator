import { it } from "vitest";
import { Store } from "../src/lib/db";
import { profileContract } from "./profiles.test";
it.skipIf(!process.env.TEST_POSTGRES_URL)(
  "PostgreSQL equivalent profile contract (dedicated test database)",
  async () => {
    const s = new Store("postgresql", process.env.TEST_POSTGRES_URL!);
    try {
      await profileContract(s);
    } finally {
      await s.close();
    }
  },
);
