export const MAX_GUARD_FACE_BYTES = 200 * 1024;
export const MAX_GUARD_FACE_OUTPUT_WIDTH = 720;

export function formatGuardPhotoLimit() {
  return `${Math.round(MAX_GUARD_FACE_BYTES / 1024)} KB`;
}
