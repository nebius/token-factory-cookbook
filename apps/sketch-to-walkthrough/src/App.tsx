import { useEffect, useRef, useState } from 'react';
import { Logo, Icon } from './components/Logo';
import { DetailSlider } from './components/DetailSlider';
import { WalkControls } from './components/WalkControls';
import { runGenerator, type BuildResult } from './lib/builder';
import { SAMPLE_SOURCE, SAMPLES } from './lib/sample';
import { formatMM, paramValues, type Assumption, type ParamDef, type PlanSpec } from './lib/plan';
import { runChecks, type CheckResults } from './lib/checks';
import { applyFurnishing } from './lib/furniture';
import { planToSVG, svgToPng } from './lib/plan-svg';
import { PlanViewer, type ViewMode, type ViewerHandle } from './three/PlanViewer';
import { exportGLB, exportPlan, exportSource, exportSVG } from './lib/exports';
import './styles.css';

type Usage = { kind: string; model: string; completion: number; total: number; elapsed: number; tokensPerSecond: number };
type Version = {
  id: number; source: string; plan: PlanSpec | null; params: Record<string, ParamDef>; originalParams: Record<string, ParamDef>; assumptions: Assumption[];
  checks: CheckResults | null; repairs: string[]; error?: string; verdict?: string; issues?: string[]; improvements?: string[]; elapsed?: number;
};
type Progress = { title: string; detail: string; step: number } | null;

