import { join } from "node:path";
import { synchronize } from "../../lib/sync.mjs";
const root = process.env.DW_CREDENTIAL_TEST_PROFILE;
synchronize({
  config: join(root, "config", "models.json"),
  journal: join(root, "journal.json"),
}, JSON.parse(process.env.DW_CREDENTIAL_TEST_CONNECTION), "http://127.0.0.1:12346/fixture/v1");
