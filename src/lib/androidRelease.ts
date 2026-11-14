export interface AndroidReleaseIdentity {
  tagName?: string | null;
  assetName?: string | null;
  prerelease?: boolean;
}

/** Extracts the semantic app version from a release tag or APK filename. */
export function getAndroidReleaseVersion(identity: AndroidReleaseIdentity): string {
  const source = `${identity.tagName || ""} ${identity.assetName || ""}`;
  const match = source.match(/android-v(\d+(?:\.\d+){1,2})/i);
  return match?.[1] || "unknown";
}

/**
 * Gives every APK a human-readable, unambiguous channel label.
 * Stable releases and debug/testing builds are deliberately distinguished.
 */
export function formatAndroidReleaseLabel(identity: AndroidReleaseIdentity): string {
  const version = getAndroidReleaseVersion(identity);
  const channel = identity.prerelease ? "TEST BUILD · DEBUG SIGNED" : "OFFICIAL RELEASE";
  return `${version === "unknown" ? "Hub-Mind Android" : `Hub-Mind Android v${version}`} · ${channel}`;
}

/** Compare release versions numerically rather than lexicographically. */
export function compareAndroidReleaseVersions(a: AndroidReleaseIdentity, b: AndroidReleaseIdentity): number {
  const parts = (value: string) => value === "unknown" ? [] : value.split(".").map(Number);
  const left = parts(getAndroidReleaseVersion(a));
  const right = parts(getAndroidReleaseVersion(b));
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
