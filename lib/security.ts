import { AppError } from "./errors";
import { vault } from "./vault";
export function guard(request: Request, authenticated = true) {
  const host = request.headers.get("host") || "";
  if (!/^(127\.0\.0\.1|localhost):4180$/.test(host))
    throw new AppError("This application accepts local connections only.", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError("Cross-site requests are blocked.", 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== `http://${host}`)
    throw new AppError("Request origin is not allowed.", 403);
  if (
    !["GET", "HEAD"].includes(request.method) &&
    (origin !== `http://${host}` ||
      request.headers.get("x-agreement-request") !== "1")
  )
    throw new AppError(
      "This request must come from the local application.",
      403,
    );
  if (authenticated) {
    const cookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("ale_session="))
      ?.slice(12);
    vault.authorize(cookie);
  }
}
export function response(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function failure(error: unknown) {
  return response(
    {
      error:
        error instanceof AppError
          ? error.message
          : "The operation could not be completed. Your saved work has not been replaced.",
    },
    error instanceof AppError ? error.status : 500,
  );
}
export async function jsonBody(request: Request, max = 20000) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Missing request body.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError("Request is too large.", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("Invalid request body.");
  }
}
