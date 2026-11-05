import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.BASE_URL??'http://127.0.0.1:5177';
const out=process.env.SCREENSHOTS??'qa';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==new URL(base).origin)external.push(r.url())});
try{
 await page.goto(base);await page.locator('.node').last().waitFor();await page.waitForTimeout(600);assert.equal(await page.locator('.node').count(),5);
 assert.equal(await page.getByRole('button',{name:'Previous step',exact:true}).isDisabled(),true);
 await page.screenshot({path:out+'/codetrail-desktop.png'});
 for(let i=0;i<5;i++){await page.locator('.node').nth(i).click();assert.equal(await page.locator('#step-count').textContent(),`Step ${i+1} of 5`);assert.ok(await page.locator('.code-line.highlight').count()>0);const href=await page.locator('#source-link').getAttribute('href');assert.match(href,/c36cf8b5d1a57164e64fdd7d4e0d0f80ab262dc0.*#L\d+$/)}
 assert.equal(await page.getByRole('button',{name:'Next step',exact:true}).isDisabled(),true);
 await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#step-count').textContent(),'Step 4 of 5');
 await page.getByRole('button',{name:'Play tour',exact:true}).click();await page.getByRole('button',{name:'Pause tour',exact:true}).waitFor();await page.getByRole('button',{name:'Pause tour',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);await page.screenshot({path:out+'/codetrail-mobile.png'});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
 assert.equal(await page.getByAltText('Nebius Token Factory').evaluate(e=>e.complete&&e.naturalWidth>0),true);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);fs.writeFileSync(out+'/showcase-results.json',JSON.stringify({passed:true,steps:5,errors,external,mobile:'390×844'}));console.log('PASS: 5 source-checked steps; navigation, playback, attribution, mobile and no external requests.');
}finally{await browser.close()}
