import { Store } from "../src/lib/db";
import { transfer } from "../src/lib/transfer";
const sourceProvider = process.env.SOURCE_DATABASE_PROVIDER;
const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetProvider = process.env.TARGET_DATABASE_PROVIDER;
const targetUrl = process.env.TARGET_DATABASE_URL;
if (!sourceProvider || !sourceUrl || !targetProvider || !targetUrl)
  throw new Error(
    "Set SOURCE_DATABASE_PROVIDER, SOURCE_DATABASE_URL, TARGET_DATABASE_PROVIDER and TARGET_DATABASE_URL locally.",
  );
if (sourceProvider === targetProvider && sourceUrl === targetUrl)
  throw new Error("Source and target must differ");
const source = new Store(sourceProvider, sourceUrl);
const target = new Store(targetProvider, targetUrl);
try {
  const counts = await transfer(source, target);
  console.log(
    `Transferred ${counts.users} users and ${counts.profiles} profiles. Sessions were not copied.`,
  );
} catch {
  console.error(
    "Transfer failed. Target must be empty and both database schemas must be valid. No source data was changed.",
  );
  process.exitCode = 1;
} finally {
  await source.close();
  await target.close();
}
