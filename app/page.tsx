"use client";
import { useEffect, useState, useRef } from "react";
import {
  FileText,
  FolderOpen,
  LockKeyhole,
  Plus,
  ShieldCheck,
  ArrowUpRight,
  Check,
  X,
  BookOpen,
  RefreshCw,
  Download,
  ChevronRight,
} from "lucide-react";
import {
  scenarios,
  type MatterView,
  type MatterSummary,
  type ScenarioId,
  type Finding,
  type Run,
  type Review,
} from "@/lib/types";
type Pack = {
  hash: string;
  files: Record<string, string>;
  provider: {
    enabled: boolean;
    provider: string;
    model: string;
    maxCharacters: number;
    contextTokens: number;
    reason: string;
  };
};
const labels = {
  extracted: "EXTRACTED",
  derived: "DERIVED",
  review_required: "REVIEW REQUIRED",
};
export default function App() {
  const [session, setSession] = useState<{
      configured: boolean;
      unlocked: boolean;
    } | null>(null),
    [pass, setPass] = useState(""),
    [confirmPass, setConfirmPass] = useState(""),
    [apiKey, setApiKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [matters, setMatters] = useState<MatterSummary[]>([]),
    [matter, setMatter] = useState<MatterView | null>(null),
    [pack, setPack] = useState<Pack | null>(null),
    [view, setView] = useState<
      "analysis" | "source" | "review" | "history" | "instructions"
    >("source");
  const [scenario, setScenario] = useState<ScenarioId>("funding"),
    [selectedRun, setSelectedRun] = useState(""),
    [selected, setSelected] = useState<Finding | null>(null),
    [blockId, setBlockId] = useState(""),
    [query, setQuery] = useState(""),
    [instruction, setInstruction] = useState("00-system.md"),
    [notice, setNotice] = useState("");
  const [note, setNote] = useState(""),
    [correction, setCorrection] = useState(""),
    [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null),
    lockRef = useRef<() => void>(() => {}),
    idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionEpoch = useRef(0);
  async function api(url: string, method = "GET", body?: unknown) {
    const epoch = sessionEpoch.current;
    const r = await fetch("/api/" + url, {
      method,
      headers: {
        "x-agreement-request": "1",
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(body
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
    const d = await r.json();
    if (epoch !== sessionEpoch.current)
      throw new Error("This request ended after the workspace was locked.");
    if (!r.ok) {
      if (r.status === 401) {
        setSession((s) => (s ? { ...s, unlocked: false } : null));
        clearPrivate();
      }
      throw new Error(d.error || "Request failed.");
    }
    return d;
  }
  function clearPrivate() {
    sessionEpoch.current++;
    setMatter(null);
    setMatters([]);
    setPack(null);
    setSelected(null);
    setNote("");
    setCorrection("");
    setDirty(false);
    setPass("");
    setConfirmPass("");
    setApiKey("");
    setNotice("");
  }
  async function refresh() {
    const [list, p] = await Promise.all([api("matters"), api("instructions")]);
    setMatters(list);
    setPack(p);
  }
  useEffect(() => {
    api("session")
      .then((s) => {
        setSession(s);
        if (s.unlocked) refresh().catch((e) => setError(e.message));
      })
      .catch((e) => setError(e.message));
  }, []); // Local session only: no document data is stored in browser storage.
  async function lock() {
    try {
      await api("session", "DELETE");
    } finally {
      clearPrivate();
      setSession((s) => (s ? { ...s, unlocked: false } : null));
    }
  }
  lockRef.current = () => {
    void lock();
  };
  useEffect(() => {
    if (!session?.unlocked) return;
    function reset() {
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => lockRef.current(), 30 * 60 * 1000);
    }
    reset();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      if (idle.current) clearTimeout(idle.current);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [session?.unlocked]);
  useEffect(() => {
    if (!matter?.runs.some((r) => r.status === "running") || !session?.unlocked)
      return;
    const id = matter.id;
    const timer = setInterval(() => {
      api("matters/" + id)
        .then((m) => setMatter((current) => (current?.id === id ? m : current)))
        .catch((e) => setError(e.message));
    }, 2500);
    return () => clearInterval(timer);
  }, [
    matter?.id,
    matter?.runs.some((r) => r.status === "running"),
    session?.unlocked,
  ]);
  useEffect(() => {
    function before(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  async function act(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The operation failed.");
    } finally {
      setBusy(false);
    }
  }
  const run =
    matter?.runs.find((r) => r.id === selectedRun) || matter?.runs.at(-1);
  const result = run?.results[scenario],
    block = matter?.source.blocks.find((b) => b.id === blockId);
  const currentReview =
    selected && run ? run.reviews[`${scenario}:${selected.id}`] : undefined;
  const unresolved = run
    ? Object.values(run.results).flatMap(
        (s) => s.analysis?.open_questions || [],
      ).length
    : 0;
  const reviewCount = run
    ? scenarios.reduce(
        (n, s) =>
          n +
          (run.results[s.id].analysis?.findings.filter(
            (f) =>
              (f.classification === "review_required" ||
                f.classification === "derived") &&
              run.reviews[`${s.id}:${f.id}`]?.state !== "reviewed",
          ).length || 0),
        0,
      )
    : 0;
  function canLeave() {
    return !dirty || window.confirm("Discard your unsaved review changes?");
  }
  function inspect(f: Finding, sid: ScenarioId = scenario) {
    if (!canLeave()) return false;
    setScenario(sid);
    setSelected(f);
    setBlockId(f.evidence[0]?.block_id || "");
    const r = run?.reviews[`${sid}:${f.id}`];
    setNote(r?.note || "");
    setCorrection(r?.correction || "");
    setDirty(false);
    return true;
  }
  async function openMatter(id: string) {
    if (!canLeave()) return;
    const m = await api("matters/" + id);
    setMatter(m);
    setSelectedRun(m.runs.at(-1)?.id || "");
    setSelected(null);
    setBlockId(m.source.blocks[0]?.id || "");
    setDirty(false);
    setView(m.runs.length ? "analysis" : "source");
    setQuery("");
  }
  async function saveReview(state: Review["state"]) {
    if (!matter || !run || !selected) return;
    const m = await api(`matters/${matter.id}/review`, "POST", {
      revision: matter.revision,
      run_id: run.id,
      scenario_id: scenario,
      finding_id: selected.id,
      state,
      note,
      correction,
    });
    setMatter(m);
    setDirty(false);
    setNotice(
      state === "reviewed"
        ? "Marked reviewed. Original analysis retained."
        : "Review saved.",
    );
  }
  function switchView(next: typeof view) {
    if (!canLeave()) return;
    setDirty(false);
    setSelected(null);
    setView(next);
  }
  function download(url: string) {
    const a = document.createElement("a");
    a.href = "/api/" + url;
    a.download = "";
    a.click();
  }
  if (!session?.unlocked)
    return (
      <div className="lock-screen">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              if (!session?.configured && pass !== confirmPass)
                throw new Error("The passphrases do not match.");
              await api("session", "POST", {
                passphrase: pass,
                create: !session?.configured,
              });
              setPass("");
              setConfirmPass("");
              setSession({ configured: true, unlocked: true });
              await refresh();
            });
          }}
        >
          <div className="brand">
            <FileText size={22} /> Accord Institute <span>PRIVATE</span>
          </div>
          <LockKeyhole size={28} />
          <h1>
            {session?.configured
              ? "Unlock your workspace"
              : "Create your private workspace"}
          </h1>
          <p>
            Documents, generated findings and review history are encrypted on
            this Mac. Your passphrase unlocks the vault.
          </p>
          <label>
            Vault passphrase
            <input
              autoFocus
              autoComplete={
                session?.configured ? "current-password" : "new-password"
              }
              type="password"
              minLength={14}
              maxLength={256}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              required
            />
          </label>
          {!session?.configured && (
            <>
              <label>
                Confirm passphrase
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  required
                />
              </label>
              <small>
                Use at least 14 characters. Keep it in your password manager: a
                lost passphrase cannot be recovered.
              </small>
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button disabled={busy || !session} className="primary">
            {busy
              ? "Opening…"
              : session?.configured
                ? "Unlock workspace"
                : "Create encrypted vault"}
          </button>
          <small>Encrypted on your Mac · Analysis via OpenAI</small>
        </form>
      </div>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <FileText size={20} />
          Accord Institute
        </div>
        <span className="eyebrow">AGREEMENT INTELLIGENCE</span>
        <button
          className="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Plus size={16} />
          Import agreement
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f || !canLeave()) return;
            void act(async () => {
              const data = new FormData();
              data.set("document", f);
              const m = await api("matters", "POST", data);
              setMatter(m);
              setSelected(null);
              setSelectedRun("");
              setBlockId(m.source.blocks[0]?.id || "");
              setDirty(false);
              setView("source");
              await refresh();
            });
          }}
        />
        <div className="matter-list">
          {matters.map((m) => (
            <button
              key={m.id}
              className={matter?.id === m.id ? "active" : ""}
              onClick={() => void act(() => openMatter(m.id))}
            >
              <FileText size={15} />
              <span>
                {m.title}
                <small>
                  {m.format.toUpperCase()} · {m.runs} analysis runs
                </small>
              </span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => switchView("instructions")}>
            <BookOpen size={15} />
            Connection &amp; instructions
          </button>
          <button onClick={() => download("backup")}>
            <Download size={15} />
            Encrypted backup
          </button>
          <button
            onClick={() => {
              if (canLeave()) void act(lock);
            }}
          >
            <LockKeyhole size={15} />
            Lock workspace
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <div>
            <strong>{matter?.title || "Accord workspace"}</strong>
            <span>Stored on this Mac · Analysis via OpenAI</span>
          </div>
          <div className="local">
            <ShieldCheck size={15} />
            {pack?.provider.enabled
              ? pack.provider.model
              : "Model not connected"}
          </div>
        </header>
        {error && (
          <div className="error toast" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {view === "instructions" ? (
          <main className="instruction-view">
            <h1>Connection &amp; instructions</h1>
            <p>
              These Markdown files guide each run. Edit them in the project’s
              instructions folder; the next run uses the new version. Every
              saved run keeps its exact instruction snapshot.
            </p>
            <section className="connection">
              <strong>OpenAI API</strong>
              <p>
                {pack?.provider.enabled
                  ? `Key saved · ${pack.provider.model}`
                  : "Add your API key to enable agreement analysis."}
              </p>
              <p>
                Extracted agreement text and Markdown instructions go directly from this
                Mac to OpenAI when you select Generate analysis. Files and saved reviews
                remain encrypted here. A full run uses eight model requests and incurs API charges.
              </p>
              <form onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  try {
                    const provider = await api("provider", "POST", { apiKey });
                    setPack((p) => p ? { ...p, provider } : p);
                    setNotice("API key saved in your encrypted vault. Test the connection before your first analysis.");
                  } finally { setApiKey(""); }
                });
              }}>
                <label>
                  {pack?.provider.enabled ? "Replace API key" : "OpenAI API key"}
                  <input type="password" autoComplete="off" spellCheck={false}
                    maxLength={512} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-…" required />
                </label>
                <div className="connection-actions">
                  <button className="primary" disabled={busy || !apiKey.trim()}>
                    {pack?.provider.enabled ? "Save replacement key" : "Save API key"}
                  </button>
                  {pack?.provider.enabled && <>
                    <button type="button" className="button" disabled={busy}
                      onClick={() => void act(async () => {
                        const result = await api("provider/test", "POST");
                        setNotice(result.message);
                      })}>Test connection</button>
                    <button type="button" className="button" disabled={busy}
                      onClick={() => void act(async () => {
                        const provider = await api("provider", "DELETE");
                        setPack((p) => p ? { ...p, provider } : p);
                        setApiKey("");
                        setNotice("API key removed from this app. You can revoke it separately in OpenAI.");
                      })}>Remove key</button>
                  </>}
                </div>
              </form>
              <small>
                OpenAI does not train on API data by default unless you opt in.
                Stored responses are disabled here; standard abuse-monitoring logs may
                still be retained for up to 30 days. This is not zero data retention.
                Use non-sensitive agreements while evaluating this build. Review your
                project’s retention terms before confidential client use. {" "}
                <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">OpenAI data controls</a>
                {" · "}<a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Create an API key</a>
              </small>
            </section>
            <p className="muted">
              Current instruction fingerprint: {pack?.hash.slice(0, 16)}
            </p>
            <div className="instruction-grid">
              <nav>
                {Object.keys(pack?.files || {}).map((f) => (
                  <button
                    className={instruction === f ? "active" : ""}
                    key={f}
                    onClick={() => setInstruction(f)}
                  >
                    {f}
                  </button>
                ))}
                <button className="button" onClick={() => void act(refresh)}>
                  <RefreshCw size={14} />
                  Reload files
                </button>
              </nav>
              <pre>{pack?.files[instruction]}</pre>
            </div>
          </main>
        ) : !matter ? (
          <main className="empty">
            <FolderOpen size={40} />
            <h1>Your agreements</h1>
            <p>
              Import an agreement, check the source text, and generate the four
              scenario analyses.
            </p>
            {!pack?.provider.enabled && <button className="button" onClick={() => switchView("instructions")}>Connect OpenAI</button>}
            <button
              className="primary"
              onClick={() => fileRef.current?.click()}
            >
              Import agreement
            </button>
            <small>
              PDF with readable text, Word (.docx), or UTF-8 text · up to 15 MB
            </small>
            <p className="muted">
              Scanned PDFs need OCR before import. Importing stays on this Mac;
              generating analysis sends extracted text to OpenAI.
            </p>
          </main>
        ) : (
          <>
            <nav className="tabs">
              {(
                [
                  ["source", "Source document"],
                  ["analysis", "Scenario Analysis"],
                  ["review", `Review Queue ${reviewCount}`],
                  ["history", "Run history"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={view === id ? "active" : ""}
                  onClick={() => switchView(id)}
                >
                  {label}
                </button>
              ))}
              <button
                title="Sends extracted agreement text to OpenAI for analysis"
                className="run-button"
                disabled={
                  busy ||
                  !pack?.provider.enabled ||
                  !matter.source.confirmed_at ||
                  matter.runs.some((r) => r.status === "running")
                }
                onClick={() =>
                  void act(async () => {
                    if (!canLeave()) return;
                    const m = await api(`matters/${matter.id}/analyze`, "POST");
                    setMatter(m);
                    setSelectedRun(m.runs.at(-1).id);
                    setView("analysis");
                    setSelected(null);
                    setDirty(false);
                    await refresh();
                  })
                }
              >
                <RefreshCw size={14} />
                {matter.runs.some((r) => r.status === "running")
                  ? "Analysis running…"
                  : "Generate analysis"}
              </button>
              {matter.runs.some((r) => r.status === "running") && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () =>
                      setMatter(
                        await api(`matters/${matter.id}/cancel`, "POST"),
                      ),
                    )
                  }
                >
                  Stop analysis
                </button>
              )}
            </nav>
            <div
              className={`content ${block && (view === "source" || selected) ? "with-source" : ""}`}
            >
              <main>
                {view === "source" && (
                  <>
                    <div className="heading">
                      <div>
                        <h1>Source document</h1>
                        <p>
                          {matter.source.filename} ·{" "}
                          {matter.source.blocks.length} source locations
                        </p>
                      </div>
                      <button
                        className="button"
                        onClick={() =>
                          download(`matters/${matter.id}/original`)
                        }
                      >
                        <Download size={14} />
                        Original file
                      </button>
                    </div>
                    <div className="source-check">
                      <strong>
                        {matter.source.confirmed_at
                          ? "Source text checked"
                          : "Check the imported text before analysis"}
                      </strong>
                      <p>
                        Compare the text with the original, including schedules
                        and definitions. Citations will point to this extracted
                        text.
                      </p>
                      {matter.source.warnings.map((w) => (
                        <p className="warning" key={w}>
                          {w}
                        </p>
                      ))}
                      {!matter.source.confirmed_at && (
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void act(async () =>
                              setMatter(
                                await api(
                                  `matters/${matter.id}/confirm`,
                                  "POST",
                                ),
                              ),
                            )
                          }
                        >
                          I checked the text against the original
                        </button>
                      )}
                    </div>
                    <input
                      className="search"
                      aria-label="Search source"
                      placeholder="Search the document text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {matter.source.blocks
                      .filter((b) =>
                        b.text.toLowerCase().includes(query.toLowerCase()),
                      )
                      .map((b) => (
                        <button
                          className={`source-row ${blockId === b.id ? "active" : ""}`}
                          key={b.id}
                          onClick={() => {
                            setBlockId(b.id);
                            setSelected(null);
                          }}
                        >
                          <strong>
                            {b.locator}
                            <ChevronRight size={13} />
                          </strong>
                          <p>
                            {b.text.slice(0, 260) ||
                              "No readable text detected."}
                          </p>
                        </button>
                      ))}
                  </>
                )}
                {view === "analysis" && (
                  <>
                    <div className="heading">
                      <h1>Scenario Analysis</h1>
                      {run && <span className="pill">{run.status}</span>}
                    </div>
                    <label className="select-label">
                      Scenario
                      <select
                        value={scenario}
                        onChange={(e) => {
                          if (!canLeave()) return;
                          setScenario(e.target.value as ScenarioId);
                          setSelected(null);
                          setDirty(false);
                        }}
                      >
                        {scenarios.map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!run ? (
                      <div className="empty small">
                        <h2>Ready for a first analysis</h2>
                        <p>
                          {!matter.source.confirmed_at
                            ? "Check the imported source text first."
                            : !pack?.provider.enabled
                              ? pack?.provider.reason
                              : "Generate analysis to run the four guided scenarios."}
                        </p>
                      </div>
                    ) : (
                      <>
                        <p className="muted">
                          Run {new Date(run.created_at).toLocaleString()} ·
                          instructions {run.pack_hash.slice(0, 12)} ·{" "}
                          {run.model}
                        </p>
                        {result?.state !== "complete" ? (
                          <div className="source-check">
                            <h2>
                              {result?.state === "checking"
                                ? "Critiquing the draft"
                                : result?.state === "drafting"
                                  ? "Reading the agreement"
                                  : result?.state === "failed"
                                    ? "Scenario needs another run"
                                    : "Waiting for this scenario"}
                            </h2>
                            <p>
                              {result?.error ||
                                "OpenAI is drafting and checking the analysis using your instruction pack. You can leave this view; keep the app running and vault unlocked. Completed scenarios appear as they finish."}
                            </p>
                          </div>
                        ) : (
                          <>
                            <p className="analysis-summary">
                              {result.analysis?.summary}
                            </p>
                            <span className="pill">
                              Coverage:{" "}
                              {result.analysis?.coverage.replace("_", " ")}
                            </span>
                            {result.analysis?.findings.map((f) => (
                              <article className="finding" key={f.id}>
                                <div className="finding-top">
                                  <span>{f.stage.replace("_", " ")}</span>
                                  <span className={`badge ${f.classification}`}>
                                    {labels[f.classification]}
                                  </span>
                                  {run.reviews[`${scenario}:${f.id}`]?.state ===
                                    "reviewed" && (
                                    <span className="badge reviewed">
                                      REVIEWED
                                    </span>
                                  )}
                                </div>
                                <button
                                  className="finding-title"
                                  onClick={() => inspect(f)}
                                >
                                  {f.title}
                                  <ArrowUpRight size={14} />
                                </button>
                                <p>{f.analysis}</p>
                                {f.depends_on.length > 0 && (
                                  <p className="dependencies">
                                    Requires:{" "}
                                    {f.depends_on
                                      .map(
                                        (id) =>
                                          result.analysis?.findings.find(
                                            (n) => n.id === id,
                                          )?.title,
                                      )
                                      .join(" · ")}
                                  </p>
                                )}
                                <div className="citations">
                                  {f.evidence.map((e, i) => (
                                    <button
                                      key={i}
                                      onClick={() => {
                                        if (inspect(f)) setBlockId(e.block_id);
                                      }}
                                    >
                                      {
                                        matter.source.blocks.find(
                                          (b) => b.id === e.block_id,
                                        )?.locator
                                      }
                                    </button>
                                  ))}
                                </div>
                              </article>
                            ))}
                            <OpenQuestions
                              questions={result.analysis?.open_questions || []}
                            />
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
                {view === "review" && (
                  <>
                    <h1>Review Queue</h1>
                    <p className="muted">
                      Derived and review-required findings retain their original
                      classification after review. Unresolved source questions
                      remain below.
                    </p>
                    {!run ? (
                      <p>No analysis yet.</p>
                    ) : (
                      <>
                        {scenarios.map((s) => (
                          <section key={s.id}>
                            <h2>{s.name}</h2>
                            {run.results[s.id].analysis?.findings
                              .filter((f) => f.classification !== "extracted")
                              .map((f) => (
                                <article className="queue-row" key={f.id}>
                                  <button
                                    className="finding-title"
                                    onClick={() => inspect(f, s.id)}
                                  >
                                    {f.title}
                                  </button>
                                  <div>
                                    <span
                                      className={`badge ${f.classification}`}
                                    >
                                      {labels[f.classification]}
                                    </span>
                                    <span className="badge">
                                      {run.reviews[`${s.id}:${f.id}`]?.state ===
                                      "reviewed"
                                        ? "REVIEWED"
                                        : "OPEN"}
                                    </span>
                                  </div>
                                </article>
                              )) || (
                              <p className="muted">
                                No completed analysis for this scenario.
                              </p>
                            )}
                            <OpenQuestions
                              questions={
                                run.results[s.id].analysis?.open_questions || []
                              }
                            />
                          </section>
                        ))}
                        <p>
                          {unresolved} unresolved source questions. Review
                          annotations do not resolve missing documents.
                        </p>
                      </>
                    )}
                  </>
                )}
                {view === "history" && (
                  <>
                    <div className="heading">
                      <h1>Run history</h1>
                      <button
                        className="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              "Export a readable report? The downloaded file will not be encrypted by this app.",
                            )
                          )
                            download(`matters/${matter.id}/report`);
                        }}
                      >
                        <Download size={14} />
                        Export readable report
                      </button>
                    </div>
                    <p>
                      New runs preserve earlier results and reviews. Review
                      marks are not carried forward automatically.
                    </p>
                    {matter.runs
                      .slice()
                      .reverse()
                      .map((r) => (
                        <article className="run-row" key={r.id}>
                          <button
                            className="finding-title"
                            onClick={() => {
                              setSelectedRun(r.id);
                              setView("analysis");
                              setSelected(null);
                            }}
                          >
                            {new Date(r.created_at).toLocaleString()}
                            <ChevronRight size={14} />
                          </button>
                          <p>
                            {r.status} · {r.model} · instructions{" "}
                            {r.pack_hash.slice(0, 16)}
                          </p>
                          <details>
                            <summary>Exact instructions used</summary>
                            <p>
                              Engine {r.engine_version || "0.2.0"} · context{" "}
                              {r.context_tokens?.toLocaleString() ||
                                "not recorded"}
                            </p>
                            <p className="muted">
                              Model fingerprint:{" "}
                              {r.model_digest || "Version pinned in model name"}
                              <br />
                              Source fingerprint: {r.source_hash}
                            </p>
                            {Object.entries(r.instructions).map(
                              ([name, text]) => (
                                <section key={name}>
                                  <h3>{name}</h3>
                                  <pre>{text}</pre>
                                </section>
                              ),
                            )}
                          </details>
                        </article>
                      ))}
                    <h2>Review history</h2>
                    {matter.audit
                      .slice()
                      .reverse()
                      .map((a, i) => (
                        <div className="audit" key={i}>
                          <strong>{a.action}</strong>
                          <span>{new Date(a.at).toLocaleString()}</span>
                          {a.finding_id && <small>{a.finding_id}</small>}
                          {a.previous && (
                            <details>
                              <summary>Previous review</summary>
                              <p>{a.previous.note}</p>
                              <p>{a.previous.correction}</p>
                            </details>
                          )}
                        </div>
                      ))}
                  </>
                )}
              </main>
              {block && (view === "source" || selected) && (
                <aside className="inspector">
                  <div className="inspector-top">
                    <strong>Source · {block.locator}</strong>
                    <button
                      aria-label="Close source"
                      onClick={() => {
                        if (canLeave()) {
                          setSelected(null);
                          setBlockId("");
                          setDirty(false);
                        }
                      }}
                    >
                      <X size={17} />
                    </button>
                  </div>
                  <div className="inspector-scroll">
                    <p className="muted">{matter.source.filename}</p>
                    <SourceText
                      text={block.text}
                      quotes={
                        selected?.evidence
                          .filter((e) => e.block_id === block.id)
                          .map((e) => e.quote) || []
                      }
                    />
                    {selected && (
                      <>
                        <div className="citations">
                          {selected.evidence.map((e, i) => (
                            <button
                              key={i}
                              onClick={() => setBlockId(e.block_id)}
                            >
                              {
                                matter.source.blocks.find(
                                  (b) => b.id === e.block_id,
                                )?.locator
                              }
                            </button>
                          ))}
                        </div>
                        <section className="interpretation">
                          <h2>{selected.title}</h2>
                          <p>{selected.analysis}</p>
                          <dl>
                            <dt>Original classification</dt>
                            <dd>{labels[selected.classification]}</dd>
                            <dt>Review status</dt>
                            <dd>
                              {currentReview?.state === "reviewed"
                                ? "REVIEWED"
                                : "OPEN"}
                            </dd>
                          </dl>
                          <label>
                            Reviewer correction
                            <textarea
                              rows={5}
                              value={correction}
                              onChange={(e) => {
                                setCorrection(e.target.value);
                                setDirty(true);
                              }}
                              placeholder="Record a correction; the original generated finding is preserved."
                            />
                          </label>
                          <label>
                            Review note
                            <textarea
                              rows={4}
                              value={note}
                              onChange={(e) => {
                                setNote(e.target.value);
                                setDirty(true);
                              }}
                            />
                          </label>
                          <div className="review-actions">
                            <button
                              disabled={busy}
                              className="button"
                              onClick={() =>
                                void act(() =>
                                  saveReview(currentReview?.state || "open"),
                                )
                              }
                            >
                              Save changes
                            </button>
                            <button
                              disabled={busy}
                              className="primary"
                              onClick={() =>
                                void act(() =>
                                  saveReview(
                                    currentReview?.state === "reviewed"
                                      ? "open"
                                      : "reviewed",
                                  ),
                                )
                              }
                            >
                              {currentReview?.state === "reviewed" ? (
                                "Reopen"
                              ) : (
                                <>
                                  <Check size={14} />
                                  Mark reviewed
                                </>
                              )}
                            </button>
                          </div>
                          <small>
                            {dirty
                              ? "Unsaved changes"
                              : "Saved review stays in this encrypted vault."}{" "}
                            Review does not establish legal correctness.
                          </small>
                        </section>
                      </>
                    )}
                  </div>
                </aside>
              )}
            </div>
          </>
        )}
        <footer>
          Encrypted local storage · OpenAI analysis · Locks after 30 idle minutes · Generated analysis
          requires legal review · {busy ? "Saving…" : "Vault unlocked"}
        </footer>
      </div>
    </div>
  );
}
function OpenQuestions({
  questions,
}: {
  questions: { question: string; reason: string }[];
}) {
  return questions.length ? (
    <section className="questions">
      <h3>Open questions</h3>
      {questions.map((q, i) => (
        <div key={i}>
          <strong>{q.question}</strong>
          <p>{q.reason}</p>
        </div>
      ))}
    </section>
  ) : null;
}
function SourceText({ text, quotes }: { text: string; quotes: string[] }) {
  const ranges = quotes
    .map((q) => ({ start: text.indexOf(q), end: text.indexOf(q) + q.length }))
    .filter((r) => r.start >= 0)
    .sort((a, b) => a.start - b.start);
  const merged: typeof ranges = [];
  for (const r of ranges) {
    const prev = merged.at(-1);
    if (prev && r.start <= prev.end) prev.end = Math.max(prev.end, r.end);
    else merged.push({ ...r });
  }
  let cursor = 0;
  const parts: React.ReactNode[] = [];
  for (const r of merged) {
    parts.push(
      text.slice(cursor, r.start),
      <mark key={r.start}>{text.slice(r.start, r.end)}</mark>,
    );
    cursor = r.end;
  }
  parts.push(text.slice(cursor));
  return <p className="source-text">{parts}</p>;
}
