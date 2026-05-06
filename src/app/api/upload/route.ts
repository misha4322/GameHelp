import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { uploadAvatar, uploadBanner, uploadPostImage, uploadMessageImage } from "@/lib/s3";

export const runtime = "nodejs";

/** Лимит в байтах; не задан — без ограничения на стороне приложения (см. UPLOAD_MAX_FILE_BYTES) */
function maxUploadBytes(): number | null {
  const raw = process.env.UPLOAD_MAX_FILE_BYTES?.trim();
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const files: File[] = [];

    const singleFile = form.get("file");
    if (singleFile instanceof File) {
      files.push(singleFile);
    }

    const multipleFiles = form.getAll("files[]");
    for (const item of multipleFiles) {
      if (item instanceof File) {
        files.push(item);
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const uploadedUrls: string[] = [];
    const type = form.get("type")?.toString() || "post";

    const maxB = maxUploadBytes();

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json({ error: "Only images allowed" }, { status: 400 });
      }

      if (maxB != null && file.size > maxB) {
        return NextResponse.json(
          { error: `File too large (max ${maxB} bytes, set UPLOAD_MAX_FILE_BYTES)` },
          { status: 400 }
        );
      }

      const bytes = Buffer.from(await file.arrayBuffer());

      let url: string;
      if (type === "avatar") {
        url = await uploadAvatar(bytes, file.name);
      } else if (type === "banner") {
        url = await uploadBanner(bytes, file.name);
      } else if (type === "message") {
        url = await uploadMessageImage(bytes, file.name);
      } else {
        url = await uploadPostImage(bytes, file.name);
      }

      uploadedUrls.push(url);
    }

    return NextResponse.json({ urls: uploadedUrls });
  } catch (error) {
    console.error("POST /api/upload error:", error);
    const message =
      error instanceof Error && error.message ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}