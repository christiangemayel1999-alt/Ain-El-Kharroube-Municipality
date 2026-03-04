type RuntimeConfig = {
  apiBaseUrl?: string;
};

const runtimeApiBaseUrl = (globalThis as { __APP_CONFIG__?: RuntimeConfig }).__APP_CONFIG__?.apiBaseUrl;

export const environment = {
  production: false,
  apiBaseUrl: runtimeApiBaseUrl ?? "http://localhost:4000"
};

