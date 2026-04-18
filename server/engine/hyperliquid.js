// B.O.S.S. Hyperliquid API — Server-side (PRIVATE)

class HyperliquidAPI {
  constructor(nar){this.nar=nar;this.ws=null;this.connected=false;this.orderbook={};this.funding={};this.liquidations={};this.trades={};this.callbacks={}}

  async connect(){
    return new Promise((resolve,reject)=>{
      try{
        this.ws=new WebSocket('wss://api.hyperliquid.xyz/ws');
        this.ws.addEventListener('open',()=>{
          this.connected=true;this.nar.log('HL connected','nt-trade');
          ['BTC','ETH','SOL','DOGE','ADA','AVAX','DOT','LINK','TON','XRP'].forEach(c=>{this.subscribe('trades',c);this.subscribe('l2Book',c)});
          this.ws.send(JSON.stringify({method:'subscribe',subscription:{type:'allLiquidations'}}));
          resolve();
        });
        this.ws.addEventListener('message',e=>{try{this.handleMessage(JSON.parse(e.data))}catch(x){}});
        this.ws.addEventListener('error',()=>reject());
        this.ws.addEventListener('close',()=>{this.connected=false;setTimeout(()=>this.connect().catch(()=>{}),5000)});
      }catch(e){reject(e)}
    });
  }

  subscribe(type,coin){if(this.ws&&this.ws.readyState===1)this.ws.send(JSON.stringify({method:'subscribe',subscription:{type,coin}}))}

  handleMessage(data){
    const ch=data.channel,d=data.data;
    if(ch==='trades')for(const t of(d||[])){const sym=t.coin;if(!this.trades[sym])this.trades[sym]=[];this.trades[sym].push({price:parseFloat(t.px),size:parseFloat(t.sz),side:t.side});if(this.trades[sym].length>100)this.trades[sym].shift();if(parseFloat(t.sz)*parseFloat(t.px)>100000)this.onWhale(sym,t)}
    if(ch==='l2Book'){const sym=d.coin;this.orderbook[sym]={bids:(d.levels[0]||[]).map(l=>({price:parseFloat(l.px),size:parseFloat(l.sz)})),asks:(d.levels[1]||[]).map(l=>({price:parseFloat(l.px),size:parseFloat(l.sz)}))}}
    if(ch==='allLiquidations')for(const liq of(d||[])){const sym=liq.coin;if(!this.liquidations[sym])this.liquidations[sym]=[];this.liquidations[sym].push({price:parseFloat(liq.px),size:parseFloat(liq.sz),side:liq.side});if(this.liquidations[sym].length>50)this.liquidations[sym].shift()}
  }

  onWhale(sym,trade){
    const val=parseFloat(trade.sz)*parseFloat(trade.px);
    this.nar.log('Whale: '+sym+' $'+(val/1000).toFixed(0)+'K','nt-cascade');
    if(this.callbacks.onWhale)this.callbacks.onWhale(sym,trade.side,val);
  }

  async getFundingRates(){
    try{const r=await fetch('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'metaAndAssetCtxs'})});
      const data=await r.json();const metas=data[0]?.universe||[];const ctxs=data[1]||[];
      for(let i=0;i<metas.length&&i<ctxs.length;i++){const sym=metas[i].name;this.funding[sym]={rate:parseFloat(ctxs[i].funding||0),markPrice:parseFloat(ctxs[i].markPx||0)}}
      return this.funding}catch(e){return{}}
  }

  getLatestPrice(sym){const t=this.trades[sym];if(!t||t.length===0)return null;return t[t.length-1].price}

  getDepth(sym){
    const ob=this.orderbook[sym];if(!ob)return{imbalance:0};
    const bd=ob.bids.slice(0,10).reduce((s,b)=>s+b.size*b.price,0);
    const ad=ob.asks.slice(0,10).reduce((s,a)=>s+a.size*a.price,0);
    const t=bd+ad;return{imbalance:t>0?(bd-ad)/t:0}
  }

  getDepthAll(){
    const r={};for(const sym in this.orderbook)r[sym]=this.getDepth(sym);return r;
  }

  getLiqSummary(){
    const r={};
    for(const sym in this.liquidations){
      const liqs=this.liquidations[sym];if(!liqs||liqs.length<1)continue;
      let longL=0,shortL=0;for(const l of liqs){if(l.side==='long')longL++;else shortL++}
      r[sym]={long:longL,short:shortL,total:longL+shortL};
    }
    return r;
  }
}

class FundingFarmer {
  constructor(api,nar){this.api=api;this.nar=nar;this.opportunities=[]}
  async scan(){
    const funding=await this.api.getFundingRates();this.opportunities=[];
    for(const[sym,d]of Object.entries(funding)){const ann=d.rate*3*365*100;
      if(Math.abs(ann)>30)this.opportunities.push({symbol:sym,annualized:ann,direction:d.rate>0?'SHORT':'LONG'})}
    this.opportunities.sort((a,b)=>Math.abs(b.annualized)-Math.abs(a.annualized));
    if(this.opportunities.length>0)this.nar.log('Funding: '+this.opportunities[0].symbol+' '+this.opportunities[0].direction+' '+this.opportunities[0].annualized.toFixed(0)+'% APR','nt-cascade');
    return this.opportunities;
  }
}

module.exports={HyperliquidAPI,FundingFarmer};
