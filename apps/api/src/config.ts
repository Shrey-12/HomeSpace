import dotenv from "dotenv";
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? "../../.env" });
import { z } from "zod";

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("0.0.0.0"),
  WEB_ORIGIN: z.string().url().optional(),
  DATABASE_URL: z.string().min(1),
  AUTH0_DOMAIN: z.string().min(1).refine((domain) => !domain.includes("://") && !domain.includes("/"), "Use the Auth0 tenant or custom domain without a scheme or path."),
  AUTH0_CLIENT_ID: z.string().min(1),
  AUTH0_AUDIENCE: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanFromString.default("false"),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(104857600),
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const config = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  host: parsed.data.HOST,
  webOrigin: parsed.data.WEB_ORIGIN,
  databaseUrl: parsed.data.DATABASE_URL,
  auth0Domain: parsed.data.AUTH0_DOMAIN,
  auth0ClientId: parsed.data.AUTH0_CLIENT_ID,
  auth0IssuerUrl: `https://${parsed.data.AUTH0_DOMAIN}/`,
  auth0JwksUrl: `https://${parsed.data.AUTH0_DOMAIN}/.well-known/jwks.json`,
  auth0Audience: parsed.data.AUTH0_AUDIENCE,
  s3Endpoint: parsed.data.S3_ENDPOINT,
  s3Region: parsed.data.S3_REGION,
  s3Bucket: parsed.data.S3_BUCKET,
  s3AccessKeyId: parsed.data.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: parsed.data.S3_SECRET_ACCESS_KEY,
  s3ForcePathStyle: parsed.data.S3_FORCE_PATH_STYLE,
  uploadUrlTtlSeconds: parsed.data.UPLOAD_URL_TTL_SECONDS,
  maxUploadBytes: parsed.data.MAX_UPLOAD_BYTES,
};

export type AppConfig = typeof config;
