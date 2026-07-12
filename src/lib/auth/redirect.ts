export function getSafeNextPath(value: string | null, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  return value;
}

export function setPrivateNoStore(response: Response) {
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
