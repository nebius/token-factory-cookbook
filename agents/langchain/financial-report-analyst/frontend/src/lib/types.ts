export type Project = {
  id: string;
  name: string;
  created_at: string;
};

export type Job = {
  id: string;
  project_id: string;
  document_id: string;
  status: string;
  message: string;
  updated_at: string;
};

export type DocumentRecord = {
  id: string;
  project_id: string;
  filename: string;
  content_type: string;
  status: string;
  page_count: number;
  vision_coverage: string;
  vision_pages_analyzed: number;
  vision_pages_possible: number;
  summary: string;
  error: string;
  created_at: string;
  text_count: number;
  table_count: number;
  visual_count: number;
  kpi_count: number;
};

export type PageRecord = {
  id: string;
  document_id: string;
  page_number: number;
  text: string;
  image_url?: string | null;
  visual_summary: string;
  visual_count: number;
};

export type WorkspaceBrief = {
  project_id: string;
  summary: string;
  periods: string[];
  companies: string[];
  key_kpis: string[];
  visual_findings: string[];
  suggested_questions: string[];
  missing_evidence: string[];
  confidence: string;
  source_document_count: number;
  updated_at?: string | null;
};

export type KPIRecord = {
  id: string;
  document_id: string;
  document_name: string;
  metric: string;
  period: string;
  value: number;
  unit: string;
  segment: string;
  page_number: number;
  source_text: string;
};

export type Citation = {
  document_id: string;
  document_name: string;
  page_number: number;
  source_kind: string;
  source_id: string;
  label: string;
  artifact_url?: string | null;
};

export type ChatResponse = {
  thread_id: string;
  answer: string;
  citations: Citation[];
  structured_answer?: {
    summary: string;
    management_stated_causes: string[];
    arithmetic_facts: string[];
    inference: string[];
    citations: Citation[];
    confidence: string;
    needs_more_evidence: string[];
  } | null;
  interrupted: boolean;
  review_actions: Array<{
    name?: string;
    args?: Record<string, unknown>;
    description?: string;
  }>;
};

export type ResearchPlanResponse = {
  summary: string;
  steps: string[];
  tools: string[];
  subagents: string[];
  evidence_needed: string[];
  output_format: string[];
  guardrails: string[];
  confidence: "low" | "medium" | "high" | string;
};

export type ChatHistoryItem = {
  id: string;
  thread_id: string;
  question: string;
  answer: string;
  citations: Citation[];
  created_at: string;
};

export type AgentStreamEvent = {
  type: "main" | "subagent" | "token" | "review" | "final" | "done" | "error";
  message?: string;
  namespace?: string[];
  nodes?: string[];
  source?: "main" | "subagent";
  review_actions?: ChatResponse["review_actions"];
  response?: ChatResponse;
};

export type ComparePoint = {
  document_id: string;
  document_name: string;
  metric: string;
  period: string;
  value: number;
  unit: string;
  segment: string;
  page_number: number;
  source_text: string;
};

export type RuntimeStatus = {
  model_calls_enabled: boolean;
  nebius_configured: boolean;
  reasoning_model: string;
  vision_model: string;
  max_vision_pages: number;
};
