const hostedBasePath = "/engine/3d";

export function hostedSceneApiPath(path: string): string {
  if (typeof window === "undefined") return path;
  return window.location.pathname.startsWith(hostedBasePath)
    ? `${hostedBasePath}${path}`
    : path;
}
