export type Health = "ok" | "warn" | "error";

export interface ClusterStatus {
  connected: boolean;
  error?: string | null;
  source?: string;
  context?: string;
  server?: string;
  cluster_kind?: string;
  kubernetes_version?: string;
  demo_namespace?: string;
  civo_cluster?: { id: string; name?: string; region?: string } | null;
}

export interface Overview {
  fetched_at: number;
  namespace: string;
  namespaces: string[];
  warning?: string;
  nodes: { name: string; ready: boolean; version: string; cpu: string; memory: string }[];
  deployments: { name: string; replicas: number; ready: number; updated: number; health: Health; images: string[] }[];
  pods: { name: string; status: string; ready: boolean; restarts: number; last_termination?: string | null; health: Health; owner?: string | null }[];
  services: { name: string; type: string; selector: Record<string, string>; ports: number[]; ready_endpoints: number; health: Health }[];
}

export interface TopoNode { id: string; kind: string; name: string; health: Health; detail: string }
export interface TopoEdge { source: string; target: string; kind: "owns" | "endpoint" | "selects"; observed: boolean }
export interface Topology { namespace: string; nodes: TopoNode[]; edges: TopoEdge[]; fetched_at: number; error?: string }

export interface Experiment {
  id: string; title: string; failure: string; symptom: string; repair: string; capabilities: string[];
  expected_outcome: string; budget: { max_seconds: number; max_steps: number };
  status: { state: string; run_id?: string | null; busy?: boolean; pending_approvals?: string[] };
}

export interface Run {
  id: string; scenario_id: string; provenance: string; replay_of?: string | null; provider?: string | null; model?: string | null;
  policy_mode?: string | null; state: string; created_at: number; started_at?: number | null; ended_at?: number | null;
  repo_commit?: string; cluster?: Record<string, any>; settings?: Record<string, any>; metrics?: Record<string, any> | null;
  outcome?: Record<string, any> | null; first_attempt_success?: number | null; eventual_success?: number | null; error?: string | null;
}

export interface RunEvent { id: number; run_id: string; seq: number; ts: number; type: string; payload: Record<string, any> }
