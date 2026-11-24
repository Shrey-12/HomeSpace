import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppConfig } from "./config.js";

export function createObjectStorage(config: AppConfig) {
  const credentials = config.s3AccessKeyId && config.s3SecretAccessKey
    ? { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }
    : undefined;
  const client = new S3Client({
    region: config.s3Region,
    endpoint: config.s3Endpoint,
    forcePathStyle: config.s3ForcePathStyle,
    credentials,
  });

  return {
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.s3Bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: config.s3Bucket }));
      }
      if (config.webOrigin) {
        await client.send(new PutBucketCorsCommand({
          Bucket: config.s3Bucket,
          CORSConfiguration: {
            CORSRules: [{
              AllowedMethods: ["POST", "GET", "HEAD"],
              AllowedOrigins: [config.webOrigin],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            }],
          },
        }));
      }
    },
    async createUploadUrl(key: string, contentType: string, sizeBytes: number) {
      return createPresignedPost(client, {
        Bucket: config.s3Bucket,
        Key: key,
        Expires: config.uploadUrlTtlSeconds,
        Fields: { "Content-Type": contentType },
        Conditions: [
          ["content-length-range", sizeBytes, sizeBytes],
          ["eq", "$Content-Type", contentType],
        ],
      });
    },
    async headObject(key: string) {
      return client.send(new HeadObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    },
    async createDownloadUrl(key: string) {
      const command = new GetObjectCommand({ Bucket: config.s3Bucket, Key: key });
      return getSignedUrl(client, command, { expiresIn: 300 });
    },
    close() {
      client.destroy();
    },
  };
}

export type ObjectStorage = ReturnType<typeof createObjectStorage>;
