import { Store } from "../src/lib/db";
const store = new Store();
await store.migrate();
await store.close();
console.log("Database migrations applied.");
