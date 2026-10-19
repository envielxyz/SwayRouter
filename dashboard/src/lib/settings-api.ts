import { api } from "@/lib/api";

export type AppSettings = {

  profileName?: string;
  profileAvatar?: string;
  currency?: "USD" | "IDR";
  requireApiKey?: boolean;

  requireLogin?: boolean;

  payloadCaptureEnabled?: boolean;
  hasPassword?: boolean;
  tunnelDashboardAccess?: boolean;
  providerStrategies?: Record<
    string,
    Record<string, unknown>
  >;

  providerThinking?: Record<string, string>;
  comboStrategy?: string;
  comboStickyRoundRobinLimit?: number;
  rtkEnabled?: boolean;

  cavemanEnabled?: boolean;
  cavemanLevel?: string;
  ponytailEnabled?: boolean;
  ponytailLevel?: string;
  [key: string]: unknown;
};

export async function fetchSettings() {

  const { data } = await api.get<AppSettings>("/settings");
  return data;
}

export async function updateSettings(partial: Partial<AppSettings>) {

  const { data } = await api.patch<AppSettings>("/settings", partial);
  return data;
}

export async function fetchDatabasePath() {
  const { data } = await api.get<{ dbPath?: string }>("/settings/database/path");
  return data.dbPath;
}

export async function shutdownRouter() {
  const { data } = await api.post<{
    success?: boolean;
    code?: string;
    message?: string;
  }>("/shutdown");
  return data;
}


