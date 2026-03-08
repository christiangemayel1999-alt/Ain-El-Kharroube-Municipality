import webpush, { SendResult } from "web-push";
import { env } from "../config/env";

const hasWebPushConfig =
  Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY) &&
  Boolean(env.WEB_PUSH_VAPID_PRIVATE_KEY) &&
  Boolean(env.WEB_PUSH_SUBJECT);

if (hasWebPushConfig) {
  webpush.setVapidDetails(
    env.WEB_PUSH_SUBJECT!,
    env.WEB_PUSH_VAPID_PUBLIC_KEY!,
    env.WEB_PUSH_VAPID_PRIVATE_KEY!
  );
}

export type WebPushPayload = {
  title: string;
  body: string;
  pingId: string;
  targetPath: string;
};

export type WebPushSubscriptionPayload = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export function isWebPushEnabled() {
  return hasWebPushConfig;
}

export function webPushPublicKey() {
  return env.WEB_PUSH_VAPID_PUBLIC_KEY ?? null;
}

export async function sendWebPush(
  subscription: WebPushSubscriptionPayload,
  payload: WebPushPayload
): Promise<
  | {
      ok: true;
      result: SendResult;
    }
  | {
      ok: false;
      statusCode: number | null;
      reason: string;
      deactivateSubscription: boolean;
    }
> {
  if (!hasWebPushConfig) {
    return {
      ok: false,
      statusCode: null,
      reason: "WEB_PUSH_NOT_CONFIGURED",
      deactivateSubscription: false
    };
  }

  try {
    const result = await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth
        }
      },
      JSON.stringify(payload),
      {
        TTL: 180,
        urgency: "high"
      }
    );

    return {
      ok: true,
      result
    };
  } catch (error: any) {
    const statusCode =
      typeof error?.statusCode === "number" && Number.isFinite(error.statusCode)
        ? Number(error.statusCode)
        : null;

    return {
      ok: false,
      statusCode,
      reason: String(error?.body ?? error?.message ?? "PUSH_SEND_FAILED"),
      deactivateSubscription: statusCode === 404 || statusCode === 410
    };
  }
}
