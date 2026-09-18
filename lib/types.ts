export const scenarios = [
  { id: "funding", name: "Funding default" },
  { id: "deadlock", name: "Major-decision deadlock" },
  { id: "removal", name: "Operator removal / default" },
  { id: "transfer", name: "Transfer / exit" },
] as const;
export type ScenarioId = (typeof scenarios)[number]["id"];
export type SourceBlock = {
  id: string;
  locator: string;
  text: string;
  page?: number;
};
export type Evidence = { block_id: string; quote: string };
export type Finding = {
  id: string;
  stage:
    | "trigger"
    | "condition"
    | "notice"
    | "cure"
    | "right"
    | "obligation"
    | "consequence"
    | "review_issue";
  classification: "extracted" | "derived" | "review_required";
  title: string;
  analysis: string;
  evidence: Evidence[];
  depends_on: string[];
};
export type ScenarioAnalysis = {
  coverage: "located" | "not_located" | "uncertain";
  summary: string;
  findings: Finding[];
  open_questions: {
    question: string;
    reason: string;
    source_block_ids: string[];
  }[];
};
export type Review = {
  state: "open" | "reviewed";
  note: string;
  correction: string;
  updated_at: string;
};
export type ScenarioResult = {
  state: "pending" | "drafting" | "checking" | "complete" | "failed";
  analysis?: ScenarioAnalysis;
  error?: string;
};
export type Run = {
  id: string;
  created_at: string;
  finished_at?: string;
  status: "running" | "complete" | "partial" | "interrupted";
  source_hash: string;
  pack_hash: string;
  instructions: Record<string, string>;
  provider: string;
  model: string;
  engine_version?: string;
  model_digest?: string;
  context_tokens?: number;
  results: Record<ScenarioId, ScenarioResult>;
  reviews: Record<string, Review>;
};
export type Audit = {
  at: string;
  action: string;
  run_id?: string;
  finding_id?: string;
  previous?: Review;
  next?: Review;
};
export type Matter = {
  id: string;
  title: string;
  created_at: string;
  revision: number;
  source: {
    filename: string;
    format: "pdf" | "docx" | "txt";
    hash: string;
    original: string;
    blocks: SourceBlock[];
    warnings: string[];
    confirmed_at?: string;
  };
  runs: Run[];
  audit: Audit[];
};
export type MatterView = Omit<Matter, "source"> & {
  source: Omit<Matter["source"], "original">;
};
export type MatterSummary = {
  id: string;
  title: string;
  created_at: string;
  format: string;
  blocks: number;
  runs: number;
  latest_status?: string;
};
