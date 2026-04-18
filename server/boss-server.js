#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// B.O.S.S. Universe Server — Engine runs here, clients get data only
// The trading intelligence NEVER leaves this machine
// ═══════════════════════════════════════════════════════════════

const http=require('http');
const fs=require('fs');
const path=require('path');
const{WebSocketServer}=require('ws');

// Engine modules (PRIVATE — never served)
const{BossNarrator,BossField}=require('./engine/field');
const{BossTrader,STRATEGIES}=require('./engine/trader');
const{fetchPrices,setApiKey,getApiKeys}=require('./engine/prices');
const{HyperliquidAPI,FundingFarmer}=require('./engine/hyperliquid');

const PORT=8090;
const PUBLIC=path.join(__dirname,'public');

// ── Initialize engine ──────────────────────────────────────────
const narrator=new BossNarrator();
const field=new BossField(narrator);
const trader=new BossTrader(field,narrator);
const hlApi=new HyperliquidAPI(narrator);
const farmer=new FundingFarmer(hlApi,narrator);

let tier='observer',acct=null;
let bondsLearned=false;
const profitHistory=[];

// Star positions (computed once, deterministic)
const starPositions={};
function seedRandom(s){return function(){s=Math.sin(s*9301+49297)%1;return s<0?-s:s}}

function getStarPos(id,type){
  if(starPositions[id])return starPositions[id];
  const rng=seedRandom(id.split('').reduce((a,c)=>a+c.charCodeAt(0),0));
  const a=rng()*6.28;
  const typeR={crypto:200+rng()*250,forex:500+rng()*180,commodity:350+rng()*150,index:650+rng()*200,poly:150+rng()*120};
  const typeX={crypto:-100,forex:450,commodity:100,index:-400,poly:0};
  const typeY={crypto:0,forex:0,commodity:-350,index:200,poly:-300};
  const r=typeR[type]||200+rng()*200;
  const ox=typeX[type]||0;
  const oy=typeY[type]||0;
  starPositions[id]={bx:ox+Math.cos(a)*r,by:oy+Math.sin(a)*r};
  return starPositions[id];
}

// HL symbol mapping
const hlSymMap={BTC:'BITCOIN',ETH:'ETHEREUM',SOL:'SOLANA',DOGE:'DOGECOIN',ADA:'CARDANO',
  AVAX:'AVALANCHE-2',DOT:'POLKADOT',LINK:'CHAINLINK',TON:'TONCOIN',XRP:'RIPPLE'};

// ── Connect Hyperliquid ────────────────────────────────────────
hlApi.connect().catch(()=>narrator.log('HL offline, using REST','nt'));
hlApi.callbacks.onWhale=(sym,side,val)=>{
  field.injectEvent(sym,side==='Buy'?0.05:-0.05);
};

// ── Engine tick ────────────────────────────────────────────────
async function engineTick(){
  try{
    // Fetch prices
    const data=await fetchPrices(field);

    // Update field
    for(const[sym,d]of Object.entries(data)){
      field.addNode(sym,d.type);
      field.updateNode(sym,d.price,d.change);
      getStarPos(sym,d.type); // ensure position exists
      if(Math.abs(d.change)>1.5)field.injectEvent(sym,d.change/100);
    }

    // HL real-time price updates
    for(const sym in hlSymMap){
      const p=hlApi.getLatestPrice(sym);if(!p)continue;
      const id=hlSymMap[sym];const n=field.nodes.get(id);
      if(n&&n.price>0)field.updateNode(id,p,n.change);
    }

    // Bond learning
    if(!bondsLearned){
      const ready=[...field.nodes.values()].filter(n=>{
        if(n.history.length<30)return false;
        const mn=Math.min(...n.history),mx=Math.max(...n.history);
        return mx>mn*1.001;
      });
      if(ready.length>=5){field.learnBonds();bondsLearned=true;narrator.log(field.bonds.length+' bonds learned','nt-cascade')}
    }

    // Tick field
    field.tick(15);

    // Execute trades
    if(acct&&trader.balance>0)trader.execute();

    // Track P&L
    profitHistory.push(trader.balance);
    if(profitHistory.length>300)profitHistory.shift();

  }catch(e){narrator.log('Tick error: '+e.message,'nt-grief')}
}

// Run every 15 seconds
setInterval(engineTick,15000);
engineTick(); // first tick immediately

// Funding scan every 2 minutes
setInterval(()=>{if(tier==='strategist'||tier==='boss')farmer.scan().catch(()=>{})},120000);

