import { Elysia } from "elysia";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function safeExt(filename: string) {
  const ext = path.extname(filename || "").toLowerCase();
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  return allowed.has(ext) ? ext : ".png";
}

export const uploadRouter = new Elysia({ prefix: "/upload" }).post(
  "/",
  async ({ request, set }) => {
    try {
      const form = await request.formData();

      const files: File[] = [];

      const singleFile = form.get("file");
      if (singleFile instanceof File) {
        files.push(singleFile);
      }

      for (const item of form.getAll("files[]")) {
        if (item instanceof File) {
          files.push(item);
        }
      }

      if (files.length === 0) {
        set.status = 400;
        return { error: "No files uploaded" };
      }

      const raw = process.env.UPLOAD_MAX_FILE_BYTES?.trim();
      const maxBytes =
        raw == null || raw === ""
          ? null
          : (() => {
              const n = Number.parseInt(raw, 10);
              return Number.isFinite(n) && n > 0 ? n : null;
            })();
      const uploadDir = path.join(process.cwd(), "public", "uploads");
      await mkdir(uploadDir, { recursive: true });

      const urls: string[] = [];

      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          set.status = 400;
          return { error: "Only images allowed" };
        }

        if (maxBytes != null && file.size > maxBytes) {
          set.status = 400;
          return { error: `File too large (max ${maxBytes} bytes, UPLOAD_MAX_FILE_BYTES)` };
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const ext = safeExt(file.name);
        const filename = `${randomUUID()}${ext}`;
        const fullPath = path.join(uploadDir, filename);

        await writeFile(fullPath, buffer);
        urls.push(`/uploads/${filename}`);
      }

      return { urls };
    } catch (error) {
      console.error("POST /api/upload error:", error);
      set.status = 500;
      return { error: "Internal Server Error" };
    }
  }
);