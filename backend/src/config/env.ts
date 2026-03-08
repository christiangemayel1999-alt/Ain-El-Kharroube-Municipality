import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(24),
  JWT_EXPIRES_IN: z.string().default("8h"),
  CLIENT_ORIGIN: z.string().optional(),
  FRONTEND_ORIGIN: z.string().optional(),
  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  WEB_PUSH_SUBJECT: z.string().optional(),
  LIVE_CAMERA_ICE_SERVERS_JSON: z.string().optional(),
  LIVE_CAMERA_ICE_TRANSPORT_POLICY: z.enum(["all", "relay"]).optional()
});

export const env = envSchema.parse(process.env);

