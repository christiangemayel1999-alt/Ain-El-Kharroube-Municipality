type RuntimeConfig = {
  apiBaseUrl?: string;
};

const runtimeApiBaseUrl = (globalThis as { __APP_CONFIG__?: RuntimeConfig }).__APP_CONFIG__?.apiBaseUrl;

export const environment = {
  production: true,
  apiBaseUrl: runtimeApiBaseUrl ?? "https://your-render-service.onrender.com"
};
