export interface WorkerEnvironment {
  GEMINI_API_KEY?: string;
  SITE_PUSH_TOKEN?: string;
  MANUAL_TRIGGER_TOKEN?: string;
  SITE_API_URL?: string;
  GEMINI_MODEL?: string;
  FXTWITTER_BASE_URL?: string;
}

export interface WorkerConfig {
  geminiApiKey: string;
  sitePushToken: string;
  manualTriggerToken: string;
  siteApiUrl: string;
  geminiModel: string;
  fxTwitterBaseUrl: string;
}

function requiredSecret(
  environment: WorkerEnvironment,
  name: keyof Pick<
    WorkerEnvironment,
    "GEMINI_API_KEY" | "SITE_PUSH_TOKEN" | "MANUAL_TRIGGER_TOKEN"
  >,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(name + " is required");
  }
  return value;
}

function httpsUrl(value: string | undefined, name: string, fallback?: string): string {
  const candidate = value?.trim() || fallback;
  if (!candidate) {
    throw new Error(name + " is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(name + " must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(name + " must be a valid HTTPS URL");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function resolveWorkerConfig(environment: WorkerEnvironment): WorkerConfig {
  return {
    geminiApiKey: requiredSecret(environment, "GEMINI_API_KEY"),
    sitePushToken: requiredSecret(environment, "SITE_PUSH_TOKEN"),
    manualTriggerToken: requiredSecret(environment, "MANUAL_TRIGGER_TOKEN"),
    siteApiUrl: httpsUrl(environment.SITE_API_URL, "SITE_API_URL"),
    geminiModel: environment.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
    fxTwitterBaseUrl: httpsUrl(
      environment.FXTWITTER_BASE_URL,
      "FXTWITTER_BASE_URL",
      "https://api.fxtwitter.com",
    ),
  };
}
