import {
  ChevronLeft,
  Copy,
  FileText,
  ImagePlus,
  Library,
  Loader2,
  Menu,
  Moon,
  PanelRightOpen,
  Plus,
  Send,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentStreamEvent,
  ChatHistoryItem,
  ChatResponse,
  Citation,
  DocumentRecord,
  Job,
  PageRecord,
  Project,
  RuntimeStatus,
  WorkspaceBrief,
} from "../lib/types";

const canonicalQuestions = [
  "Map the uploaded evidence: companies, document titles, periods covered, and key pages.",
  "Build a KPI tear sheet for each company: revenue, margins, EPS, and cash flow.",
  "Compare Apple FY26 Q2 with FY25 Q4 and explain what changed in revenue and margins.",
  "Explain Brunswick's operating margin movement: facts, management commentary, then inference.",
  "Verify the most important chart against the extracted table figures and flag mismatches.",
  "Read the strongest visual slide and summarize the financial takeaway with citations.",
  "Build an evidence-based investment diligence framework from these files.",
  "What should I investigate next before trusting this financial story?",
];

type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: ChatResponse["citations"];
  interrupted?: boolean;
  reviewActions?: ChatResponse["review_actions"];
  reviewThreadId?: string;
};

type AgentActivityStep = {
  label: string;
  detail: string;
  status: "active" | "done" | "pending";
};

type QueuedQuestion = {
  workspaceId: string;
  promptText: string;
  agentQuestion: string;
  attachments: File[];
  reviewTools: boolean;
};

async function api<T>(path: string, init?: RequestInit, timeoutMs = 180000): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Nemotron did not finish within 180 seconds. Try a narrower question, or ask for one KPI/section first.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    const text = await response.text();
    let detail = "";
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      detail = parsed.detail || "";
    } catch {
      detail = text;
    }
    throw new Error(detail || response.statusText);
  }
  return response.json() as Promise<T>;
}