// ── Build state snapshot ───────────────────────────────────────
function getState(){
  const stars=[];
  for(const[id,n]of field.nodes){
    const pos=starPositions[id]||{bx:0,by:0};
    stars.push({id,type:n.type,price:n.price,change:n.change,warmth:n.warmth,dir:n.dir,
      bx:pos.bx,by:pos.by,ema8:n.ema8,ema21:n.ema21,rsi:n.rsi,histLen:n.history.length,
      hasTrade:n.hasTrade});
  }

  const bonds=field.bonds.filter(b=>Math.abs(b.strength)>=0.45).map(b=>({
    from:b.from,to:b.to,strength:b.strength,delayMs:b.delayMs
  }));

  const cascades=field.cascadeQueue.map(c=>({source:c.source,target:c.target,magnitude:c.magnitude,executeAt:c.executeAt}));

  return{
    stars,bonds,cascades,
    trader:trader.getStatus(),
    field:{grief:field.grief,fieldWarmth:field.fieldWarmth},
    signals:field.getSignals().slice(0,10),
    hl:{connected:hlApi.connected,depth:hlApi.getDepthAll(),liquidations:hlApi.getLiqSummary()},
    profitHistory:profitHistory.slice(-150),
    narration:narrator.recent(15),
    tier,acct,
    totalBonds:field.bonds.length
  };
}

// ── HTTP Server ────────────────────────────────────────────────
const server=http.createServer((req,res)=>{
  // API endpoints
  if(req.method==='POST'&&req.url==='/api/tier'){
    let body='';req.on('data',c=>body+=c);req.on('end',()=>{
      try{const{t}=JSON.parse(body);
        tier=t;
        if(t==='explorer'){acct='demo';trader.reset(10000)}
        else if(t==='observer'){acct=null;trader.balance=0;trader.startBal=0}
        else{acct='live';trader.balance=0;trader.startBal=0}
        res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({ok:true,tier}));
      }catch(e){res.writeHead(400);res.end('bad request')}
    });return;
  }

  if(req.method==='POST'&&req.url==='/api/reset'){
    trader.reset(10000);profitHistory.length=0;
    res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({ok:true,balance:trader.balance}));return;
  }

  if(req.method==='POST'&&req.url==='/api/strategy'){
    let body='';req.on('data',c=>body+=c);req.on('end',()=>{
      try{const{s}=JSON.parse(body);
        if(trader.setStrategy(s)){
          res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ok:true,strategy:s,name:STRATEGIES[s].name,desc:STRATEGIES[s].desc,risk:STRATEGIES[s].risk}));
        }else{res.writeHead(400);res.end('unknown strategy')}
      }catch(e){res.writeHead(400);res.end('bad request')}
    });return;
  }

  if(req.method==='POST'&&req.url==='/api/keys'){
    let body='';req.on('data',c=>body+=c);req.on('end',()=>{
      try{const d=JSON.parse(body);if(d.provider&&d.key){setApiKey(d.provider,d.key);
        res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({ok:true,keys:getApiKeys()}))}
      else{res.writeHead(400);res.end('need provider+key')}}catch(e){res.writeHead(400);res.end('bad')}
    });return;
  }

  if(req.url==='/api/keys'){
    res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify(getApiKeys()));return;
  }

  if(req.url==='/api/strategies'){
    const list={};for(const[k,v]of Object.entries(STRATEGIES))list[k]={name:v.name,desc:v.desc,risk:v.risk};
    res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify(list));return;
  }

  if(req.url==='/api/state'){
    res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify(getState()));return;
  }

  // CORS preflight
  if(req.method==='OPTIONS'){
    res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST','Access-Control-Allow-Headers':'Content-Type'});
    res.end();return;
  }

  // Serve public files
  let filePath=req.url==='/'?'/index.html':req.url;
  filePath=path.join(PUBLIC,filePath);
  const ext=path.extname(filePath);
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};

  fs.readFile(filePath,(err,data)=>{
    if(err){
      // Proxy to Primordium server on 8080
      const proxy=http.request({hostname:'127.0.0.1',port:8080,path:req.url,method:req.method,headers:req.headers},pRes=>{
        res.writeHead(pRes.statusCode,pRes.headers);pRes.pipe(res);
      });
      proxy.on('error',()=>{res.writeHead(404);res.end('not found')});
      req.pipe(proxy);
      return;
    }
    res.writeHead(200,{'Content-Type':types[ext]||'text/plain','Access-Control-Allow-Origin':'*'});
    res.end(data);
  });
});

// ── WebSocket ──────────────────────────────────────────────────
const wss=new WebSocketServer({server});
const clients=new Set();

wss.on('connection',ws=>{
  clients.add(ws);
  narrator.log('Client connected ('+clients.size+' total)','nt');
  // Send initial state immediately
  ws.send(JSON.stringify(getState()));
  ws.on('close',()=>clients.delete(ws));
  ws.on('error',()=>clients.delete(ws));
});

// Broadcast state to all clients every 5 seconds
setInterval(()=>{
  if(clients.size===0)return;
  const state=JSON.stringify(getState());
  for(const ws of clients){try{if(ws.readyState===1)ws.send(state)}catch(e){}}
},5000);

// ── Start ──────────────────────────────────────────────────────
server.listen(PORT,'127.0.0.1',()=>{
  console.log('B.O.S.S. Universe Server running on port '+PORT);
  console.log('Engine: private | Frontend: public/index.html');
  console.log('WebSocket: ws://localhost:'+PORT);
  narrator.log('Server online','nt');
});