async function imageFile(file: File | Blob) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  return canvas.toDataURL('image/png');
}
async function sampleImage(path: string) { return imageFile(await (await fetch(path)).blob()); }
async function api(path: string, payload: object) {
  // Allow the server's three 20-minute stream attempts, plus retry overhead.
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(3900000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}
function versionFromBuild(id: number, source: string, result: BuildResult, autoFurniture = true): Version {
  const plan = applyFurnishing(result.plan, autoFurniture);
  return { id, source, ...result, plan, originalParams: structuredClone(result.params), checks: runChecks(plan) };
}
const orderedEntries = (params: Record<string, ParamDef>) => Object.entries(params).sort(([, a], [, b]) => a.group.localeCompare(b.group));

function App() {
  const [screen, setScreen] = useState<'home' | 'studio'>('home');
  const [demo, setDemo] = useState<BuildResult | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [activeId, setActiveId] = useState(1);
  const [sketch, setSketch] = useState('');
  const [sketchName, setSketchName] = useState('two-bedroom.png');
  const [progress, setProgress] = useState<Progress>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ViewMode>('dollhouse');
  const [tab, setTab] = useState<'dimensions' | 'assumptions' | 'checks'>('dimensions');
  const [labels, setLabels] = useState(true);
  const [locked, setLocked] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [model, setModel] = useState('moonshotai/Kimi-K3.1-Pro');
  const [exporting, setExporting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [firstWalkableElapsed, setFirstWalkableElapsed] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [paramElapsed, setParamElapsed] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);
  const [autoFurniture, setAutoFurniture] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<ViewerHandle | null>(null);
  const runRef = useRef(0);
  const editRef = useRef(0);
  const exportRef = useRef<HTMLDivElement>(null);
  const activeVersion = versions.find((v) => v.id === activeId) ?? versions.at(-1);
  const version = activeVersion?.plan ? activeVersion : versions.filter((v) => v.plan).at(-1);
  const plan = version?.plan;
  const paramEntries = version ? orderedEntries(version.params) : [];
  const newerVersion = activeVersion ? versions.filter((v) => v.id > activeVersion.id && v.plan && v.checks?.ok).at(-1) : undefined;

  useEffect(() => { runGenerator(SAMPLE_SOURCE).then(setDemo).catch(console.error); }, []);
  useEffect(() => { fetch('/api/health').then((r) => r.json()).then((r) => setModel(r.model)).catch(() => {}); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, []);

  const goHome = () => { runRef.current++; setScreen('home'); setProgress(null); setError(''); setMode('dollhouse'); setLocked(false); setVersions([]); };
  const loadDemo = async (sample = SAMPLES[0]) => {
    const id = ++runRef.current; setScreen('studio'); setSketch(sample.image); setSketchName(`${sample.id}.png`); setError(''); setProgress({ title: 'Opening your sample', detail: 'A ready-made plan. No model call needed.', step: 1 });
    try {
      const result = demo ?? await runGenerator(SAMPLE_SOURCE); if (runRef.current !== id) return;
      setVersions([versionFromBuild(1, SAMPLE_SOURCE, result)]); setActiveId(1); setMode('dollhouse'); setTab('dimensions'); setUsage([]); setElapsed(0); setFirstWalkableElapsed(null); setProgress(null);
    } catch (e) { setProgress(null); setError((e as Error).message); }
  };
  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Choose a PNG, JPEG, or WebP sketch.'); return; }
    if (file.size > 12_000_000) { setError('This image is too large. Choose a file smaller than 12 MB.'); return; }
    setError(''); setSketchName(file.name); setSketch(await imageFile(file)); await generate(file);
  };
  const generate = async (file: File | Blob) => {
    const id = ++runRef.current; const started = performance.now();
    const data = await imageFile(file);
    setScreen('studio'); setSketch(data); setVersions([]); setUsage([]); setMode('plan'); setError(''); setTab('checks'); setElapsed(0); setFirstWalkableElapsed(null);
    setProgress({ title: 'Reading between the lines', detail: 'Kimi is reading your rooms and written dimensions.', step: 0 });
    let code = '', usedRefinement = false, firstValidId: number | null = null, lastReview: { verdict: string; issues: string[]; improvements: string[] } | null = null;
    try {
      const call = await api('/api/generate', { image: data }); if (runRef.current !== id) return;
      setUsage((u) => [...u, { ...call, completion: call.usage.completion, total: call.usage.total, kind: 'Generate' }]); code = call.code;
      for (let number = 1; number <= 3; number++) {
        let next: Version;
        let checkedRender: string | undefined;
        setProgress({ title: number === 1 ? 'Turning lines into geometry' : `Refining your plan · v${number}`, detail: firstValidId ? 'A newer version is being checked. Keep exploring the current one.' : 'Building in a sandbox. Engineering every connection.', step: 1 });
        try {
          const result = await runGenerator(code); if (runRef.current !== id) return;
          next = versionFromBuild(number, code, result, autoFurniture);
        } catch (e) {
          next = { id: number, source: code, plan: null, params: {}, originalParams: {}, assumptions: [], checks: null, repairs: [], error: (e as Error).message };
        }
        if (runRef.current !== id) return;
        setVersions((old) => { const existing = old.filter((v) => v.id !== number); return [...existing, next]; });
        if (next.plan && next.checks?.ok && firstValidId === null) {
          firstValidId = number;
          setActiveId(number);
          setMode('dollhouse');
          setTab('dimensions');
          setFirstWalkableElapsed((performance.now() - started) / 1000);
          setToast(`v${number} is walkable. Vision review continues in the background.`);
        } else if (firstValidId === null) setActiveId(number);
        setProgress({ title: firstValidId ? 'Reviewing in the background' : 'A second pair of eyes', detail: `Kimi is comparing v${number} with the original sketch.`, step: 2 });
        if (next.plan) checkedRender = await svgToPng(planToSVG(next.plan, { width: 1400 }));
        if (runRef.current !== id) return;
        const review = await api('/api/review', { sketch: data, code, render: checkedRender, failures: next.checks?.failures ?? [], buildError: next.error });
        if (runRef.current !== id) return;
        setUsage((u) => [...u, { ...review, completion: review.usage.completion, total: review.usage.total, kind: `Review v${number}` }]);
        lastReview = { verdict: review.verdict, issues: review.issues, improvements: review.improvements };
        const updated = { ...next, verdict: review.verdict, issues: review.issues, improvements: review.improvements };
        setVersions((old) => old.map((v) => v.id === number ? updated : v));
        const wantsRefinement = review.verdict === 'PASS' && review.improvements.length > 0;
        if ((review.verdict === 'REVISE' || (wantsRefinement && !usedRefinement && Boolean(review.code))) && number < 3) {
          if (wantsRefinement) usedRefinement = true;
          code = review.code || code; continue;
        }
        setElapsed((performance.now() - started) / 1000); setProgress(null);
        if (firstValidId === null) setTab('checks');
        return;
      }
      setProgress(null); setElapsed((performance.now() - started) / 1000);
      if (lastReview?.verdict === 'REVISE') setToast('Three versions complete. The latest engineering notes are in Checks.');
    } catch (e) {
      if (runRef.current !== id) return;
      setProgress(null); setError((e as Error).message); setElapsed((performance.now() - started) / 1000);
      if (versions.length) setToast('The last valid version is still available.');
    }
  };
  const regenerate = async () => {
    if (!sketch) return;
    const blob = await (await fetch(sketch)).blob(); await generate(blob);
  };
  const trySample = async (sample: typeof SAMPLES[number]) => {
    setSketchName(`${sample.id}.png`); setSketch(sample.image); const image = await sampleImage(sample.image); await generate(await (await fetch(image)).blob());
  };
  const editParam = async (name: string, value: number) => {
    if (!version) return;
    const id = ++editRef.current; const versionId = version.id;
    const updatedParams = { ...version.params, [name]: { ...version.params[name], value } };
    setVersions((old) => old.map((v) => v.id === versionId ? { ...v, params: updatedParams } : v)); setUpdating(true);
    try {
      const result = await runGenerator(version.source, paramValues(updatedParams)); if (id !== editRef.current) return;
      const rebuiltPlan = applyFurnishing(result.plan, autoFurniture);
      setParamElapsed(result.elapsed);
      setVersions((old) => old.map((v) => v.id === versionId ? { ...v, plan: rebuiltPlan, params: updatedParams, checks: runChecks(rebuiltPlan), error: undefined } : v));
    } catch (e) {
      if (id !== editRef.current) return;
      setVersions((old) => old.map((v) => v.id === versionId ? { ...v, error: (e as Error).message } : v));
    } finally { if (id === editRef.current) setUpdating(false); }
  };
  const toggleAutoFurniture = () => {
    const enabled = !autoFurniture; setAutoFurniture(enabled); editRef.current++;
    setVersions((old) => old.map((v) => {
      if (!v.plan) return v;
      const furnished = applyFurnishing(v.plan, enabled);
      return { ...v, plan: furnished, checks: runChecks(furnished) };
    }));
  };
  const runExport = async (kind: string) => {
    if (!version?.plan) return;
    setExportOpen(false); setExporting(true);
    try {
      if (kind === 'glb') await exportGLB(version.plan);
      if (kind === 'json') exportPlan(version.plan);
      if (kind === 'js') exportSource(version.source, version.params);
      if (kind === 'svg') exportSVG(version.plan);
      setToast(`${kind.toUpperCase()} downloaded. Made to keep exploring.`);
    } catch (e) { setToast(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(false); }
  };
  const changeVersion = (id: number) => { editRef.current++; setActiveId(id); setError(''); };
  const svg = plan ? planToSVG(plan, { width: 1600 }) : '';
  const originalForGenerate = versions.length === 0 && screen === 'studio' ? sketch : '';

  return <>
    <header className="site-header">
      <button className="brand-button" onClick={goHome} aria-label="Sketch to Walkthrough home"><Logo /></button>
      {screen === 'home' ? <><nav className="main-nav"><a href="#how-it-works">How it works</a><a href="#samples">Sample sketches</a><a href="#open-source">Open source <span>↗</span></a></nav><button className="header-action" onClick={() => fileRef.current?.click()}>Make a walkthrough <Icon name="arrow" size={16} /></button></> : <div className="studio-head-right"><span className="local-badge"><i /> LOCAL WORKSPACE</span><button className="header-action" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /> New sketch</button></div>}
    </header>

    {screen === 'home' ? <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span /> FROM PAPER TO POSSIBILITY</div>
          <h1>Your floor plan.<br />A place to <em>be in.</em></h1>
          <p className="hero-description">Upload a hand-drawn sketch. Get an editable 3D home you can actually walk through.</p>
          <button className={`upload-card ${dragging ? 'dragging' : ''}`} onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) upload(file); }}>
            <span className="upload-symbol"><Icon name="upload" size={23} /></span>
            <span className="upload-text"><b>Drop your sketch here</b><small>or click to find a floor plan</small></span><Icon name="arrow" size={25} />
          </button>
          <div className="upload-caption"><span>PNG, JPG or WEBP · up to 12 MB</span><span><i /> No account needed</span></div>
          <a className="sample-link" href="#samples">No sketch? Borrow one of ours. <span>↓</span></a>
          <div className="hero-note"><span className="sketch-underline">Drawn by you.</span><span> Brought to life with Kimi.</span></div>
        </div>
        <div className="hero-visual" aria-label="A sketch transformed into a three-dimensional home">
          <div className="display-label"><span className="live-dot" /> A LITTLE IMAGINATION, IN 3D</div>
          <div className="hero-paper"><span className="paper-label">YOUR SKETCH</span><img src="/samples/two-bedroom.png" alt="Hand-drawn two-bedroom floor plan with dimensions" /><span className="paper-tape" /></div>
          <div className="hero-arrow"><svg width="95" height="77" viewBox="0 0 95 77" fill="none"><path d="M4 15c15 32 39 48 76 29M68 36l15 7-5 16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 5" strokeLinecap="round"/></svg><span>look closer</span></div>
          <div className="hero-model"><div className="model-card-head"><span>YOUR WALKTHROUGH</span><i>↗</i></div>{demo && <PlanViewer plan={demo.plan} mode="dollhouse" labels={false} />}<div className="model-card-foot"><span><span /> Two-bedroom, one big idea.</span><Icon name="cube" size={15} /></div></div>
          <div className="hero-dim-label">2700<span>ceiling height · mm</span></div>
          <span className="hero-star">✳</span>
        </div>
      </section>

      <section className="process-strip"><div><span className="process-number">01</span><span><b>Sketch it</b><small>A photo is all you need.</small></span></div><span className="process-line" /><div><span className="process-number">02</span><span><b>See it take shape</b><small>Every dimension, understood.</small></span></div><span className="process-line" /><div><span className="process-number">03</span><span><b>Step inside</b><small>Move in before you build.</small></span></div></section>

      <section className="samples-section" id="samples"><div className="section-title"><div><div className="eyebrow"><span /> A PLACE TO START</div><h2>Good plans start with a few lines.</h2></div><p>Pick a sketch. See what Kimi sees.<br />No blank canvas required.</p></div>
        <div className="sample-grid">{SAMPLES.map((sample, i) => <article className="sample-card" key={sample.id}><button className="sample-image" onClick={() => trySample(sample)} aria-label={`Generate walkthrough from ${sample.title}`}><img src={sample.image} alt={`${sample.title} hand-drawn floor plan`} /><span className="sample-number">0{i + 1}</span><span className="sample-hover">Turn into 3D <Icon name="arrow" size={16} /></span></button><div className="sample-card-copy"><div><h3>{sample.title}</h3><p>{sample.description}</p></div><button className="sample-open" title="Open prepared demo" aria-label={`Open ${sample.title} prepared demo`} onClick={() => loadDemo(sample)}><Icon name="arrow" size={18} /></button></div><div className="sample-meta"><span>{sample.subtitle}</span><span>TRY THIS SKETCH <Icon name="arrow" size={12} /></span></div></article>)}</div>
        <p className="sample-footnote"><Icon name="spark" size={13} /> Each card generates a real walkthrough. The arrow opens an instant, local example.</p>
      </section>

      <section className="how-section" id="how-it-works"><div className="how-copy"><div className="eyebrow"><span /> THOUGHTFUL BY DESIGN</div><h2>Not just a pretty picture.<br /><em>A plan that holds together.</em></h2><p>Kimi understands the drawing. A deterministic geometry engine checks the things a vision model can’t: closed walls, reachable rooms, doors that fit.</p><a href="#open-source">Built in the open. See how it works <Icon name="arrow" size={16} /></a></div><div className="loop-cards"><div className="loop-card"><Icon name="spark" size={20} /><span className="loop-number">1 / GENERATE</span><h3>Read the sketch</h3><p>Dimensions become clean, editable parameters.</p></div><div className="loop-card"><Icon name="check" size={20} /><span className="loop-number">2 / CHECK</span><h3>Test the geometry</h3><p>Every wall, opening, and connection is validated.</p></div><div className="loop-card"><Icon name="plan" size={20} /><span className="loop-number">3 / RENDER</span><h3>Draw the plan</h3><p>A precise, top-down view reveals what changed.</p></div><div className="loop-card"><Icon name="eye" size={20} /><span className="loop-number">4 / REFINE</span><h3>Compare, then improve</h3><p>Original meets render. Up to three versions, kept.</p></div></div></section>

      <section className="closing-section" id="open-source"><span className="closing-star">✳</span><div className="eyebrow"><span /> LESS BARRIER. MORE POSSIBILITY.</div><h2>A small sketch can be<br />the start of <em>somewhere.</em></h2><button className="light-button" onClick={() => fileRef.current?.click()}>Make your first walkthrough <Icon name="arrow" /></button><div className="closing-notes"><span>Free & open source</span><i /> <span>Your sketch stays in this session</span><i /><span>No architectural degree required</span></div></section>
    </main> : <main className="studio" data-first-walkable={firstWalkableElapsed ?? ''} data-final-elapsed={elapsed || ''} data-active-version={activeVersion?.id ?? ''}>
      <div className="studio-titlebar"><div className="studio-title"><span className="studio-breadcrumb">YOUR WORKSPACE <span>/</span> {sketchName}</span><h1>A new perspective on your plan<span>.</span></h1></div><div className="history"><span className="history-label">VERSIONS</span>{versions.map((v) => <button key={v.id} className={`version-button ${v.id === activeVersion?.id ? 'active' : ''} ${v.plan ? '' : 'invalid'}`} onClick={() => changeVersion(v.id)} disabled={Boolean(progress) && !plan}>v{v.id}{v.verdict === 'PASS' && <i />}</button>)}</div></div>
      <div className="workspace">
        <section className="viewport-panel" aria-label="Plan viewer">
          <div className="viewport-toolbar"><div className="mode-switch" role="tablist" aria-label="View mode"><button role="tab" aria-selected={mode === 'plan'} className={mode === 'plan' ? 'selected' : ''} onClick={() => setMode('plan')}><Icon name="plan" /> Plan</button><button role="tab" aria-selected={mode === 'dollhouse'} className={mode === 'dollhouse' ? 'selected' : ''} onClick={() => setMode('dollhouse')}><Icon name="cube" /> Dollhouse</button><button role="tab" aria-selected={mode === 'walk'} className={mode === 'walk' ? 'selected' : ''} onClick={() => setMode('walk')}><Icon name="walk" /> Walkthrough</button></div><div className="viewport-actions"><button className={`icon-button label-toggle ${labels ? 'active' : ''}`} title="Toggle room labels" aria-pressed={labels} onClick={() => setLabels(!labels)}><Icon name="layers" size={17} /><span>Labels</span></button><button className="icon-button" title="Reset camera" onClick={() => viewerRef.current?.reset()}><Icon name="reset" size={17} /></button></div></div>
          <div className={`canvas-wrap ${mode === 'plan' ? 'show-plan' : ''}`}>
            {plan && <PlanViewer ref={viewerRef} plan={plan} mode={mode} labels={labels} onLocked={setLocked} />}
            {mode === 'plan' && plan && <div className="plan-overlay"><img src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`} alt="Top-down floor plan with room labels and overall dimension lines" /></div>}
            {plan && <div className="canvas-location"><span className="live-dot" />{mode === 'walk' ? 'EYE LEVEL · 1.6 M' : mode === 'plan' ? 'TOP-DOWN · ORTHOGRAPHIC' : 'ROOF OFF · PERSPECTIVE'}</div>}
            {plan && mode === 'walk' && !locked && <div className="walk-invitation"><div className="walk-invite-icon"><Icon name="walk" size={29} /></div><h2>Ready to step inside?</h2><p>WASD to move · mouse to look · Esc to leave</p><button className="primary-button" onClick={() => viewerRef.current?.startWalk()}>Enter your walkthrough <Icon name="arrow" /></button><small>On touch screens, drag to look and use the joystick.</small></div>}
            {plan && mode === 'walk' && locked && <><div className="crosshair" /><div className="walk-help"><span>W A S D <small>move</small></span><span>MOUSE <small>look</small></span><span>ESC <small>exit</small></span></div><WalkControls onMove={(x, y) => viewerRef.current?.setJoystick(x, y)} /></>}
            {plan && mode !== 'walk' && <div className="viewport-scale"><span />{mode === 'plan' ? 'DIMENSIONS IN MM' : 'DRAG TO ORBIT · SCROLL TO ZOOM'}</div>}
            {activeVersion && !activeVersion.plan && version && <div className="invalid-version-note" role="status"><Icon name="info" size={15} /><span><b>v{activeVersion.id} did not validate.</b> Showing v{version.id}, the last valid plan. See Checks for the returned error.</span></div>}
            {progress && plan && <div className="review-progress" role="status"><span /><div><b>{progress.title}</b><small>{progress.detail}</small></div></div>}
            {newerVersion && <button className="new-version-notice" onClick={() => changeVersion(newerVersion.id)}>v{newerVersion.id} · newer version available <Icon name="arrow" size={13} /></button>}
            {progress && !plan && <div className="generation-overlay"><div className="sketch-preview"><img src={sketch} alt="Your uploaded floor plan" /><span className="preview-tag"><span /> YOUR ORIGINAL</span></div><div className="generation-copy"><div className="generation-orbit"><span /><span /><Icon name="spark" size={25} /></div><span className="generation-kicker">SKETCH → GEOMETRY → SPACE</span><h2>{progress.title}<i className="loading-dots">...</i></h2><p>{progress.detail}</p><div className="generation-steps">{['Read the sketch', 'Build & check', 'Review the render'].map((step, i) => <div key={step} className={i < progress.step ? 'complete' : i === progress.step ? 'active' : ''}><span>{i < progress.step ? <Icon name="check" size={12} /> : `0${i + 1}`}</span>{step}</div>)}</div><p className="generation-small">Large sketches may take a minute. Good spaces are worth a moment.</p></div></div>}
            {!plan && !progress && <div className="empty-workspace"><Icon name="plan" size={42} /><h2>Let’s try that again.</h2><p>Your next walkthrough starts with the original sketch.</p><button className="primary-button" onClick={regenerate}>Retry this sketch <Icon name="reset" /></button></div>}
          </div>
          <div className="viewport-footer"><div className="geometry-stats">{plan ? <><span><Icon name="plan" size={14} />{plan.rooms.length} rooms</span><i /><span>{plan.walls.length} walls</span><i /><span>{plan.openings.length} openings</span><i /><span data-furniture-count={plan.furniture.length}>{plan.furniture.length} furniture</span></> : <span className="muted">Waiting for your sketch…</span>}</div><div className="local-geometry"><span className={updating ? 'update-dot updating' : 'update-dot'} />{updating ? 'Rebuilding…' : 'LOCAL GEOMETRY'}{paramElapsed !== null && <span className="rebuild-time">{paramElapsed.toFixed(1)} ms</span>}</div></div>
        </section>

        <aside className="inspector">
          <div className="inspector-top"><div><span className="inspector-eyebrow">THE DETAILS</span><h2>Make it yours.</h2></div><Logo small /></div>
          <div className="inspector-tabs" role="tablist"><button role="tab" aria-selected={tab === 'dimensions'} className={tab === 'dimensions' ? 'active' : ''} onClick={() => setTab('dimensions')}>Dimensions</button><button role="tab" aria-selected={tab === 'assumptions'} className={tab === 'assumptions' ? 'active' : ''} onClick={() => setTab('assumptions')}>Assumptions{version?.assumptions.length ? <span>{version.assumptions.length}</span> : null}</button><button role="tab" aria-selected={tab === 'checks'} className={tab === 'checks' ? 'active' : ''} onClick={() => setTab('checks')}>Checks{version?.checks?.ok ? <i /> : version?.checks ? <b>!</b> : null}</button></div>
          <div className="inspector-scroll">
            {tab === 'dimensions' && version ? <div className="dimensions-panel"><p className="panel-intro">A little adjustment, instantly.<br />Everything updates right here in your browser.</p><div className="furniture-setting"><div><b>Furnish empty rooms</b><small>Defaults fit around doors and walkways.</small></div><button type="button" role="switch" aria-checked={autoFurniture} aria-label="Auto-furnish empty rooms" className={`furniture-toggle ${autoFurniture ? 'on' : ''}`} onClick={toggleAutoFurniture}><span /></button></div>{plan && plan.furniture.length > 0 && <div className="furniture-legend"><span><i className="from-sketch" />{plan.furniture.filter((f) => f.source === 'sketch').length} from your sketch</span><span><i className="from-default" />{plan.furniture.filter((f) => f.source === 'auto').length} added by default</span></div>}{paramEntries.filter(([, p]) => p.group === 'global').length > 0 && <div className="param-group"><h3><Icon name="sliders" size={14} /> GLOBAL DIMENSIONS</h3>{paramEntries.filter(([, p]) => p.group === 'global').map(([name, def]) => <DetailSlider key={name} name={name} def={def} value={def.value} onChange={(value) => editParam(name, value)} />)}</div>}{plan && plan.rooms.map((room) => { const entries = paramEntries.filter(([, p]) => p.group === 'room' && p.room === room.id); if (!entries.length) return null; return <div className="param-group room-group" key={room.id}><h3><span className={`floor-dot ${room.floor}`} />{room.name}<span className="room-unit">ROOM</span></h3>{entries.map(([name, def]) => <DetailSlider key={name} name={name} def={def} value={def.value} onChange={(value) => editParam(name, value)} />)}</div>; })}<div className="edit-note"><Icon name="spark" size={17} /><p>One slider. Every connected wall.<br /><span>Geometry is derived, not hardcoded.</span></p></div></div> : null}
            {tab === 'assumptions' && version ? <div className="assumptions-panel">
              <p className="panel-intro">Original assumptions stay verbatim. Current values are separate, so edits never rewrite what Kimi inferred.</p>
              {version.assumptions.length ? version.assumptions.map((a, i) => {
                const param = a.param ? version.params[a.param] : undefined;
                const original = a.param ? version.originalParams[a.param] : undefined;
                return <article className="assumption-card" key={`${a.id}-${i}`} data-assumption-id={a.id} data-current-value={param && a.param ? version.params[a.param].value : ''} data-original-value={original?.value ?? ''}>
                  <div className="assumption-number">ORIGINAL ASSUMPTION {String(i + 1).padStart(2, '0')}</div>
                  <p>{a.text}</p>
                  {param && a.param ? <>
                    <div className="assumption-values"><span>Kimi assumed <b>{formatMM(original?.value ?? param.value)}</b></span><span>Current <b>{formatMM(param.value)}</b></span></div>
                    <DetailSlider id={`assumption-${a.param}`} name={a.param} def={param} value={param.value} onChange={(value) => editParam(a.param!, value)} />
                  </> : <small className="assumption-text-only">Text-only assumption · no matching dimension to edit.</small>}
                </article>;
              }) : <div className="empty-panel"><Icon name="check" size={30} /><h3>Nothing left unsaid.</h3><p>No additional assumptions were reported in this version.</p></div>}
            </div> : null}
            {tab === 'checks' && <div className="checks-panel"><p className="panel-intro">A little engineering you didn’t have to ask for. Deterministic, every time.</p>{activeVersion?.repairs.length ? <div className="repair-notes" data-testid="repair-notes"><b>Repaired locally · no model retry</b><ul>{activeVersion.repairs.map((note, i) => <li key={i}>{note}</li>)}</ul></div> : null}{activeVersion?.error && <div className="error-note"><b>Generator needs a revision</b><p>{activeVersion.error}</p></div>}{activeVersion?.verdict && <div className={`verdict ${activeVersion.verdict === 'PASS' ? 'pass' : 'revise'}`}><span>{activeVersion.verdict === 'PASS' ? <Icon name="check" size={18} /> : <Icon name="eye" size={18} />}</span><div><b>{activeVersion.verdict === 'PASS' ? 'Vision review passed' : 'Revision suggested'}</b><p>{activeVersion.verdict === 'PASS' ? 'The render and original sketch agree.' : 'Kimi found room for improvement.'}</p></div></div>}{activeVersion?.issues?.length ? <ul className="issue-list">{activeVersion.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul> : null}{version?.checks ? <div className="check-list">{version.checks.checks.map((check) => <article className={`check-card ${check.ok ? 'ok' : 'fail'}`} key={check.id} data-check={check.id} data-ok={check.ok}><span>{check.ok ? <Icon name="check" size={13} /> : '!'}</span><div><h3>{check.title}</h3><p>{check.detail}</p></div></article>)}</div> : !progress ? <div className="empty-panel"><p>Checks run as soon as a plan is built.</p></div> : null}<div className="check-footnote"><Icon name="info" size={15} /> Orientation assumed for a residential sketch. Construction always needs a professional.</div></div>}
            {!version && !progress && <div className="empty-panel"><h3>Almost there.</h3><p>Try the original again, or start a new sketch.</p></div>}
          </div>
          <div className="inspector-bottom"><div className="export-wrap" ref={exportRef}><button className="export-button" disabled={!plan || exporting} onClick={() => setExportOpen(!exportOpen)}><Icon name="download" size={18} /><span>{exporting ? 'Preparing your model…' : 'Take your plan with you'}</span><Icon name="down" size={16} /></button>{exportOpen && <div className="export-menu">{[{ id: 'glb', title: '3D model', ext: '.glb', icon: 'cube' }, { id: 'json', title: 'Plan data', ext: '.json', icon: 'file' }, { id: 'js', title: 'Generator module', ext: '.js', icon: 'code' }, { id: 'svg', title: '2D floor plan', ext: '.svg', icon: 'plan' }].map((item) => <button key={item.id} onClick={() => runExport(item.id)}><Icon name={item.icon} /><span>{item.title}</span><small>{item.ext}</small><Icon name="download" size={14} /></button>)}</div>}</div><p>No account. No database. Just your plan.</p></div>
        </aside>
      </div>
      <footer className="studio-footer"><button className="back-link" onClick={goHome}>← All sketches</button>{version?.verdict === 'PASS' ? <span className="studio-verified"><Icon name="check" size={13} /> Vision-reviewed{elapsed > 0 && ` in ${Math.round(elapsed)}s`}</span> : usage.length === 0 && plan ? <span className="studio-verified">LOCAL SAMPLE · EXPLORE FREELY</span> : <span className="studio-verified"><Icon name="spark" size={12} /> Powered by Kimi vision</span>}<div className="debug-anchor"><button className="debug-button" onClick={() => setDebugOpen(!debugOpen)}><Icon name="code" size={14} /> Debug <span>{usage.length ? `${usage.length} calls` : 'local'}</span></button>{debugOpen && <div className="debug-panel"><div className="debug-head"><b>Model telemetry</b><button onClick={() => setDebugOpen(false)}><Icon name="close" size={16} /></button></div><p>{model}</p>{usage.length ? <div className="usage-list">{usage.map((u, i) => <div key={i}><span>{u.kind}</span><b>{u.completion.toLocaleString()} tokens</b><span>{u.tokensPerSecond} tok/s · {u.elapsed}s</span></div>)}</div> : <p className="debug-empty">No model calls for the local example.<br />Worker rebuild: {paramElapsed === null ? 'not measured yet' : `${paramElapsed.toFixed(2)} ms`}.</p>}<span className="debug-note">Key stays server-side · streamed completions</span></div>}</div></footer>
    </main>}

    <footer className={screen === 'home' ? 'site-footer' : 'visually-hidden'}><Logo /><span>Hand-drawn ideas. Walkable possibilities.</span><div><span className="footer-model"><i /> KIMI VISION</span><span>THREE.JS</span><span>OPEN SOURCE</span></div></footer>
    {error && <div className="toast error-toast" role="alert"><Icon name="info" size={19} /><span>{error}</span>{screen === 'studio' && plan && <button onClick={regenerate}>Retry</button>}<button aria-label="Close error" onClick={() => setError('')}><Icon name="close" size={17} /></button></div>}
    {toast && <div className="toast" role="status"><Icon name="check" size={18} /><span>{toast}</span><button aria-label="Close notification" onClick={() => setToast('')}><Icon name="close" size={15} /></button></div>}
    {originalForGenerate && <span className="visually-hidden">Processing {originalForGenerate.length} character image</span>}
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); e.target.value = ''; }} />
  </>;
}

export default App;
