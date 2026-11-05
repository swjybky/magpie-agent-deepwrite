import { paths } from "../lib/paths.mjs";
import { synchronize } from "../lib/sync.mjs";
import { atomic } from "../lib/storage.mjs";
const p = paths();
// Close Magpie and DW first; this is a recovery command after a forced kill.
atomic(p.connection, {});
synchronize(p, null, "");
console.log("DeepWrite Magpie configuration restored.");
