import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const RETIRED_TOP_LEVEL_KEYS = ["fallbackStrategy", "stickyRoundRobinLimit"];
const RETIRED_PROVIDER_KEYS = { fallbackStrategy: true, stickyRoundRobinLimit: true };

export default {
  version: 17,
  name: "remove-account-routing-strategy",
  up(db) {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return;

    const settings = parseJson(row.data, {});
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return;

    let changed = false;
    for (const key of RETIRED_TOP_LEVEL_KEYS) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        delete settings[key];
        changed = true;
      }
    }

    const map = settings.providerStrategies;
    if (map && typeof map === "object" && !Array.isArray(map)) {
      for (const [provider, entry] of Object.entries(map)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        let entryChanged = false;
        for (const key of Object.keys(RETIRED_PROVIDER_KEYS)) {
          if (Object.prototype.hasOwnProperty.call(entry, key)) {
            delete entry[key];
            entryChanged = true;
          }
        }
        if (entryChanged) {
          changed = true;
          if (Object.keys(entry).length === 0) delete map[provider];
        }
      }
    }

    if (!changed) return;
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(settings)],
    );
  },
};
