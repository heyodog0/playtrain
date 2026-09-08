import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire('/n/home06/truong/node-gym-smoke/node-gym/package.json');
const { chromium } = require('playwright-core');

const GAMES_DIR = '/n/home06/truong/node-gym-smoke/node-gym/examples/games/js';
const OBS_PATH = '/n/home06/truong/node-gym-smoke/node-gym/runtime/p5/obs.mjs';
const P5_PATH = '/n/home06/truong/p5.min.js';
const CHROME = '/n/home06/truong/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome';

const args = process.argv.slice(2);
const opt = (k,d)=>{const i=args.indexOf(k);return i>=0?args[i+1]:d;};
const FRAMES = parseInt(opt('--frames','500'),10);
const WARMUP = parseInt(opt('--warmup','50'),10);
const OBS = 64;
const DEFAULT = ['bigfish','bossfight','caveflyer','chaser','climber','coinrun','dodgeball','fruitbot','heist','jumper','leaper','maze','miner','ninja','plunder','starpilot','qbert','seaquest','pong','breakout','space_invaders','frostbite','freeway','asteroids'];
const GAMES = opt('--games','') ? opt('--games','').split(',') : DEFAULT;
const ACTIONS=[[],[37],[39],[38],[40],[32],[37,32],[39,32]];

const p5src = readFileSync(P5_PATH,'utf8');
const obsSrc = readFileSync(OBS_PATH,'utf8');
const m = obsSrc.match(/export function preprocessObservationRGB\(([\s\S]*?)\n\}/);
const preprocessFn = `function preprocessObservationRGB(${m[1]}\n}`;

function html(game){
  const code = readFileSync(`${GAMES_DIR}/${game}.js`,'utf8');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;overflow:hidden;background:#000}</style>
<script src="/p5.js"></script></head><body><script>${code}</script></body></html>`;
}
async function bench(page,port,game){
  await page.goto(`http://127.0.0.1:${port}/g/${game}`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>typeof window.draw==='function'&&!!document.querySelector('canvas'),{timeout:20000});
  await page.evaluate(({src,obs})=>{
    window.__pre=eval(`(${src})`);
    window.__step=(cs)=>{window.__keys=new Set(cs);window.keyIsDown=(c)=>window.__keys.has(c);
      draw();const st=(typeof getGameState==='function')?getGameState():{gameState:'PLAYING'};
      if(st.gameState==='GAMEOVER'||st.gameState==='WIN'){if(typeof resetGame==='function')resetGame((Math.random()*1e6)|0);draw();}
      const cv=document.querySelector('canvas');const ctx=cv.getContext('2d');
      const px=ctx.getImageData(0,0,cv.width,cv.height);
      const o=window.__pre(px.data,cv.width,cv.height,obs,obs);
      let bin='';for(let i=0;i<o.length;i++)bin+=String.fromCharCode(o[i]);return btoa(bin);};
    window.keyIsDown=(c)=>false;noLoop();if(typeof resetGame==='function')resetGame(42);draw();
  },{src:preprocessFn,obs:OBS});
  for(let i=0;i<WARMUP;i++)await page.evaluate((k)=>window.__step(k),ACTIONS[i%8]);
  const t0=performance.now();
  for(let i=0;i<FRAMES;i++){const b=await page.evaluate((k)=>window.__step(k),ACTIONS[i%8]);Buffer.from(b,'base64');}
  return Math.round(FRAMES/((performance.now()-t0)/1000));
}
(async()=>{
  const cache=new Map(GAMES.map(g=>[g,html(g)]));
  const server=createServer((req,res)=>{
    if(req.url==='/p5.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(p5src);}
    const name=req.url.replace('/g/','');
    if(cache.has(name)){res.writeHead(200,{'Content-Type':'text/html'});res.end(cache.get(name));}
    else{res.writeHead(404);res.end('no');}
  });
  const port=await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  const results={};
  for(const g of GAMES){
    try{const fps=await bench(page,port,g);results[g]=fps;console.log(`${g} ${fps}`);}
    catch(e){console.log(`${g} ERR ${String(e.message).slice(0,50)}`);}
  }
  await browser.close();server.close();
  const v=Object.values(results);const geo=Math.round(Math.exp(v.reduce((a,x)=>a+Math.log(x),0)/v.length));
  console.log(`GEOMEAN ${geo} (${v.length} games)`);
  writeFileSync('/n/home06/truong/pw_fasrc.json',JSON.stringify({frames:FRAMES,results,geomean:geo},null,1));
})();
