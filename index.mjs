import { randomBytes } from "node:crypto";
import { paths } from "./lib/paths.mjs";
import { atomic } from "./lib/storage.mjs";
import { connectionAt, synchronize } from "./lib/sync.mjs";
import { handler } from "./lib/proxy.mjs";
import { claim, release } from "./lib/lease.mjs";

export const DeepWritePlugin = async () => {
  const p = paths();
  let connection = null;
  let server;
  let baseUrl = "";
  let lastError = "";
  const tick = () => {
    try {
      // Magpie CLI and the GUI have different hosts. Only one writes DW.
      if (!server) {
        if (!claim(p.root)) return;
        const token = randomBytes(24).toString("hex");
        try {
          server = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            idleTimeout: 255,
            maxRequestBodySize: 32 * 1024 * 1024,
            fetch: handler(() => connection, token),
          });
        } catch (e) {
          release(p.root);
          throw e;
        }
        baseUrl = `http://127.0.0.1:${server.port}/${token}/v1`;
      }
      connection = connectionAt(p.connection);
      synchronize(p, connection, baseUrl);
      atomic(p.status, {
        connected: !!connection,
        updatedAt: new Date().toISOString(),
      });
      lastError = "";
    } catch (e) {
      connection = null;
      const message = e.message;
      if (message !== lastError) console.error(`DeepWrite bridge: ${message}`);
      lastError = message;
      atomic(p.status, { connected: false, error: message });
    }
  };
  tick();
  const timer = setInterval(tick, 1000);
  const cleanup = () => {
    clearInterval(timer);
    if (!server) return;
    try {
      synchronize(p, null, baseUrl);
    } catch {}
    server.stop(true);
    server = undefined;
    release(p.root);
  };
  process.once("exit", cleanup);
  // Explicit handlers ensure synchronous recovery when Magpie restarts its host.
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  return {};
};
