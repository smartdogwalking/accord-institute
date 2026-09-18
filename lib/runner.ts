import { randomUUID } from "node:crypto";
import { vault, type Vault } from "./vault";
import { AppError } from "./errors";
import { loadInstructions, messages, acceptModelAnalysis } from "./analysis";
import { complete, providerStatus } from "./provider";
import { scenarios, type Matter, type Run, type ScenarioId } from "./types";
const activeGlobal = globalThis as typeof globalThis & {
  agreementJobs?: Set<string>;
  agreementControllers?: Map<string, AbortController>;
};
export const activeJobs = (activeGlobal.agreementJobs ??= new Set<string>());
const jobControllers = (activeGlobal.agreementControllers ??= new Map<
  string,
  AbortController
>());
export function cancel(matterId: string, runId: string, store: Vault = vault) {
  const m = store.read(matterId),
    r = m.runs.find((r) => r.id === runId);
  if (!r || r.status !== "running")
    throw new AppError("No running analysis found.", 409);
  jobControllers.get(runId)?.abort();
  activeJobs.delete(runId);
  r.status = "interrupted";
  r.finished_at = new Date().toISOString();
  for (const s of Object.values(r.results))
    if (s.state !== "complete") {
      s.state = "failed";
      s.error = "Analysis stopped. Completed scenarios were retained.";
    }
  m.audit.push({
    at: r.finished_at,
    action: "Analysis stopped",
    run_id: runId,
  });
  store.save(m, m.revision);
  return m;
}
export function reconcile(m: Matter, store: Vault = vault) {
  let changed = false;
  for (const r of m.runs)
    if (r.status === "running" && !activeJobs.has(r.id)) {
      r.status = "interrupted";
      r.finished_at = new Date().toISOString();
      for (const s of Object.values(r.results))
        if (s.state !== "complete" && s.state !== "failed") {
          s.state = "failed";
          s.error =
            "This run stopped before completion. Start a new run to retry.";
        }
      changed = true;
    }
  if (changed) store.save(m, m.revision);
  return m;
}
export function newRun(m: Matter, p = providerStatus()): Run {
  if (activeJobs.size)
    throw new AppError(
      "Another analysis is running. Finish or stop it before starting a new run.",
      409,
    );
  if (!p.enabled) throw new AppError(p.reason || "No model connected.");
  if (!m.source.confirmed_at)
    throw new AppError(
      "Compare the imported text with the original and confirm it before analysis.",
    );
  if (m.source.blocks.reduce((n, b) => n + b.text.length, 0) > p.maxCharacters)
    throw new AppError(
      "This agreement exceeds the configured model input limit. No text was truncated or sent. Configure an adequate context limit first.",
    );
  if (m.runs.some((r) => r.status === "running" && activeJobs.has(r.id)))
    throw new AppError("This matter already has an analysis running.", 409);
  const pack = loadInstructions();
  const run: Run = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    status: "running",
    source_hash: m.source.hash,
    pack_hash: pack.hash,
    instructions: pack.files,
    provider: p.provider,
    model: p.model,
    engine_version: "0.3.0",
    context_tokens: p.contextTokens,
    results: Object.fromEntries(
      scenarios.map((s) => [s.id, { state: "pending" }]),
    ) as Run["results"],
    reviews: {},
  };
  return run;
}
export async function execute(
  matterId: string,
  runId: string,
  store: Vault = vault,
  call = complete,
) {
  activeJobs.add(runId);
  const controller = new AbortController();
  store.controllers.add(controller);
  jobControllers.set(runId, controller);

  function update(id: ScenarioId, patch: Partial<Run["results"][ScenarioId]>) {
    if (controller.signal.aborted) throw new AppError("Run cancelled.");
    const m = store.read(matterId);
    Object.assign(m.runs.find((r) => r.id === runId)!.results[id], patch);
    store.save(m, m.revision);
  }
  try {
    const initial = store.read(matterId),
      run = initial.runs.find((r) => r.id === runId)!;
    const blocks = initial.source.blocks;
    for (const s of scenarios) {
      if (controller.signal.aborted) break;
      try {
        update(s.id, { state: "drafting" });
        const draft = await call(
          messages(run.instructions, s.id, blocks),
          controller.signal,
        );
        update(s.id, { state: "checking" });
        const checked = acceptModelAnalysis(
          await call(
            messages(run.instructions, s.id, blocks, draft),
            controller.signal,
          ),
          blocks,
        );
        update(s.id, { state: "complete", analysis: checked });
      } catch (e) {
        if (controller.signal.aborted) break;
        update(s.id, {
          state: "failed",
          error:
            e instanceof AppError
              ? e.message
              : "This scenario could not be completed. Start a new run to retry.",
        });
      }
    }
    if (!controller.signal.aborted) {
      const m = store.read(matterId),
        r = m.runs.find((r) => r.id === runId)!;
      r.status = Object.values(r.results).every((s) => s.state === "complete")
        ? "complete"
        : "partial";
      r.finished_at = new Date().toISOString();
      m.audit.push({
        at: r.finished_at,
        action: `Analysis ${r.status}`,
        run_id: runId,
      });
      store.save(m, m.revision);
    }
  } finally {
    activeJobs.delete(runId);
    store.controllers.delete(controller);
    jobControllers.delete(runId);
  }
}
