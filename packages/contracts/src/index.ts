import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const createUploadUrlSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "video/mp4",
  ]),
  sizeBytes: z.number().int().positive(),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(512).optional(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateUploadUrlInput = z.infer<typeof createUploadUrlSchema>;
