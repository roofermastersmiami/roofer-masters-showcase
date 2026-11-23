export function oauthReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.split("").some((character) => {
      const code = character.charCodeAt(0);
      return character === "\\" || code <= 0x1f || code === 0x7f;
    })
  )
    return "/";
  const origin = "https://app.invalid";
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin || target.pathname.startsWith("//")) return "/";
    return target.pathname + target.search + target.hash;
  } catch {
    return "/";
  }
}
