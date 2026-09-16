"use client";

import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const SHARE_DIRECTORY = "transjit-shares";
const CLEANUP_DELAY_MS = 10 * 60 * 1000;

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function safePdfFilename(filename: string): string {
  const normalized = filename.replace(/[^a-z0-9._ -]/gi, "-").replace(/-+/g, "-");
  return normalized.toLowerCase().endsWith(".pdf") ? normalized : `${normalized || "document"}.pdf`;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read PDF for sharing."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to read PDF for sharing."));
        return;
      }
      const base64 = result.split(",", 2)[1];
      if (!base64) {
        reject(new Error("Unable to encode PDF for sharing."));
        return;
      }
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

function scheduleCacheCleanup(path: string) {
  setTimeout(() => {
    void Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {
      // Cache cleanup is best-effort. Android may still be reading the shared file.
    });
  }, CLEANUP_DELAY_MS);
}

/**
 * Shares a generated PDF through Android's native chooser. Browser callers get
 * `false` so their existing Web Share/download behavior remains unchanged.
 */
export async function sharePdfNatively(
  file: File,
  options: { title: string; text?: string; dialogTitle?: string }
): Promise<boolean> {
  if (
    !isNativeAndroid() ||
    file.type !== "application/pdf" ||
    !Capacitor.isPluginAvailable("Share") ||
    !Capacitor.isPluginAvailable("Filesystem")
  ) {
    return false;
  }

  const filename = safePdfFilename(file.name);
  const path = `${SHARE_DIRECTORY}/${Date.now()}-${filename}`;

  try {
    const supported = await Share.canShare();
    if (!supported.value) {
      throw new Error("Native sharing is unavailable on this device.");
    }

    const { uri } = await Filesystem.writeFile({
      path,
      directory: Directory.Cache,
      data: await fileToBase64(file),
      recursive: true,
    });

    await Share.share({
      files: [uri],
      title: options.title,
      text: options.text,
      dialogTitle: options.dialogTitle ?? "Share PDF",
    });

    scheduleCacheCleanup(path);
    return true;
  } catch (error) {
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {
      // The write may not have completed; cleanup must never hide the share error.
    });
    throw error;
  }
}
