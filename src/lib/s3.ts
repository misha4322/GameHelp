import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

/**
 * Куда **сервер** (Next /api/upload) шлёт S3-запросы — надёжнее `http://127.0.0.1:9000` (MinIO в Docker),
 * т.к. публичный туннель (CloudPub) к MinIO часто отдаёт **502** и не подходит для API.
 * Публичные ссылки — отдельно, см. S3_PUBLIC_URL.
 */
const s3ApiEndpoint = trimTrailingSlash(
  (process.env.S3_API_ENDPOINT || process.env.S3_ENDPOINT || "http://127.0.0.1:9000").trim()
);
/** URL в ответах и в `<img src>`: обычно туннель, чтобы с телефона картинки грузились. */
const s3PublicBase = trimTrailingSlash(
  (process.env.S3_PUBLIC_URL || s3ApiEndpoint).trim()
);

const s3Client = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: s3ApiEndpoint,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
    secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin123",
  },
  forcePathStyle: true,
});

const BUCKET_NAME = process.env.S3_BUCKET || "gamehelp";

/** `1` — не вызывать HeadBucket/Create; бакет и policy создайте в MinIO; решает сбой HeadBucket за «кривым» туннелем. */
const assumeBucket =
  String(process.env.S3_ASSUME_BUCKET_EXISTS ?? "").trim() === "1";

function logS3Failure(context: string, error: unknown) {
  const e = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number; requestId?: string } };
  const m = e?.$metadata;
  console.error(`[S3] ${context}:`, e?.name, e?.message, {
    httpStatus: m?.httpStatusCode,
    requestId: m?.requestId,
  });
}

async function setBucketPublicPolicy() {
  try {
    const { PutBucketPolicyCommand } = await import("@aws-sdk/client-s3");
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicRead",
          Effect: "Allow",
          Principal: "*",
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${BUCKET_NAME}/*`],
        },
      ],
    };
    await s3Client.send(
      new PutBucketPolicyCommand({
        Bucket: BUCKET_NAME,
        Policy: JSON.stringify(policy),
      })
    );
    console.log(`✅ Public read policy set for bucket "${BUCKET_NAME}"`);
  } catch (error) {
    const s = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
    if (s && s >= 500) {
      console.error(
        `[S3] PutBucketPolicy: HTTP ${s} — бакет-политика не применена; настройте public read в консоли MinIO, если ссылки 403.`
      );
    } else {
      console.error("❌ Failed to set bucket policy:", error);
    }
  }
}

/**
 * MinIO за HTTPS-туннелем иногда ломает HeadBucket (в ответ не-S3 → SDK: Unknown),
 * а PutObject при этом проходит. При Unknown не падаем — пытаемся загрузку ниже;
 * 404 — создаём бакет; 403 — реальная проблема с правами/ключом.
 */
async function ensureBucket() {
  if (assumeBucket) {
    return;
  }

  const { HeadBucketCommand, CreateBucketCommand } = await import("@aws-sdk/client-s3");
  let headOk = false;

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    headOk = true;
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode;
    const name = error?.name as string | undefined;

    if (status === 502 || status === 503 || status === 504) {
      throw new Error(
        `S3 HeadBucket: HTTP ${status} (часто CloudPub не проксирует MinIO или бэкенд не запущен). ` +
          `Задайте S3_API_ENDPOINT (или S3_ENDPOINT)=http://127.0.0.1:9000 для MinIO в Docker, ` +
          `а S3_PUBLIC_URL=ваш https-туннель только для публичных ссылок на объекты.`
      );
    }
    if (name === "NotFound" || status === 404) {
      try {
        await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
        console.log(`[S3] bucket "${BUCKET_NAME}" created`);
        headOk = true;
      } catch (createErr) {
        logS3Failure("CreateBucket", createErr);
        throw createErr;
      }
    } else {
      const softUnknown =
        name === "Unknown" ||
        name === "UnknownError" ||
        /unknown/i.test(String(messageFrom(error)));

      logS3Failure("HeadBucket", error);

      if (isS3ConnectionError(error)) {
        throw new Error(
          `MinIO / S3 по адресу ${s3ApiEndpoint} недоступен (сервис не запущен или неверный S3_ENDPOINT). ` +
            `Запустите: npm run docker:up или docker compose up -d, чтобы MinIO слушал :9000. ` +
            `Альтернатива: укажите S3_API_ENDPOINT/ S3_ENDPOINT на публичный туннель MinIO (как S3_PUBLIC_URL) с теми же логином/паролем.`
        );
      }
      if (softUnknown) {
        console.warn(
          `[S3] HeadBucket: нестандартный ответ. Проверьте S3 API на 127.0.0.1:9000; ` +
            `туннель в S3_ENDPOINT — только если он стабильно проксирует MinIO. ` +
            `Создайте бакет "${BUCKET_NAME}" вручную или S3_ASSUME_BUCKET_EXISTS=1.`
        );
        return;
      }
      if (status === 403) {
        throw new Error(
          `S3 HeadBucket: 403 — неверные S3_ACCESS_KEY/S3_SECRET_KEY или нет доступа к бакету ${BUCKET_NAME}.`
        );
      }
      throw new Error(
        `S3 HeadBucket не удался (${name ?? "error"}${status != null ? `, HTTP ${status}` : ""}). ` +
          `Проверьте S3_ENDPOINT: должен вести на S3-API MinIO (порт 9000), не веб-консоль.`
      );
    }
  }

  if (headOk) {
    await setBucketPublicPolicy();
  }
}

function messageFrom(e: unknown) {
  return e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : String(e);
}

function isS3ConnectionError(e: unknown): boolean {
  const s = String(messageFrom(e));
  if (/ECONNREFUSED|ETIMEDOUT|ENETUNREACH|ENOTFOUND/i.test(s)) return true;
  const code = (e as { code?: string; cause?: unknown })?.code;
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT") return true;
  const c = (e as { cause?: unknown })?.cause;
  if (c && c !== e) return isS3ConnectionError(c);
  return false;
}

function getFileExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const allowed = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
  return allowed.has(ext) ? `.${ext}` : ".png";
}

function generateKey(prefix: string, filename: string): string {
  const ext = getFileExtension(filename);
  const hash = crypto.randomUUID();
  return `${prefix}/${hash}${ext}`;
}

export async function uploadToS3(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  await ensureBucket();

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  return `${s3PublicBase}/${BUCKET_NAME}/${key}`;
}

export async function uploadAvatar(buffer: Buffer, filename: string): Promise<string> {
  const key = generateKey("avatars", filename);
  return uploadToS3(buffer, key, "image/jpeg");
}

export async function uploadBanner(buffer: Buffer, filename: string): Promise<string> {
  const key = generateKey("banners", filename);
  return uploadToS3(buffer, key, "image/jpeg");
}

export async function uploadPostImage(buffer: Buffer, filename: string): Promise<string> {
  const key = generateKey("posts", filename);
  return uploadToS3(buffer, key, "image/jpeg");
}

export async function uploadMessageImage(buffer: Buffer, filename: string): Promise<string> {
  const key = generateKey("messages", filename);
  return uploadToS3(buffer, key, "image/jpeg");
}

export async function deleteFromS3(url: string): Promise<void> {
  try {
    const key = url.replace(`${s3PublicBase}/${BUCKET_NAME}/`, "");

    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error("Failed to delete from S3:", error);
  }
}