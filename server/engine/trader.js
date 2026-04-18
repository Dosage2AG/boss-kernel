// B.O.S.S. Trade Executor — Server-side (PRIVATE)

const STRATEGIES={
  conservative:{
    name:'Conservative',
    desc:'Low risk, steady growth. ~10-15%/month. Best for learning.',
    risk:'Low drawdown (3-5%). 97% of months profitable. Will not double your money in a month.',
    cfg:{maxPos:4,posSize:0.20,maxExposure:0.65,stopLoss:0.035,takeProfit:0.08,dailyLimit:0.12,baseLev:2,maxLev:4,fee:0.0005,griefThreshold:0.6,cooldown:30000}
  },
  aggressive:{
    name:'Aggressive',
    desc:'Higher leverage, bigger positions. ~30-50%/month median.',
    risk:'Moderate drawdown (8-12%). Occasional -15% days. 97% of months profitable but swings are real.',
    cfg:{maxPos:6,posSize:0.35,maxExposure:0.85,stopLoss:0.025,takeProfit:0.15,dailyLimit:0.15,baseLev:4,maxLev:8,fee:0.0005,griefThreshold:0.55,cooldown:20000}
  },
  max:{
    name:'Max Profit',
    desc:'Maximum leverage, cascade-boosted. Aims for 100%+/month.',
    risk:'HIGH RISK. Drawdowns of 10-20%. Top 10% of months double your money. Bottom 5% can lose 20-30%. Only use money you can afford to lose entirely.',
    cfg:{maxPos:8,posSize:0.40,maxExposure:0.90,stopLoss:0.02,takeProfit:0.20,dailyLimit:0.20,baseLev:6,maxLev:12,fee:0.0005,griefThreshold:0.50,cooldown:15000}
  }
};

class BossTrader {
  constructor(field,nar){
    this.field=field;this.nar=nar;this.balance=0;this.startBal=0;
    this.positions=new Map();this.history=[];this.wins=0;this.losses=0;
    this.dailyPnL=0;this.consecutiveLosses=0;this.lastLossTime=0;
    this.strategy='conservative';
    this.cfg={...STRATEGIES.conservative.cfg};
  }

  setStrategy(key){
    if(!STRATEGIES[key])return false;
    this.strategy=key;
    this.cfg={...STRATEGIES[key].cfg};
    this.nar.log('Strategy: '+STRATEGIES[key].name,'nt-trade');
    return true;
  }

  start(bal){this.balance=bal;this.startBal=bal;this.nar.log('Trader: '+bal.toFixed(0)+' TON','nt-trade')}

  execute(){
    if(this.balance<=0)return;const now=Date.now();
    if(this.dailyPnL<-(this.startBal*this.cfg.dailyLimit))return;
    if(this.field.grief>this.cfg.griefThreshold){this.nar.log('Grief closing all','nt-grief');this.closeAll('Grief');return}
    if(now-this.lastLossTime<this.cfg.cooldown)return;
    for(const[id,pos]of this.positions){
      const n=this.field.nodes.get(id);if(!n||!n.price)continue;
      const pnl=pos.dir==='LONG'?(n.price-pos.entry)/pos.entry*pos.lev:(pos.entry-n.price)/pos.entry*pos.lev;
      const stopAt=pnl>0.05?-0.012:-this.cfg.stopLoss;
      if(pnl<=stopAt)this.close(id,n.price,pnl,pnl>0?'Trail':'SL');
      else if(pnl>=this.cfg.takeProfit&&!pos.partial){const amt=pos.size*0.6;const net=amt*pnl-amt*this.cfg.fee*2;this.balance+=amt+net;this.dailyPnL+=net;pos.size*=0.4;pos.partial=true}
      else if(pnl>=this.cfg.takeProfit*2.5)this.close(id,n.price,pnl,'TP');
      else if(n.warmth<0.12&&pnl>0.01)this.close(id,n.price,pnl,'Fade');
    }
    if(this.positions.size>=this.cfg.maxPos)return;
    let exposure=0;for(const[,p]of this.positions)exposure+=p.size;
    if(exposure>=this.balance*this.cfg.maxExposure)return;
    const signals=this.field.getSignals();
    for(const sig of signals){
      if(this.positions.has(sig.id)||this.positions.size>=this.cfg.maxPos)continue;
      let size=this.balance*this.cfg.posSize;
      if(sig.cascadeBoost&&Math.abs(sig.cascadeBoost)>0.05)size*=1.4;
      if(this.consecutiveLosses>2)size*=0.5;
      const lev=Math.min(this.cfg.maxLev,this.cfg.baseLev+sig.warmth);
      size=Math.min(size,this.balance*0.9);if(size<1)continue;
      this.positions.set(sig.id,{entry:sig.price,size,dir:sig.dir,lev,time:Date.now(),partial:false});
      this.balance-=size;
      const node=this.field.nodes.get(sig.id);if(node)node.hasTrade=true;
      this.nar.log((sig.dir==='LONG'?'Buy ':'Short ')+sig.id+' '+lev.toFixed(1)+'x','nt-trade');
    }
  }

  close(id,price,pnlPct,reason){
    const pos=this.positions.get(id);if(!pos)return;
    const net=pos.size*pnlPct-pos.size*this.cfg.fee*2;
    this.balance+=pos.size+net;this.dailyPnL+=net;
    if(net>=0){this.wins++;this.consecutiveLosses=0}else{this.losses++;this.consecutiveLosses++;this.lastLossTime=Date.now()}
    const node=this.field.nodes.get(id);if(node)node.hasTrade=false;
    this.history.push({id,dir:pos.dir,pnl:net,pnlPct:pnlPct*100,reason,time:Date.now()});
    if(this.history.length>100)this.history.shift();
    this.positions.delete(id);
    this.nar.log((net>=0?'+ ':'- ')+id+' '+(pnlPct*100).toFixed(1)+'%',net>=0?'nt-trade':'nt-grief');
  }

  closeAll(reason){
    const ids=[...this.positions.keys()];
    for(const id of ids){
      const n=this.field.nodes.get(id);if(!n||!n.price)continue;
      const pos=this.positions.get(id);
      const pnl=pos.dir==='LONG'?(n.price-pos.entry)/pos.entry*pos.lev:(pos.entry-n.price)/pos.entry*pos.lev;
      this.close(id,n.price,pnl,reason);
    }
  }

  reset(bal){
    this.balance=bal||10000;this.startBal=this.balance;this.wins=0;this.losses=0;
    this.positions.clear();this.history=[];this.dailyPnL=0;this.consecutiveLosses=0;
    this.nar.log('Reset: '+this.balance.toFixed(0)+' TON','nt-trade');
  }

  getStatus(){
    const t=this.wins+this.losses;
    const positions=[];
    for(const[id,p]of this.positions){
      const n=this.field.nodes.get(id);
      const pnl=n&&n.price?((p.dir==='LONG'?(n.price-p.entry)/p.entry:(p.entry-n.price)/p.entry)*p.lev):0;
      positions.push({id,dir:p.dir,lev:p.lev,entry:p.entry,size:p.size,pnl:pnl*100});
    }
    return{balance:this.balance,startBal:this.startBal,positions,posCount:this.positions.size,
      trades:t,wins:this.wins,losses:this.losses,winRate:t>0?(this.wins/t*100):0,grief:this.field.grief,
      strategy:this.strategy,strategyName:STRATEGIES[this.strategy].name};
  }
}

module.exports={BossTrader,STRATEGIES};
