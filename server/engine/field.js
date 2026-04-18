// B.O.S.S. Resonance Field — Server-side (PRIVATE, never served to clients)

class BossNarrator {
  constructor(){this.buffer=[]}
  log(msg,cls){this.buffer.push({time:Date.now(),msg,cls:cls||'nt'});if(this.buffer.length>200)this.buffer.shift()}
  recent(n){return this.buffer.slice(-(n||20)).map(b=>b.time+' '+b.msg)}
}

class TBond {
  constructor(from,to,strength,delayH){this.from=from;this.to=to;this.strength=strength;this.delayMs=delayH*3600000;this.lastFired=0}
}

class BossField {
  constructor(nar){this.nar=nar;this.nodes=new Map();this.bonds=[];this.cascadeQueue=[];this.grief=0;this.fieldWarmth=0}

  addNode(id,type){
    if(!this.nodes.has(id))this.nodes.set(id,{id,type,price:0,change:0,warmth:0.1,dir:null,history:[],ema8:0,ema21:0,ema55:0,rsi:50,cascadeFrom:null,hasTrade:false});
    return this.nodes.get(id);
  }

  updateNode(id,price,change){
    const n=this.nodes.get(id);if(!n)return;
    n.price=price;n.change=change;
    n.dir=change>0.001?'BULL':change<-0.001?'BEAR':n.dir||'BULL';
    n.warmth=Math.max(n.warmth,Math.abs(change)/3);
    n.history.push(price);if(n.history.length>200)n.history.shift();
    const h=n.history;
    if(h.length>=8)n.ema8=this._ema(h.slice(-8),8);
    if(h.length>=21)n.ema21=this._ema(h.slice(-21),21);
    if(h.length>=55)n.ema55=this._ema(h.slice(-55),55);
    if(h.length>=15){let g=0,l=0;for(let i=h.length-14;i<h.length;i++){const d=h[i]-h[i-1];if(d>0)g+=d;else l-=d}const rs=l>0?g/l:100;n.rsi=100-(100/(1+rs))}
  }

  _ema(arr,p){const k=2/(p+1);let e=arr[0];for(let i=1;i<arr.length;i++)e=arr[i]*k+e*(1-k);return e}

  learnBonds(){
    const ids=[...this.nodes.keys()].filter(id=>{const n=this.nodes.get(id);return n.history.length>=30});
    this.bonds=[];
    for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
      const ta=this.nodes.get(ids[i]).type,tb=this.nodes.get(ids[j]).type;
      if(ta!==tb&&!(ta==='crypto'&&tb==='forex')&&!(ta==='forex'&&tb==='crypto'))continue;
      const ha=this.nodes.get(ids[i]).history,hb=this.nodes.get(ids[j]).history;
      let bestCorr=0,bestLag=0;
      for(let lag=0;lag<=12;lag++){
        const len=Math.min(ha.length-lag,hb.length)-1;if(len<10)continue;
        const ca=[],cb=[];
        for(let k=1;k<len;k++){ca.push((ha[k]-ha[k-1])/ha[k-1]);cb.push((hb[k+lag]-hb[k+lag-1])/hb[k+lag-1])}
        const mA=ca.reduce((s,c)=>s+c,0)/ca.length,mB=cb.reduce((s,c)=>s+c,0)/cb.length;
        let num=0,dA=0,dB=0;
        for(let k=0;k<ca.length;k++){const a=ca[k]-mA,b=cb[k]-mB;num+=a*b;dA+=a*a;dB+=b*b}
        const corr=(dA&&dB)?num/Math.sqrt(dA*dB):0;
        if(Math.abs(corr)>Math.abs(bestCorr)){bestCorr=corr;bestLag=lag}
      }
      if(Math.abs(bestCorr)>0.35){
        this.bonds.push(new TBond(ids[i],ids[j],bestCorr,bestLag));
        if(bestLag>0&&Math.abs(bestCorr)>0.5)this.nar.log('Bond: '+ids[i]+' leads '+ids[j]+' by '+bestLag+'h','nt-cascade');
      }
    }
  }

  injectEvent(nodeId,magnitude){
    const n=this.nodes.get(nodeId);if(!n)return;
    n.warmth=Math.min(n.warmth+Math.abs(magnitude)*2,10);
    for(const bond of this.bonds){
      if(bond.from===nodeId||bond.to===nodeId){
        const target=bond.from===nodeId?bond.to:bond.from;
        const prop=magnitude*bond.strength;
        if(Math.abs(prop)>=0.01)this.cascadeQueue.push({target,magnitude:prop,source:nodeId,executeAt:Date.now()+bond.delayMs});
      }
    }
  }

  processCascades(){
    const now=Date.now();
    const ready=this.cascadeQueue.filter(c=>c.executeAt<=now);
    this.cascadeQueue=this.cascadeQueue.filter(c=>c.executeAt>now);
    for(const c of ready){
      const n=this.nodes.get(c.target);if(!n)continue;
      n.warmth=Math.min(n.warmth+Math.abs(c.magnitude)*1.5,10);n.cascadeFrom=c.source;
      this.nar.log('Wave: '+c.source+' → '+c.target,'nt-cascade');
    }
    return ready;
  }

  tick(dt){
    const cascades=this.processCascades();
    for(const[,n]of this.nodes){n.warmth*=Math.exp(-0.001*dt);if(n.warmth<0.08)n.warmth=0.08}
    const cryptos=[...this.nodes.values()].filter(n=>n.type==='crypto');
    const bullW=cryptos.filter(n=>n.dir==='BULL').reduce((s,n)=>s+n.warmth,0);
    const bearW=cryptos.filter(n=>n.dir==='BEAR').reduce((s,n)=>s+n.warmth,0);
    const total=bullW+bearW;
    this.grief=total>0?1-Math.abs(bullW-bearW)/total:0;
    this.fieldWarmth=cryptos.reduce((s,n)=>s+n.warmth,0)/(cryptos.length||1);
    return cascades;
  }

  getSignals(){
    const signals=[];
    for(const[id,n]of this.nodes){
      if(n.type!=='crypto'||n.warmth<0.15)continue;
      let dir=null,reason='';
      if(n.history.length>=25&&n.ema8>n.ema21&&n.ema21>n.ema55&&n.rsi>35&&n.rsi<72){dir='LONG';reason='EMA bull RSI '+n.rsi.toFixed(0)}
      else if(n.history.length>=25&&n.ema8<n.ema21&&n.ema21<n.ema55&&n.rsi>28&&n.rsi<65){dir='SHORT';reason='EMA bear RSI '+n.rsi.toFixed(0)}
      if(!dir&&n.warmth>0.8&&n.change!==0){dir=n.change>0?'LONG':'SHORT';reason='Warmth '+n.warmth.toFixed(1)+' '+n.dir}
      if(n.history.length>=25&&n.ema8>n.ema21&&n.ema21<n.ema55)dir=null;
      if(n.history.length>=25&&n.ema8<n.ema21&&n.ema21>n.ema55)dir=null;
      const cb=this.cascadeQueue.filter(c=>c.target===id).reduce((s,c)=>s+c.magnitude,0);
      if(dir)signals.push({id,dir,warmth:n.warmth,price:n.price,reason,cascadeBoost:cb,rsi:n.rsi});
    }
    return signals.sort((a,b)=>b.warmth-a.warmth);
  }
}

module.exports={BossNarrator,TBond,BossField};
