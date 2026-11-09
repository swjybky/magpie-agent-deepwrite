const { app, safeStorage } = require("electron");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
app.setPath("userData", process.env.DW_CREDENTIAL_TEST_PROFILE);
app.whenReady().then(() => {
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Storage unavailable");
    if (process.env.DW_CREDENTIAL_TEST_ACTION === "seed") {
      // Initialize this disposable profile's Local State; no real DW data.
      safeStorage.encryptString("fixture-initialize-storage");
    } else {
      const config = JSON.parse(readFileSync(join(app.getPath("userData"), "config", "models.json"), "utf8"));
      const models = config.models.filter((m) => m.provider === "magpie");
      if (models.length !== 2) throw new Error("Missing imported models");
      for (const model of models) {
        const decoded = safeStorage.decryptString(Buffer.from(config.encryptedApiKeys[model.id], "base64"));
        if (decoded !== "magpie-local-bridge") throw new Error("Wrong placeholder");
      }
    }
    app.quit();
  } catch {
    console.error("Windows Electron credential verification failed");
    app.exit(1);
  }
});
