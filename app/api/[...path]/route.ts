import { z } from "zod";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { vault, view } from "@/lib/vault";
import { guard, response, failure, jsonBody } from "@/lib/security";
import { AppError } from "@/lib/errors";
import { ingest, maxUpload } from "@/lib/ingest";
import { loadInstructions } from "@/lib/analysis";
import { connectedProvider, saveProvider, removeProvider, testProvider } from "@/lib/provider";
import { newRun, execute, reconcile, activeJobs, cancel } from "@/lib/runner";
import type { Review } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handle(req: Request, ctx: Context) {
  try {
    const parts = (await ctx.params).path,
      route = parts.join("/");
    if (route === "session") {
      guard(req, false);
      if (req.method === "GET") {
        let unlocked = false;
        try {
          guard(req);
          unlocked = true;
        } catch {}
        return response({ configured: vault.configured, unlocked });
      }
      if (req.method === "POST") {
        const b = z
          .object({ passphrase: z.string(), create: z.boolean() })
          .strict()
          .safeParse(await jsonBody(req, 2000));
        if (!b.success) throw new AppError("Enter your vault passphrase.");
        const token = vault.unlock(b.data.passphrase, b.data.create);
        return Response.json(
          { unlocked: true },
          {
            headers: {
              "Set-Cookie": `ale_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
              "Cache-Control": "no-store",
            },
          },
        );
      }
      if (req.method === "DELETE") {
        guard(req);
        vault.lock();
        return Response.json(
          { unlocked: false },
          {
            headers: {
              "Set-Cookie":
                "ale_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
              "Cache-Control": "no-store",
            },
          },
        );
      }
    }
    guard(req);
    if (route === "instructions" && req.method === "GET")
      return response({
        ...loadInstructions(),
        provider: await connectedProvider(),
      });
    if (route === "provider/test" && req.method === "POST") {
      const result = await testProvider();
      guard(req);
      return response(result);
    }
    if (route === "provider" && (req.method === "POST" || req.method === "DELETE")) {
      if (activeJobs.size) throw new AppError("Finish or stop the current analysis before changing the connection.", 409);
      if (req.method === "DELETE") return response(removeProvider());
      const parsed = z.object({ apiKey: z.string().max(512) }).strict().safeParse(await jsonBody(req, 2000));
      if (!parsed.success) throw new AppError("Enter an OpenAI API key.");
      guard(req);
      if (activeJobs.size) throw new AppError("Finish or stop the current analysis before changing the connection.", 409);
      return response(saveProvider(parsed.data.apiKey));
    }
    if (route === "backup" && req.method === "GET") {
      const files = readdirSync(vault.dir)
        .filter((f) => f === "vault.json" || /^[a-f0-9-]{36}\.vault$/.test(f))
        .map((name) => ({
          name,
          data: readFileSync(path.join(vault.dir, name)).toString("base64"),
        }));
      return new Response(
        JSON.stringify({
          format: "agreement-logic-encrypted-backup-v1",
          created_at: new Date().toISOString(),
          files,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition":
              'attachment; filename="agreement-vault.encrypted-backup.json"',
            "Cache-Control": "no-store",
          },
        },
      );
    }
    if (route === "matters") {
      if (req.method === "GET")
        return response(
          vault.list().map((raw) => {
            const m = reconcile(raw);
            return {
              id: m.id,
              title: m.title,
              created_at: m.created_at,
              format: m.source.format,
              blocks: m.source.blocks.length,
              runs: m.runs.length,
              latest_status: m.runs.at(-1)?.status,
            };
          }),
        );
      if (req.method === "POST") {
        if (Number(req.headers.get("content-length")) > maxUpload + 100000)
          throw new AppError("Maximum upload size is 15 MB.", 413);
        // Limit the complete stream before multipart parsing, including requests without Content-Length.
        const reader = req.body?.getReader();
        if (!reader) throw new AppError("Choose a document.");
        let size = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const x = await reader.read();
          if (x.done) break;
          size += x.value.length;
          if (size > maxUpload + 100000) {
            await reader.cancel();
            throw new AppError("Maximum upload size is 15 MB.", 413);
          }
          chunks.push(x.value);
        }
        const form = await new Response(Buffer.concat(chunks), {
          headers: { "Content-Type": req.headers.get("content-type") || "" },
        }).formData();
        const file = form.get("document");
        if (!(file instanceof File))
          throw new AppError("Choose a PDF, DOCX or TXT document.");
        const m = await ingest(
          file.name,
          Buffer.from(await file.arrayBuffer()),
        );
        guard(req);
        vault.save(m, 0);
        return response(view(m), 201);
      }
    }
    if (parts[0] === "matters" && parts[1]) {
      const m = reconcile(vault.read(parts[1]));
      const action = parts[2];
      if (!action && req.method === "GET") return response(view(m));
      if (action === "original" && req.method === "GET")
        return new Response(Buffer.from(m.source.original, "base64"), {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(m.source.filename)}`,
            "Cache-Control": "no-store",
          },
        });
      if (action === "report" && req.method === "GET") {
        const text = [
          `# ${m.title}`,
          "Generated analysis — requires human review.",
          `Source: ${m.source.filename}`,
          `Source SHA-256: ${m.source.hash}`,
        ];
        for (const r of m.runs) {
          text.push(
            `\n## Run ${r.created_at}`,
            `Status: ${r.status}; model: ${r.model}; instructions: ${r.pack_hash}`,
          );
          for (const [sid, s] of Object.entries(r.results)) {
            text.push(
              `\n### ${sid} — ${s.state}`,
              s.error || s.analysis?.summary || "",
            );
            for (const f of s.analysis?.findings || []) {
              const review = r.reviews[`${sid}:${f.id}`];
              text.push(
                `\n#### ${f.title}`,
                `Original classification: ${f.classification}; Review: ${review?.state || "open"}`,
                f.analysis,
                ...f.evidence.map(
                  (e) =>
                    `Source ${m.source.blocks.find((b) => b.id === e.block_id)?.locator}: ${e.quote}`,
                ),
              );
              if (review)
                text.push(
                  `Reviewer correction: ${review.correction || "None"}`,
                  `Review note: ${review.note || "None"}`,
                );
            }
            for (const q of s.analysis?.open_questions || [])
              text.push(`Open question: ${q.question}\n${q.reason}`);
          }
        }
        return new Response(text.join("\n\n"), {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": 'attachment; filename="agreement-review.md"',
            "Cache-Control": "no-store",
          },
        });
      }
      if (action === "confirm" && req.method === "POST") {
        m.source.confirmed_at = new Date().toISOString();
        m.audit.push({
          at: m.source.confirmed_at,
          action: "Imported text checked against original",
        });
        vault.save(m, m.revision);
        return response(view(m));
      }
      if (action === "analyze" && req.method === "POST") {
        const connection = await connectedProvider();
        if (!connection.enabled) throw new AppError(connection.reason);
        guard(req);
        const run = newRun(m, connection);
        m.runs.push(run);
        m.audit.push({
          at: run.created_at,
          action: "Analysis started",
          run_id: run.id,
        });
        activeJobs.add(run.id);
        try {
          vault.save(m, m.revision);
        } catch (e) {
          activeJobs.delete(run.id);
          throw e;
        }
        void execute(m.id, run.id).catch(() => {
          activeJobs.delete(run.id);
        });
        return response(view(m), 202);
      }
      if (action === "cancel" && req.method === "POST") {
        const running = m.runs.find((r) => r.status === "running");
        if (!running) throw new AppError("No running analysis found.", 409);
        return response(view(cancel(m.id, running.id)));
      }
      if (action === "review" && req.method === "POST") {
        const parsed = z
          .object({
            revision: z.number().int(),
            run_id: z.string(),
            scenario_id: z.string(),
            finding_id: z.string(),
            state: z.enum(["open", "reviewed"]),
            note: z.string().max(5000),
            correction: z.string().max(10000),
          })
          .strict()
          .safeParse(await jsonBody(req));
        if (!parsed.success) throw new AppError("Invalid review details.");
        // Reading a streamed body can outlive this session. Reauthorize before writing.
        guard(req);
        const b = parsed.data,
          r = m.runs.find((r) => r.id === b.run_id),
          s = r?.results[b.scenario_id as keyof typeof r.results];
        if (!r || !s?.analysis?.findings.some((f) => f.id === b.finding_id))
          throw new AppError("Finding not found.", 404);
        const key = `${b.scenario_id}:${b.finding_id}`,
          previous = r.reviews[key],
          next: Review = {
            state: b.state,
            note: b.note,
            correction: b.correction,
            updated_at: new Date().toISOString(),
          };
        r.reviews[key] = next;
        m.audit.push({
          at: next.updated_at,
          action:
            b.state === "reviewed"
              ? "Finding reviewed"
              : "Review saved / reopened",
          run_id: r.id,
          finding_id: key,
          previous,
          next,
        });
        vault.save(m, b.revision);
        return response(view(m));
      }
    }
    throw new AppError("This operation is not available.", 404);
  } catch (e) {
    return failure(e);
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
