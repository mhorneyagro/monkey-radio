import { join, resolve } from "node:path";

export function resolveTrackAbsolutePath(
  libraryPath: string,
  filePath: string,
): string {
  if (filePath.startsWith("library/")) {
    return join(resolve(libraryPath, ".."), filePath);
  }
  return join(libraryPath, filePath);
}

export function resolveDjAbsolutePath(
  djPath: string,
  filePath: string,
): string {
  if (filePath.startsWith("dj/")) {
    return join(resolve(djPath, ".."), filePath);
  }
  return join(djPath, filePath);
}
