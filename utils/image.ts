/**
 * --------------------------------------------------------------------
 * File:
 * utils/image.ts
 *
 * Purpose:
 * Generic, feature-agnostic image processing helpers. No Firestore,
 * no Storage, no entity-specific logic — just browser Canvas/Image
 * APIs. Safe to reuse anywhere a photo gets uploaded (teachers,
 * students, etc.).
 * --------------------------------------------------------------------
 */

/**
 * ----------------------------------------------------
 * Compresses an image file into a square WebP thumbnail,
 * cropped to fill (like a profile photo).
 *
 * Defaults produce a 400x400 headshot at 80% quality, which is
 * a reasonable balance of clarity vs. file size for a profile photo.
 * ----------------------------------------------------
 */
export function compressToWebP(
  file: File,
  size: number = 400,
  quality: number = 0.8
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onerror = () => reject(new Error("Failed to read image file."));

    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target?.result as string;

      img.onerror = () => reject(new Error("Failed to load image."));

      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = size;
        canvas.height = size;

        // Aspect-fill crop, centered.
        const scale = Math.max(size / img.width, size / img.height);
        const x = (size - img.width * scale) / 2;
        const y = (size - img.height * scale) / 2;

        ctx?.drawImage(img, x, y, img.width * scale, img.height * scale);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Image compression failed."));
          },
          "image/webp",
          quality
        );
      };
    };
  });
}

/**
 * ----------------------------------------------------
 * Converts an image file to WebP at its original resolution and
 * aspect ratio — no cropping, no resizing. Use this for logos and
 * other images where the source proportions matter; use
 * compressToWebP instead for square profile-photo thumbnails.
 * ----------------------------------------------------
 */
export function convertToWebP(file: File, quality: number = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D context unavailable."));
        return;
      }

      ctx.drawImage(img, 0, 0);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas toBlob() returned null. WebP may not be supported."));
        },
        "image/webp",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image for conversion."));
    };

    img.src = objectUrl;
  });
}