export default function AnalystWorkspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [selectedPage, setSelectedPage] = useState<PageRecord | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [brief, setBrief] = useState<WorkspaceBrief | null>(null);
  const [chatAttachments, setChatAttachments] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [queuedCount, setQueuedCount] = useState(0);
  const [agentRunActive, setAgentRunActive] = useState(false);
  const [agentActivity, setAgentActivity] = useState<AgentActivityStep[]>([]);
  const [streamEvents, setStreamEvents] = useState<AgentStreamEvent[]>([]);
  const [streamDraft, setStreamDraft] = useState("");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const fileRef = useRef<HTMLInputElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const activeProjectRef = useRef("");
  const selectedDocumentRef = useRef("");
  const questionQueueRef = useRef<QueuedQuestion[]>([]);
  const processingQueueRef = useRef(false);
  const threadIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    void bootstrap();
    if (window.innerWidth < 860) {
      setRailCollapsed(true);
    }
    const storedTheme = window.localStorage.getItem("fra-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("fra-theme", theme);
  }, [theme]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, streamEvents, streamDraft]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!projectId) return;
    activeProjectRef.current = projectId;
    questionQueueRef.current = [];
    processingQueueRef.current = false;
    setQueuedCount(0);
    setBusy(false);
    setBusyLabel("");
    void refreshProject(projectId);
    void loadChatHistory(projectId);
    const timer = window.setInterval(() => {
      if (!busyRef.current && !processingQueueRef.current) {
        void refreshProject(projectId, false);
      }
    }, 3500);
    return () => window.clearInterval(timer);
  }, [projectId]);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    if (!selectedDocumentId) {
      selectedDocumentRef.current = "";
      setPages([]);
      setSelectedPage(null);
      return;
    }
    selectedDocumentRef.current = selectedDocumentId;
    const documentId = selectedDocumentId;
    void api<PageRecord[]>(`/pages?document_id=${documentId}`)
      .then((items) => {
        if (documentId !== selectedDocumentRef.current) return;
        setPages(items);
        setSelectedPage((current) => items.find((page) => page.id === current?.id) ?? items[0] ?? null);
      })
      .catch(() => {
        if (documentId !== selectedDocumentRef.current) return;
        setPages([]);
        setSelectedPage(null);
      });
  }, [selectedDocumentId]);

  const readyDocuments = documents.filter((document) => document.status === "ready");
  const currentProject = projects.find((project) => project.id === projectId);
  const visibleJobs = useMemo(() => {
    const seen = new Set<string>();
    return jobs.filter((job) => {
      const key = `${job.document_id}-${job.status}-${job.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [jobs]);
  const visionCoverage = useMemo(
    () =>
      documents.reduce(
        (totals, document) => ({
          analyzed: totals.analyzed + document.vision_pages_analyzed,
          possible: totals.possible + document.vision_pages_possible,
        }),
        { analyzed: 0, possible: 0 },
      ),
    [documents],
  );
  const evidenceTotals = useMemo(
    () =>
      documents.reduce(
        (totals, document) => ({
          text: totals.text + document.text_count,
          tables: totals.tables + document.table_count,
          visuals: totals.visuals + document.visual_count,
          kpis: totals.kpis + document.kpi_count,
        }),
        { text: 0, tables: 0, visuals: 0, kpis: 0 },
      ),
    [documents],
  );

  async function bootstrap() {
    const [existing, runtimeStatus] = await Promise.all([api<Project[]>("/projects"), api<RuntimeStatus>("/runtime")]);
    setRuntime(runtimeStatus);
    if (existing.length) {
      setProjects(existing);
      setProjectId(existing[0].id);
    return;
  }
    setProjects([]);
    setProjectId("");
  }

  async function refreshProject(id: string, flash = true) {
    if (flash) setBusy(true);
    try {
      const [docs, projectJobs] = await Promise.all([
        api<DocumentRecord[]>(`/documents?project_id=${id}`),
        api<Job[]>(`/jobs?project_id=${id}`),
      ]);
      const workspaceBrief = await api<WorkspaceBrief | null>(`/briefs?project_id=${id}`).catch(() => null);
      if (id !== activeProjectRef.current) return;
      setDocuments(docs);
      setBrief(workspaceBrief);
      setSelectedDocumentId((current) => current || docs[0]?.id || "");
      setJobs(projectJobs.filter((job) => !["complete", "error"].includes(job.status)));
    } finally {
      if (flash) setBusy(false);
    }
  }

  async function loadChatHistory(id: string) {
    setMessages([]);
    setThreadId(null);
    try {
      const history = await api<ChatHistoryItem[]>(`/chat/history?project_id=${id}`);
      if (id !== activeProjectRef.current) return;
      const restored: Message[] = [];
      for (const item of history) {
        if (item.question && item.question !== "Human review resumed") {
          restored.push({ role: "user", content: item.question });
        }
        restored.push({ role: "assistant", content: item.answer, citations: item.citations });
      }
      setMessages(restored);
      const lastThreadId = history[history.length - 1]?.thread_id ?? null;
      setThreadId(lastThreadId);
      threadIdRef.current = lastThreadId;
    } catch {
      if (id !== activeProjectRef.current) return;
      setMessages([]);
      setThreadId(null);
      threadIdRef.current = null;
    }
  }

  async function createProject(initialName?: string): Promise<Project | null> {
    const name = initialName || window.prompt("Project name", "New report review");
    if (!name) return null;
    const project = await api<Project>("/projects", { method: "POST", body: JSON.stringify({ name }) });
    activeProjectRef.current = project.id;
    setProjects((current) => [project, ...current]);
    setProjectId(project.id);
    setSelectedDocumentId("");
    setMessages([]);
    setThreadId(null);
    setBrief(null);
    return project;
  }

  async function deleteProject(id: string) {
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    const confirmed = window.confirm(`Delete workspace "${project.name}" and all uploaded files, extracted evidence, KPIs, and chat history?`);
    if (!confirmed) return;
    await api<{ status: string }>(`/projects/${id}`, { method: "DELETE" });
    const remaining = projects.filter((item) => item.id !== id);
    if (remaining.length) {
      setProjects(remaining);
      if (projectId === id) {
        setProjectId(remaining[0].id);
        setSelectedDocumentId("");
        setMessages([]);
        setThreadId(null);
        setBrief(null);
      }
      return;
    }
    setProjects([]);
    setProjectId("");
    setSelectedDocumentId("");
    setMessages([]);
    setThreadId(null);
    setBrief(null);
  }

  async function openUploadPicker() {
    if (!projectId) {
      const project = await createProject("Financial Report Review");
      if (!project) return;
      activeProjectRef.current = project.id;
    }
    fileRef.current?.click();
  }

  async function deleteDocument(id: string) {
    const document = documents.find((item) => item.id === id);
    if (!document) return;
    const confirmed = window.confirm(`Delete "${document.filename}" and its extracted text, tables, visuals, and KPIs?`);
    if (!confirmed) return;
    await api<{ status: string }>(`/documents/${id}`, { method: "DELETE" });
    setDocuments((current) => current.filter((item) => item.id !== id));
    setJobs((current) => current.filter((item) => item.document_id !== id));
    if (selectedDocumentId === id) {
      const next = documents.find((item) => item.id !== id);
      setSelectedDocumentId(next?.id || "");
      setPages([]);
      setSelectedPage(null);
    }
    await refreshProject(projectId, false);
  }

  async function uploadFiles(files: FileList | null) {
    const workspaceId = projectId || activeProjectRef.current;
    if (!files || !workspaceId) return;
    setBusy(true);
    setAgentRunActive(false);
    setBusyLabel("Uploading evidence for Cosmos visual extraction...");
    try {
      await uploadFileArray(Array.from(files), workspaceId);
      if (workspaceId !== activeProjectRef.current) return;
      setBusyLabel("Waiting for ingestion and Cosmos visual observations...");
      await waitForIngestion(workspaceId);
      await announceWorkspaceBrief(workspaceId);
    } catch (error) {
      if (workspaceId === activeProjectRef.current) {
        setMessages((current) => [...current, { role: "assistant", content: error instanceof Error ? error.message : "Upload failed." }]);
      }
    } finally {
      if (workspaceId === activeProjectRef.current) {
        setBusy(false);
        setBusyLabel("");
      }
    }
  }

  async function uploadFileArray(files: File[], workspaceId = projectId) {
    if (!files.length || !workspaceId) return;
    const createdJobs: Job[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      const job = await api<Job>(`/documents?project_id=${workspaceId}`, { method: "POST", body: form });
      createdJobs.push(job);
    }
    if (workspaceId === activeProjectRef.current) {
      setJobs((current) => [...createdJobs, ...current]);
    }
  }

  async function ask(text = question) {
    const trimmed = text.trim();
    if (!trimmed && !chatAttachments.length) return;
    let workspaceId = projectId;
    if (!workspaceId) {
      const project = await createProject("Financial Report Review");
      if (!project) return;
      workspaceId = project.id;
      activeProjectRef.current = project.id;
    }
    setQuestion("");
    const attachments = chatAttachments;
    setChatAttachments([]);
    const promptText = trimmed || "Analyze the attached financial evidence.";
    const agentQuestion = attachments.length
      ? `${promptText}\n\nAttached files just uploaded: ${attachments.map((file) => file.name).join(", ")}. Treat image and screenshot attachments as Cosmos visual evidence and cite the visual/page artifact.`
      : promptText;
    setMessages((current) => [
      ...current,
      {
        role: "user",
        content: attachments.length ? `${promptText}\n\nAttached: ${attachments.map((file) => file.name).join(", ")}` : promptText,
      },
    ]);
    enqueueQuestion({
      workspaceId,
      promptText,
      agentQuestion,
      attachments,
      reviewTools: needsHumanReview(agentQuestion),
    });
  }

  function enqueueQuestion(item: QueuedQuestion) {
    questionQueueRef.current.push(item);
    setQueuedCount(questionQueueRef.current.length);
    void drainQuestionQueue();
  }

  async function drainQuestionQueue() {
    if (processingQueueRef.current) return;
    processingQueueRef.current = true;
    setBusy(true);
    setAgentRunActive(true);
    try {
      while (questionQueueRef.current.length) {
        const item = questionQueueRef.current.shift();
        setQueuedCount(questionQueueRef.current.length);
        if (!item || item.workspaceId !== activeProjectRef.current) continue;
        try {
          setBusyLabel(item.attachments.length ? "Uploading evidence for Cosmos visual extraction..." : "Understanding your finance question...");
          setAgentActivity(buildAgentActivity(item.attachments.length > 0, item.reviewTools, "ingesting"));
          if (item.attachments.length) {
            await uploadFileArray(item.attachments, item.workspaceId);
            if (item.workspaceId !== activeProjectRef.current) continue;
            setBusyLabel("Waiting for ingestion and Cosmos visual observations...");
            setAgentActivity(buildAgentActivity(true, item.reviewTools, "ingesting"));
            await waitForIngestion(item.workspaceId);
          }
          setBusyLabel(item.attachments.length ? "Reading Cosmos visual evidence with Nemotron..." : "Deep Agent is planning with financial tools and subagents...");
          setAgentActivity(buildAgentActivity(item.attachments.length > 0, item.reviewTools, "planning"));
          setStreamEvents([]);
          setStreamDraft("");
          const response = await runChatStream(item);
          if (item.workspaceId !== activeProjectRef.current) continue;
          setAgentActivity(buildAgentActivity(item.attachments.length > 0, item.reviewTools, response.interrupted ? "review" : "answering"));
          threadIdRef.current = response.thread_id;
          setThreadId(response.thread_id);
          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              content: response.answer,
              citations: response.citations,
              interrupted: response.interrupted,
              reviewActions: response.review_actions,
              reviewThreadId: response.thread_id,
            },
          ]);
          if (response.citations.length) {
            await selectCitation(response.citations[0]);
          }
        } catch (error) {
          if (item.workspaceId === activeProjectRef.current) {
            setMessages((current) => [...current, { role: "assistant", content: error instanceof Error ? error.message : "Analysis failed." }]);
          }
        }
      }
    } finally {
      processingQueueRef.current = false;
      setBusy(false);
      setAgentRunActive(false);
      setBusyLabel("");
      setQueuedCount(0);
      setAgentActivity([]);
      setStreamEvents([]);
      setStreamDraft("");
    }
  }

  async function runChatStream(item: QueuedQuestion): Promise<ChatResponse> {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: item.workspaceId,
        question: item.agentQuestion,
        thread_id: threadIdRef.current,
        human_review: item.reviewTools,
      }),
    });
    if (!response.ok || !response.body) {
      const text = await response.text();
      throw new Error(text || response.statusText);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResponse: ChatResponse | null = null;
    const startedAt = window.setTimeout(() => reader.cancel("Nemotron did not finish within 180 seconds."), 180000);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const event = parseSseEvent(part);
          if (!event) continue;
          if (event.type === "error") {
            throw new Error(event.message || "Deep Agent stream failed.");
          }
          if (event.type === "final" && event.response) {
            finalResponse = event.response;
            continue;
          }
          handleAgentStreamEvent(event);
        }
      }
    } finally {
      window.clearTimeout(startedAt);
    }
    if (!finalResponse) {
      throw new Error("Deep Agent stream ended before returning a final answer.");
    }
    return finalResponse;
  }

  function handleAgentStreamEvent(event: AgentStreamEvent) {
    if (event.type === "done" || event.type === "final") return;
    const displayEvent = { ...event, message: formatStreamEventMessage(event) };
    setStreamEvents((current) => {
      const previous = current[current.length - 1];
      if (previous?.type === displayEvent.type && previous.message === displayEvent.message) {
        return current;
      }
      return [...current.slice(-7), displayEvent];
    });
    if (event.type === "token" && event.message) {
      setStreamDraft((current) => (current + event.message).slice(-900));
      setAgentActivity(buildAgentActivity(false, false, "answering"));
      return;
    }
    if (event.type === "subagent") {
      setBusyLabel(event.message || "Subagent is working through evidence...");
      setAgentActivity(buildAgentActivity(false, false, "planning"));
      return;
    }
    if (event.type === "review") {
      setBusyLabel(event.message || "Deep Agent paused for evidence review...");
      setAgentActivity(buildAgentActivity(false, true, "review"));
    }
  }

  async function waitForIngestion(workspaceId: string) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      if (workspaceId !== activeProjectRef.current) return;
      await refreshProject(workspaceId, false);
      const projectJobs = await api<Job[]>(`/jobs?project_id=${workspaceId}`);
      if (!projectJobs.some((job) => !["complete", "error"].includes(job.status))) {
        await refreshProject(workspaceId, false);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    await refreshProject(workspaceId, false);
  }

  async function announceWorkspaceBrief(workspaceId: string) {
    const workspaceBrief = await api<WorkspaceBrief | null>(`/briefs?project_id=${workspaceId}`).catch(() => null);
    if (workspaceId !== activeProjectRef.current) return;
    if (!workspaceBrief) return;
    setBrief(workspaceBrief);
    const prompts = workspaceBrief.suggested_questions.slice(0, 3).map((prompt) => `- ${prompt}`).join("\n");
    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        content:
          `I finished reading ${workspaceBrief.source_document_count} evidence file${workspaceBrief.source_document_count === 1 ? "" : "s"}. What would you like me to investigate first?` +
          (prompts ? `\n\nGood next questions:\n${prompts}` : ""),
      },
    ]);
  }

  async function selectCitation(citation: Citation) {
    setSelectedDocumentId(citation.document_id);
    const citedPages = await api<PageRecord[]>(`/pages?document_id=${citation.document_id}`);
    setPages(citedPages);
    setSelectedPage(citedPages.find((page) => page.page_number === citation.page_number) ?? citedPages[0] ?? null);
    setEvidenceOpen(true);
  }

  async function resumeReview(reviewThreadId: string, decision: "approve" | "reject", actionCount: number) {
    if (!projectId) return;
    const decisions = Array.from({ length: Math.max(actionCount, 1) }, () => ({ type: decision }));
    setBusy(true);
    setBusyLabel(decision === "approve" ? "Continuing after human review..." : "Rejecting the reviewed tool actions...");
    try {
      const response = await api<ChatResponse>("/chat/resume", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, thread_id: reviewThreadId, decisions }),
      });
      setThreadId(response.thread_id);
      threadIdRef.current = response.thread_id;
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: response.answer,
          citations: response.citations,
          interrupted: response.interrupted,
          reviewActions: response.review_actions,
          reviewThreadId: response.thread_id,
        },
      ]);
      if (response.citations.length) {
        await selectCitation(response.citations[0]);
      }
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", content: error instanceof Error ? error.message : "Human review resume failed." }]);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  return (
    <main className={`appShell ${railCollapsed ? "railCollapsed" : ""} ${evidenceOpen ? "drawerOpen" : ""}`}>
      <input
        ref={fileRef}
        className="visuallyHidden"
        type="file"
        multiple
        accept=".pdf,.pptx,.docx,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp"
        onChange={(event) => void uploadFiles(event.currentTarget.files)}
      />
      <input
        ref={chatFileRef}
        className="visuallyHidden"
        type="file"
        multiple
        accept=".pdf,.pptx,.docx,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files || []);
          setChatAttachments((current) => [...current, ...files]);
          event.currentTarget.value = "";
        }}
      />

      <nav className="topNav">
        <div className="navCluster">
          <button className="iconButton" onClick={() => setRailCollapsed((value) => !value)} title={railCollapsed ? "Open sidebar" : "Collapse sidebar"}>
            {railCollapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
          </button>
          <div className="productMark">
            <div className="markIcon">
              <span>🐧</span>
            </div>
            <div>
              <small>Financial Deep Agent</small>
              <strong>Report Analyst</strong>
            </div>
          </div>
        </div>

        <div className="providerBadges" aria-label="Model and framework providers">
          <ProviderBadge label="Nebius" logo="/logos/nebius.png" />
          <ProviderBadge label="Nemotron Ultra" logo="/logos/nemotron.png" />
          <ProviderBadge label="LangChain" logo="/logos/langchain.png" />
        </div>

        <div className="navActions">
          <button className="primaryButton" onClick={() => void openUploadPicker()}>
            <Upload size={16} />
            Upload
          </button>
          <button className="iconButton" onClick={() => setTheme((value) => (value === "light" ? "dark" : "light"))} title="Toggle theme">
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </nav>

      <aside className="leftRail">
        <section className="railSection historySection">
          <div className="sectionHeading">
            <span>History</span>
            <span>Recent workspaces</span>
          </div>
          <button className="newChatButton" onClick={() => void createProject()}>
            <Plus size={15} />
            New workspace
          </button>
          <div className="projectList">
            {projects.map((project) => (
              <div key={project.id} className={project.id === projectId ? "projectItemShell active" : "projectItemShell"}>
                <button
                  className="projectItem"
                onClick={() => {
                  setProjectId(project.id);
                    setMessages([]);
                    setThreadId(null);
                    threadIdRef.current = null;
                  if (window.innerWidth < 860) {
                    setRailCollapsed(true);
                  }
                  }}
                >
                  <strong>{project.name}</strong>
                  <span>{project.id === projectId ? "Current analysis" : "Open workspace"}</span>
                </button>
                <button className="miniButton dangerButton" onClick={() => void deleteProject(project.id)} title="Delete workspace">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="railSection">
          <div className="sectionHeading">
            <span>Documents</span>
            {busy ? <Loader2 className="spin" size={15} /> : <Library size={15} />}
          </div>
          <div className="docList">
            {documents.map((document) => (
              <div key={document.id} className={document.id === selectedDocumentId ? "docItemShell active" : "docItemShell"}>
                <button
                  className="docItem"
                  onClick={() => {
                    setSelectedDocumentId(document.id);
                    setEvidenceOpen(true);
                    if (window.innerWidth < 860) {
                      setRailCollapsed(true);
                    }
                  }}
                >
                  <FileText size={16} />
                  <span>{document.filename}</span>
                  <small className={`status ${document.status}`}>{document.status}</small>
                  <div className="docEvidenceBadges">
                    {!!document.text_count && <small>Text {document.text_count}</small>}
                    {!!document.table_count && <small>Table {document.table_count}</small>}
                    {document.vision_coverage !== "off" && document.vision_pages_possible > 0 && (
                      <small>Cosmos {document.vision_pages_analyzed}/{document.vision_pages_possible}</small>
                    )}
                    {!!document.kpi_count && <small>KPI {document.kpi_count}</small>}
                    {!document.text_count && !document.table_count && !document.visual_count && document.status === "ready" && <small>Visual only</small>}
                  </div>
                </button>
                <button className="miniButton dangerButton" onClick={() => void deleteDocument(document.id)} title="Delete file">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!documents.length && <div className="emptyBlock">Upload annual reports, earnings decks, or tables to begin.</div>}
          </div>
        </section>

        {!!visibleJobs.length && (
          <section className="railSection">
            <div className="sectionHeading">Processing</div>
            <div className="jobList">
              {visibleJobs.map((job) => (
                <div className="jobItem" key={job.id}>
                  <Loader2 className="spin" size={14} />
                  <span>
                    <strong>{jobDocumentName(job, documents)}</strong>
                    {friendlyJobMessage(job)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="railSection">
          <div className="sectionHeading">Quick Questions</div>
          <div className="promptList">
            {canonicalQuestions.map((item) => (
              <button key={item} onClick={() => void ask(item)}>
                {item}
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="chatStage">
        <header className="chatHeader">
          <div>
            <small>{currentProject?.name || "Financial Report Review"}</small>
            <h1>Ask across uploaded reports</h1>
            <p>
              Nemotron reasons over extracted evidence. {readyDocuments.length} ready docs · {evidenceTotals.text} text · {evidenceTotals.tables} tables · {evidenceTotals.visuals} Cosmos visuals · {evidenceTotals.kpis} KPIs.
              {runtime && ` Cosmos inspected ${visionCoverage.analyzed}/${visionCoverage.possible} visual pages.`}
            </p>
          </div>
          <button className="secondaryButton" onClick={() => setEvidenceOpen((value) => !value)}>
            <PanelRightOpen size={16} />
            Evidence
          </button>
        </header>

        <div className="messageViewport" ref={messagesRef}>
          {runtime && !runtime.nebius_configured && (
            <div className="runtimeNotice">
              Nebius API key is required for chat analysis. Add `NEBIUS_API_KEY` in `backend/.env`, restart the backend, then re-upload documents so Cosmos can create visual observations.
            </div>
          )}

          {brief && (
            <AnalystBriefCard
              brief={brief}
              onPick={(prompt) => {
                setQuestion(prompt);
              }}
            />
          )}

          {!messages.length && !brief && (
            <div className="emptyChat">
              <div className="emptyIcon">
                <span>🐧</span>
              </div>
              <h2>Deep financial analyst, ready.</h2>
              <p>Ask finance questions now, or upload evidence for cited report analysis across PDFs, decks, spreadsheets, and images.</p>
              <div className="starterGrid">
                {canonicalQuestions.map((item) => (
                  <button key={item} onClick={() => void ask(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={`chatMessage ${message.role}`}>
              <div className="avatar">{message.role === "assistant" ? <span>🐧</span> : <span>You</span>}</div>
              <div className="messageBody">
                <MessageContent content={message.content} />
                <div className="messageActions">
                  <button className="miniButton" onClick={() => void navigator.clipboard?.writeText(message.content)} title="Copy response">
                    <Copy size={14} />
                  </button>
                </div>
                {!!message.citations?.length && (
                  <div className="citationRow">
                    {message.citations.map((citation, citationIndex) => (
                      <button key={`${citation.document_id}-${citation.page_number}-${citationIndex}`} onClick={() => void selectCitation(citation)}>
                        {citation.document_name} · p.{citation.page_number} · {citation.source_kind}
                      </button>
                    ))}
                  </div>
                )}
                {message.interrupted && !!message.reviewActions?.length && message.reviewThreadId && (
                  <div className="reviewActions">
                    <div>
                      <strong>Evidence tool review</strong>
                      <p>The Deep Agent paused before running these tool calls. Approve to inspect the evidence, or reject to continue without those tools.</p>
                    </div>
                    <ul>
                      {message.reviewActions.map((action, actionIndex) => (
                        <li key={`${action.name || "tool"}-${actionIndex}`}>
                          <span>{formatReviewActionName(action.name)}</span>
                          <small>{formatReviewActionArgs(action.args)}</small>
                        </li>
                      ))}
                    </ul>
                    <div className="reviewButtonRow">
                      <button type="button" disabled={busy} onClick={() => void resumeReview(message.reviewThreadId || "", "approve", message.reviewActions?.length || 1)}>
                        Approve and continue
                      </button>
                      <button type="button" disabled={busy} onClick={() => void resumeReview(message.reviewThreadId || "", "reject", message.reviewActions?.length || 1)}>
                        Reject tools
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </article>
          ))}

          {busy && agentRunActive && (
            <article className="chatMessage assistant">
              <div className="avatar">
                <span>🐧</span>
              </div>
              <div className="messageBody thinking">
                <Loader2 className="spin" size={16} />
                <div>
                  <span>
                    {busyLabel || (readyDocuments.length ? "Understanding your finance question..." : "Thinking through the finance question...")}
                    {queuedCount > 0 ? ` · ${queuedCount} queued` : ""}
                  </span>
                  {!!agentActivity.length && <AgentActivity steps={agentActivity} />}
                  {!!streamEvents.length && <StreamTrace events={streamEvents} draft={streamDraft} />}
                </div>
              </div>
            </article>
          )}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          {!!chatAttachments.length && (
            <div className="attachmentStrip">
              {chatAttachments.map((file, index) => (
                <span key={`${file.name}-${index}`}>
                  {file.name}
                  <button type="button" onClick={() => setChatAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="composerInput">
            <button className="miniButton" type="button" onClick={() => chatFileRef.current?.click()} title="Attach evidence">
              <ImagePlus size={15} />
            </button>
            <textarea
              value={question}
              rows={1}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              placeholder="Ask why margins moved, which region grew fastest, or whether a chart matches a table"
            />
          </div>
          <button className="sendButton" disabled={!question.trim() && !chatAttachments.length} title={busy ? "Queue question" : "Send question"}>
            <Send size={18} />
          </button>
        </form>
      </section>

      <aside className="evidenceDrawer">
        <div className="drawerHeader">
          <div>
            <strong>Evidence</strong>
            <span>{selectedPage ? `Page ${selectedPage.page_number}` : "No page selected"}</span>
          </div>
          <button className="iconButton" onClick={() => setEvidenceOpen(false)} title="Close evidence">
            <X size={17} />
          </button>
        </div>

        <section className="drawerSection">
          <div className="sectionHeading">
            <span>Pages</span>
            {!!pages.length && <span>{pages.length}</span>}
          </div>
          <div className="pageStrip">
            {pages.map((page) => (
              <button key={page.id} className={selectedPage?.id === page.id ? "pageChip active" : "pageChip"} onClick={() => setSelectedPage(page)}>
                {page.page_number}
              </button>
            ))}
            {!pages.length && <span>No rendered pages yet.</span>}
          </div>
        </section>

        <section className="drawerSection">
          <div className="sectionHeading">
            <span>Page Preview</span>
            {selectedPage && <span>p.{selectedPage.page_number}</span>}
          </div>
          <div className="pagePreview">
            {selectedPage?.image_url ? (
              <img src={selectedPage.image_url} alt={`Page ${selectedPage.page_number}`} />
            ) : (
              <div className="drawerEmpty">{selectedPage?.text || "Select a processed document page."}</div>
            )}
          </div>
        </section>

        <section className="drawerSection evidencePanel">
          <div className="sectionHeading">
            <span>Cosmos Visual Observation</span>
            {selectedPage?.visual_count ? <span>{selectedPage.visual_count}</span> : null}
          </div>
          <div className="extractText visualText">
            {selectedPage?.visual_summary ||
              (selectedPage?.image_url ? "No Cosmos visual observation stored for this page yet." : "Visual observations appear for rendered pages, screenshots, charts, and slides.")}
          </div>
        </section>

        <section className="drawerSection evidencePanel">
          <div className="sectionHeading">
            <span>Extracted Text</span>
            {selectedPage?.text ? <span>{selectedPage.text.length.toLocaleString()} chars</span> : null}
          </div>
          <div className="extractText">
            {selectedPage?.text?.slice(0, 1800) ||
              (selectedPage?.visual_count ? "No selectable/OCR text was extracted; use the Cosmos visual observation above." : "Text extraction appears after ingestion.")}
          </div>
        </section>
      </aside>
    </main>
  );
}

function AgentActivity({ steps }: { steps: AgentActivityStep[] }) {
  return (
    <div className="agentActivity" aria-label="Deep Agent activity">
      {steps.map((step) => (
        <span key={step.label} className={`agentActivityStep ${step.status}`}>
          <i />
          <span>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </span>
        </span>
      ))}
    </div>
  );
}

function StreamTrace({ events, draft }: { events: AgentStreamEvent[]; draft: string }) {
  const visibleEvents = compactStreamEvents(events.filter((event) => event.type !== "token")).slice(-4);
  return (
    <div className="streamTrace" aria-label="Live Deep Agent stream">
      {!!visibleEvents.length && (
        <div className="streamEvents">
          {visibleEvents.map((event, index) => (
            <span key={`${event.type}-${index}`}>
              <strong>{event.type === "subagent" ? "Subagent" : event.type === "review" ? "Review" : "Main"}</strong>
              {event.message || "Deep Agent update"}
            </span>
          ))}
        </div>
      )}
      {!!draft.trim() && (
        <p>
          <strong>Live output</strong>
          {draft.trim()}
        </p>
      )}
    </div>
  );
}

function compactStreamEvents(events: AgentStreamEvent[]): AgentStreamEvent[] {
  return events.filter((event, index) => {
    const previous = events[index - 1];
    return !(previous?.type === event.type && previous.message === event.message);
  });
}

function formatStreamEventMessage(event: AgentStreamEvent): string {
  const raw = (event.message || "").trim();
  const lowered = raw.toLowerCase();
  if (event.type === "review") return "Waiting for your approval before selected evidence tools run.";
  if (event.type === "subagent") return "A specialist subagent is analyzing a focused part of the evidence.";
  if (event.type === "token") return raw;
  if (lowered.includes("step: model")) return "Nemotron is planning the next finance step.";
  if (lowered.includes("step: tools")) return "Deep Agent is calling compact evidence tools.";
  if (lowered.includes("middleware")) return "Finance guardrails and answer formatting are being applied.";
  if (lowered.includes("structured") || lowered.includes("response")) return "The cited answer is being assembled.";
  if (raw) return raw.replace(/^Main agent step:\s*/i, "").replace(/^Subagent step:\s*/i, "");
  return event.type === "main" ? "Deep Agent is working." : "Agent update.";
}

function buildAgentActivity(hasAttachments: boolean, reviewTools: boolean, stage: "ingesting" | "planning" | "review" | "answering"): AgentActivityStep[] {
  const steps: AgentActivityStep[] = [];
  if (hasAttachments) {
    steps.push({
      label: "Cosmos intake",
      detail: "Images and pages become visual observations",
      status: stage === "ingesting" ? "active" : "done",
    });
  }
  steps.push(
    {
      label: "Deep Agent graph",
      detail: "Nemotron plans with financial tools",
      status: stage === "ingesting" ? "pending" : stage === "planning" ? "active" : "done",
    },
    {
      label: "Specialists",
      detail: "KPI, visual, filing, or risk subagents as needed",
      status: stage === "planning" ? "active" : stage === "ingesting" ? "pending" : "done",
    },
    {
      label: reviewTools ? "Review checkpoint" : "Evidence tools",
      detail: reviewTools ? "Pause before approved tool calls" : "Compact evidence tools stay grounded",
      status: stage === "review" ? "active" : stage === "answering" ? "done" : "pending",
    },
    {
      label: "Cited answer",
      detail: "Formats facts, inference, gaps, and citations",
      status: stage === "answering" ? "active" : "pending",
    },
  );
  return steps;
}

function parseSseEvent(part: string): AgentStreamEvent | null {
  const data = part
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as AgentStreamEvent;
  } catch {
    return { type: "error", message: "Could not parse Deep Agent stream event." };
  }
}

function AnalystBriefCard({ brief, onPick }: { brief: WorkspaceBrief; onPick: (prompt: string) => void }) {
  const chips = [...brief.companies, ...brief.periods].slice(0, 5);
  const primaryPrompts = brief.suggested_questions.length
    ? brief.suggested_questions.slice(0, 3)
    : [
        "Summarize the uploaded evidence and covered periods.",
        "Which KPIs changed the most?",
        "What should I investigate next?",
      ];
  return (
    <section className="briefCard">
      <div className="briefHeader">
        <div>
          <small>Evidence Ready</small>
          <strong>{brief.source_document_count} file{brief.source_document_count === 1 ? "" : "s"} read. What should I investigate?</strong>
        </div>
        <span>{brief.confidence}</span>
      </div>
      {!!chips.length && (
        <div className="briefChips">
          {chips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
      )}
      <div className="briefQuestions">
        {primaryPrompts.map((prompt) => (
          <button key={prompt} type="button" onClick={() => onPick(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
    </section>
  );
}

function jobDocumentName(job: Job, documents: DocumentRecord[]): string {
  const document = documents.find((item) => item.id === job.document_id);
  if (!document?.filename) return "Evidence file";
  return document.filename.length > 28 ? `${document.filename.slice(0, 25)}...` : document.filename;
}

function friendlyJobMessage(job: Job): string {
  if (job.status === "queued") return "Queued for analysis.";
  if (job.status === "error") return job.message || "Analysis failed.";
  if (/nebius/i.test(job.message)) return "Waiting for model configuration.";
  if (/extracting/i.test(job.message)) return "Reading text, tables, KPIs, and visuals.";
  if (/upload/i.test(job.message)) return "Upload saved.";
  return job.message || "Processing evidence.";
}

function needsHumanReview(question: string): boolean {
  const lowered = question.toLowerCase();
  return [
    "human review",
    "approval mode",
    "approve tools",
    "ask before tools",
    "ask me before using tools",
    "review before tools",
    "controlled run",
  ].some((term) => lowered.includes(term));
}

function formatReviewActionName(name?: string): string {
  const clean = (name || "evidence tool").replace(/^agent_/, "").replace(/_/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function formatReviewActionArgs(args?: Record<string, unknown>): string {
  if (!args) return "No arguments supplied.";
  const entries = Object.entries(args).filter(([key]) => !["runtime", "project_id", "document_ids"].includes(key));
  if (!entries.length) return "No arguments supplied.";
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${formatArgValue(value)}`)
    .join(" · ");
}

function formatArgValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "any";
  if (Array.isArray(value)) return value.map(formatArgValue).join(", ");
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${formatArgValue(item)}`).join(", ");
  return String(value);
}

function ProviderBadge({ label, logo }: { label: string; logo: string }) {
  return (
    <span className="providerBadge">
      <img src={logo} alt="" />
      {label}
    </span>
  );
}

function MessageContent({ content }: { content: string }) {
  const blocks = useMemo(() => parseMessageBlocks(content), [content]);
  return (
    <div className="messageText">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return <h3 key={index}>{cleanInline(block.lines[0])}</h3>;
        }
        if (block.kind === "list") {
          return (
            <ul key={index}>
              {block.lines.map((line, lineIndex) => (
                <li key={lineIndex}>{cleanInline(line.replace(/^[-*]\s*/, ""))}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "table") {
          const rows = block.lines
            .filter((line) => !/^\|\s*[-:\s|]+\s*\|?$/.test(line))
            .map((line) => line.split("|").map((cell) => cleanInline(cell.trim())).filter(Boolean));
          return (
            <div className="answerTableWrap" key={index}>
              <table>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={index}>{cleanInline(block.lines.join(" "))}</p>;
      })}
    </div>
  );
}

type MessageBlock = {
  kind: "heading" | "list" | "paragraph" | "table";
  lines: string[];
};

function parseMessageBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let current: MessageBlock | null = null;
  const push = () => {
    if (current?.lines.length) blocks.push(current);
    current = null;
  };
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      push();
      continue;
    }
    const kind: MessageBlock["kind"] = line.includes("|") && line.split("|").length > 2 ? "table" : /^[-*]\s+/.test(line) ? "list" : /:$/u.test(line) && line.length < 80 ? "heading" : "paragraph";
    if (!current || current.kind !== kind || kind === "heading") {
      push();
      current = { kind, lines: [] };
    }
    current.lines.push(line.replace(/^#{1,4}\s*/, ""));
  }
  push();
  return blocks.length ? blocks : [{ kind: "paragraph", lines: [content] }];
}

function cleanInline(value: string): string {
  return value.replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
}
