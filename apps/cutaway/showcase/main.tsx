import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Viewer3D } from '../components/viewer/Viewer3D';
import type { Meta } from '../lib/schema/teardown';
import engineSeed from '../seed/two-spool-high-bypass-turbofan-engine.json';
import brushSeed from '../seed/rechargeable-sonic-electric-toothbrush.json';
import '../app/globals.css';
import './showcase.css';
type Demo={slug:string;meta:Meta;parts:{id:string;code:string}[]};
const demos=[engineSeed,brushSeed] as unknown as Demo[];
function Showcase(){
 const [index,setIndex]=useState(0),[selected,setSelected]=useState<string|null>(null),[tab,setTab]=useState<'parts'|'how'>('parts');
 const [built,setBuilt]=useState<{total:number;failed:number}|null>(null);
 const demo=demos[index],part=demo.meta.parts.find(p=>p.id===selected);
 return <Tooltip.Provider delayDuration={200}><div className="tf-showcase">
  <header className="showcase-header"><a href="https://tokenfactory.nebius.com/" aria-label="Nebius Token Factory"><img src="./brand/token-factory.svg" alt="Nebius Token Factory" width="176" height="24" /></a><span className="demo-name">Cutaway</span><nav><a href="https://github.com/demianarc/token-factory-cutaway#readme" target="_blank" rel="noreferrer">Get the code ↗</a><a className="build-cta" href="https://tokenfactory.nebius.com/?modals=endpoint-details&model-id=moonshotai/Kimi-K3.1-Pro" target="_blank" rel="noreferrer">Build with Kimi ↗</a></nav></header>
  <main className="showcase-grid"><section className="showcase-stage stage-surface" aria-label="Interactive machine explorer"><Viewer3D key={demo.slug} meta={demo.meta} parts={demo.parts} selected={selected} onSelect={setSelected} initialLabels="off" frameOnDisassembly onBuildDone={results=>setBuilt({total:results.length,failed:results.filter(r=>!r.ok).length})} /><div className="stage-caption">Drag to orbit. Use the controls to pull it apart.</div></section>
   <aside className="showcase-inspector"><p className="showcase-kicker">Kimi K3.1 Pro × Token Factory</p><h1>See what’s<br/>inside.</h1><p className="showcase-intro">Explore a machine, one part at a time.</p>
    <label className="demo-select-label" htmlFor="demo-select">Choose a machine</label><select id="demo-select" value={index} onChange={e=>{setIndex(Number(e.target.value));setSelected(null);setBuilt(null);}}><option value="0">Turbofan jet engine · 47 parts</option><option value="1">Electric toothbrush · 34 parts</option></select><p className="build-status" role="status">{built ? built.failed ? `${built.failed} of ${built.total} parts could not load. Try reloading.` : `${built.total} parts loaded` : "Loading 3D parts…"}</p>
    <div className="showcase-tabs"><button aria-pressed={tab==='parts'} onClick={()=>setTab('parts')}>Explore parts</button><button aria-pressed={tab==='how'} onClick={()=>setTab('how')}>How it was built</button></div>
    {tab==='how'?<div className="how-built"><h2>From an idea to an explorable model.</h2><ol><li>A name or photo goes to Kimi on Token Factory.</li><li>Kimi writes structured part descriptions and Three.js builders.</li><li>The app builds the parts in a sandbox and renders four views for model self-review.</li><li>The saved result becomes this interactive explorer.</li></ol><p>These examples were generated previously. Exploring them makes no model calls. Run the full app to generate your own.</p><a href="https://github.com/Studio1-OSS/Cutaway#how-it-works" target="_blank" rel="noreferrer">Read the original walkthrough ↗</a></div>:<>
     {part?<article className="selected-part"><span>Selected part</span><h2>{part.name}</h2><p>{part.function}</p><p>{part.howItWorks}</p><small>{part.material}</small><button onClick={()=>setSelected(null)}>Clear selection</button></article>:<p className="parts-hint">Select a part in the scene or the list to learn what it does.</p>}
     <details className="all-parts" open={!selected}><summary>{demo.meta.parts.length} parts to explore</summary><div>{demo.meta.parts.map((p,i)=><button className={selected===p.id?'selected':''} onClick={()=>setSelected(p.id)} key={p.id}><span>{String(i+1).padStart(2,'0')}</span>{p.name}</button>)}</div></details>
    </>}
    <p className="example-note">Illustrative internals, simplified for learning. Not manufacturer-accurate CAD.</p>
   </aside></main>
  <footer className="showcase-footer"><span>Original build by <a href="https://github.com/Astrodevil" target="_blank" rel="noreferrer">Amitesh Anand</a> / <a href="https://studio1hq.com" target="_blank" rel="noreferrer">Studio1HQ</a>. TF-branded edition.</span><a href="https://github.com/Studio1-OSS/Cutaway" target="_blank" rel="noreferrer">Original source ↗</a></footer>
 </div></Tooltip.Provider>
}
createRoot(document.getElementById('root')!).render(<Showcase/>);
