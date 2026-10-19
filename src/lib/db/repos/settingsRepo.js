import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getConfigCache, bumpConfigCacheVersion } from "../../cache/ttlCache.js";

const DEFAULT_SETTINGS = {

  profileName: "",
  profileAvatar: "",
  currency: "USD",
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  providerStrategies: {},

  accountPool: {
    enabled: true,
    maxConcurrentPerAccount: 30,
    maxQueuePerProvider: 1024,
    queueWaitTimeoutMs: 30000,
    cacheTtlMs: 5000,
  },
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  capacityAdapter: {
    vision: { enabled: true, roundRobin: false, models: [] },
    pdf: { enabled: false, roundRobin: false, models: [] },
    audioInput: { enabled: true, roundRobin: false, models: [] },
    videoInput: { enabled: false, roundRobin: false, models: [] },
  },
  requireLogin: true,
  requireApiKey: true,
  tunnelDashboardAccess: true,
  enableObservability: false,

  payloadCaptureEnabled: false,
  observabilityMaxRecords: 500,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  rtkEnabled: true,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",

  mediaProviders: [],

  cliModelMappings: {},
};

const REMOVED_SETTING_KEYS = [
  "outboundProxyEnabled",
  "outboundProxyUrl",
  "outboundNoProxy",
  "accentColor",
  "authMode",
  "oidcIssuerUrl",
  "oidcClientId",
  "oidcClientSecret",
  "oidcScopes",
  "oidcLoginLabel",
  // Retired account-routing strategy selection: routing is always sticky now.
  // Keys are stripped on read so legacy payloads keep merging cleanly.
  "fallbackStrategy",
  "stickyRoundRobinLimit",
];

const REMOVED_PROVIDER_STRATEGY_KEYS = { fallbackStrategy: true, stickyRoundRobinLimit: true };

function stripRemovedProviderStrategies(raw) {
  const map = raw?.providerStrategies;
  if (!map || typeof map !== "object" || Array.isArray(map)) return raw;
  let changed = false;
  const next = { ...raw, providerStrategies: { ...map } };
  for (const [providerId, entry] of Object.entries(map)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    let entryChanged = false;
    const clean = { ...entry };
    for (const key of Object.keys(REMOVED_PROVIDER_STRATEGY_KEYS)) {
      if (Object.prototype.hasOwnProperty.call(clean, key)) {
        delete clean[key];
        entryChanged = true;
      }
    }
    if (entryChanged) {
      changed = true;
      if (Object.keys(clean).length === 0) delete next.providerStrategies[providerId];
      else next.providerStrategies[providerId] = clean;
    }
  }
  return changed ? next : raw;
}

export function stripRemovedSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  let clean = { ...raw };
  for (const key of REMOVED_SETTING_KEYS) delete clean[key];
  clean = stripRemovedProviderStrategies(clean);
  return clean;
}

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return stripRemovedSettings(row ? parseJson(row.data, {}) : {});
}

function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...stripRemovedSettings(raw) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      merged[key] = defVal;
    }
  }
  return merged;
}

const settingsCache = getConfigCache("settings", { ttlMs: 5000 });

// Routing is always sticky: strategy selection was retired. Writes carrying
// legacy fallbackStrategy / stickyRoundRobinLimit keys are ignored (never throw),
// and reads of already-persisted values never throw either.
export function validateFallbackStrategies(_updates) {}

export async function getSettings() {
  return await settingsCache.get("merged", async () => {
    const raw = await readRaw();
    return mergeWithDefaults(raw);
  });
}

export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(function () {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = stripRemovedSettings(row ? parseJson(row.data, {}) : {});
    next = stripRemovedSettings({ ...current, ...updates });
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)],
    );
  });

  await bumpConfigCacheVersion().catch(() => {});
  return mergeWithDefaults(next);
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings() {
  return await readRaw();
}
