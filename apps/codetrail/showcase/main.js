const response=await fetch('./polka-source.json');
if(!response.ok)throw new Error('The source example could not load.');
const data=await response.json();
const lines=data.source.split('\n');
const steps=[
 {title:'Attach the request handler',anchor:"(this.server = this.server || http.createServer()).on('request', this.handler);",description:'Polka creates an HTTP server if one was not supplied, then attaches its handler to the request event. This is the entry point for incoming traffic.'},
 {title:'Parse the URL, find the route',anchor:'let fns=[], arr=this.wares, obj=this.find(req.method, info.pathname);',description:'The handler parses the URL, gathers middleware and asks the router to match the HTTP method and pathname. The result supplies handlers and route parameters.'},
 {title:'Choose handlers or a sub-app',anchor:'fns = obj.handlers;',description:'A matching route provides its handler chain. Otherwise, a mounted Polka sub-application can take over after the mount prefix is removed from the request path.'},
 {title:'Keep a 404 fallback',anchor:'fns.push(this.onNoMatch);',description:'The no-match handler is appended after the route. If nothing finishes the response, the chain can fall through to the default 404 behaviour.'},
 {title:'Run the middleware chain',anchor:'let next = err => err ? this.onError(err, req, res, next) : loop();',description:'Middleware and route handlers form one chain. Each next() advances it; errors go to onError. A finished response stops the loop.'}
].map(s=>{const line=lines.findIndex(l=>l.trim()===s.anchor);if(line<0)throw Error('Source anchor missing: '+s.title);return {...s,line:line+1}});
const root='https://github.com/'+data.repository+'/blob/'+data.revision+'/'+data.path;
const flow=document.querySelector('#flow'),code=document.querySelector('#code');
let index=0,timer;
steps.forEach((step,i)=>{const b=document.createElement('button');b.className='node';b.innerHTML=`<span class="number">${String(i+1).padStart(2,'0')}</span><span></span><small>↗</small>`;b.children[1].textContent=step.title;b.onclick=()=>{pause();show(i)};flow.append(b)});
lines.forEach((text,i)=>{const line=document.createElement('span');line.className='code-line';line.dataset.line=String(i+1);const n=document.createElement('span');n.className='line-number';n.textContent=String(i+1);const c=document.createElement('code');c.textContent=text;line.append(n,c);code.append(line)});
function show(i){index=i;const s=steps[index];document.querySelector('#title').textContent=s.title;document.querySelector('#description').textContent=s.description;document.querySelector('#step-count').textContent=`Step ${index+1} of ${steps.length}`;document.querySelector('#progress').textContent=`${index+1} / ${steps.length}`;document.querySelector('#source-link').href=root+'#L'+s.line;document.querySelector('#revision').href=root;document.querySelector('#previous').disabled=index===0;document.querySelector('#next').disabled=index===steps.length-1;flow.querySelectorAll('button').forEach((b,j)=>{b.setAttribute('aria-current',j===index?'step':'false')});code.querySelectorAll('.code-line').forEach(l=>{const no=Number(l.dataset.line);l.classList.toggle('highlight',no>=s.line&&no<=s.line+2)});const active=code.children[s.line-1];code.scrollTo({top:Math.max(0,active.offsetTop-100),behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}
function pause(){clearInterval(timer);timer=null;document.querySelector('#play').textContent='Play tour'}
document.querySelector('#previous').onclick=()=>{pause();show(Math.max(0,index-1))};document.querySelector('#next').onclick=()=>{pause();show(Math.min(steps.length-1,index+1))};
document.querySelector('#play').onclick=()=>{if(timer){pause();return}if(index===steps.length-1)show(0);document.querySelector('#play').textContent='Pause tour';timer=setInterval(()=>{if(index===steps.length-1){pause();return}show(index+1)},4500)};
addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey)return;if(e.key==='ArrowRight'){pause();show(Math.min(steps.length-1,index+1));e.preventDefault()}if(e.key==='ArrowLeft'){pause();show(Math.max(0,index-1));e.preventDefault()}});
show(0);
