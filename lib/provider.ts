import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AppError } from "./errors";
import { outputSchema } from "./analysis";
import { vault, encrypt, decrypt, type Vault } from "./vault";

// Pin the model configuration across alias updates; outputs are not deterministic.
export const MODEL = "gpt-5.4-2026-03-05";
const settingsFile = "provider-settings.enc";
const settingsSchema = z.object({ apiKey: z.string().regex(/^sk-[A-Za-z0-9_-]{16,500}$/) }).strict();
function settings(store: Vault) {
  if (!store.key) throw new AppError("Unlock your vault.", 401);
  const file = path.join(store.dir, settingsFile);
  if (!existsSync(file)) return null;
  const parsed = settingsSchema.safeParse(JSON.parse(decrypt(readFileSync(file), store.key).toString("utf8")));
  if (!parsed.success) throw new AppError("Reconnect OpenAI in Connection & instructions.");
  return parsed.data;
}
export function saveProvider(apiKey: string, store: Vault = vault) {
  if (!store.key) throw new AppError("Unlock your vault.", 401);
  const parsed = settingsSchema.safeParse({ apiKey: apiKey.trim() });
  if (!parsed.success) throw new AppError("Enter a valid OpenAI API key starting with sk-.");
  store.atomic(settingsFile, encrypt(Buffer.from(JSON.stringify(parsed.data)), store.key));
  return providerStatus(store);
}
export function removeProvider(store: Vault = vault) {
  if (!store.key) throw new AppError("Unlock your vault.", 401);
  const file = path.join(store.dir, settingsFile);
  if (existsSync(file)) unlinkSync(file);
  return providerStatus(store);
}
export function providerStatus(store: Vault = vault) {
  const enabled = !!settings(store);
  return {
    enabled,
    provider: "OpenAI API",
    model: MODEL,
    maxCharacters: 120000,
    contextTokens: 262144,
    reason: enabled ? "" : "Connect your OpenAI API key in Connection & instructions to generate analysis.",
  };
}
export async function connectedProvider(store: Vault = vault) {
  // Reading settings never sends a document or makes a network request.
  return providerStatus(store);
}
export function checkContext(messages: { role: string; content: string }[], contextTokens: number) {
  // UTF-8 bytes conservatively bound text tokens; reserve room for protocol and output.
  const upperBound = messages.reduce((n, m) => n + Buffer.byteLength(m.content, "utf8") + 256, 0)
    + Buffer.byteLength(JSON.stringify(outputSchema), "utf8") + 2048;
  if (upperBound + 16000 > contextTokens)
    throw new AppError("This complete request exceeds the analysis context budget. No text was truncated. Use a smaller complete agreement.");
  return upperBound;
}
function httpError(status: number) {
  if (status === 401) return new AppError("OpenAI rejected the API key. Replace it in Connection & instructions.");
  if (status === 403 || status === 404) return new AppError("This API project cannot access the configured model. Check model permissions in OpenAI.");
  if (status === 429) return new AppError("OpenAI's usage or rate limit was reached. Check API billing and limits, then retry.");
  if (status >= 500) return new AppError("OpenAI is temporarily unavailable. Try again later.");
  return new AppError("OpenAI rejected the request. Check the model connection and request limits.");
}
export async function testProvider(store: Vault = vault, request: typeof fetch = fetch) {
  const config = settings(store);
  if (!config) throw new AppError("Save an API key first.");
  const controller = new AbortController();
  store.controllers.add(controller);
  try {
    const response = await request(`https://api.openai.com/v1/models/${MODEL}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      redirect: "error",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    });
    await response.body?.cancel();
    if (!response.ok) throw httpError(response.status);
    if (controller.signal.aborted) throw new AppError("Connection check stopped when the vault was locked.");
    return { message: "OpenAI accepted your key and model access. No agreement was sent. Generation also requires available API credit." };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Could not reach OpenAI. Check your internet connection and try again.");
  } finally {
    store.controllers.delete(controller);
  }
}
export async function complete(
  messages: { role: string; content: string }[],
  signal: AbortSignal,
  store: Vault = vault,
  request: typeof fetch = fetch,
): Promise<unknown> {
  if (signal.aborted) throw new AppError("Analysis stopped.");
  const config = settings(store);
  if (!config) throw new AppError("Connect your OpenAI API key first.");
  checkContext(messages, providerStatus(store).contextTokens);
  try {
    const response = await request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        input: messages,
        store: false,
        background: false,
        stream: false,
        reasoning: { effort: "medium" },
        max_output_tokens: 16000,
        text: { format: { type: "json_schema", name: "agreement_analysis", strict: true, schema: outputSchema } },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw httpError(response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AppError("OpenAI returned an empty response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new AppError("The model response exceeded the output limit.");
      }
      chunks.push(value);
    }
    if (signal.aborted) throw new AppError("Analysis stopped.");
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (data.status !== "completed")
      throw new AppError("OpenAI did not complete this analysis. No findings from this response were accepted. Try a new run.");
    const content = (data.output || []).filter((item: { type: string }) => item.type === "message")
      .flatMap((item: { content: unknown[] }) => item.content || []);
    if (content.some((part: { type: string }) => part.type === "refusal"))
      throw new AppError("The model declined this request. No findings were accepted.");
    const text = content.filter((part: { type: string }) => part.type === "output_text")
      .map((part: { text: string }) => part.text).join("");
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(signal.aborted ? "Analysis stopped." : "OpenAI did not return a complete usable response. Check your connection and try again.");
  }
}
