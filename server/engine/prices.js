// B.O.S.S. Price Aggregator — Server-side (PRIVATE)
// Multi-market: Crypto + Forex + Commodities + Stock Indices

let priceCache=null,lastFetchTime=0;

// API keys — loaded from env or set via API
const fs=require('fs');
const keyFile=require('path').join(__dirname,'..','..','keys.json');
let apiKeys={finnhub:null,alphaVantage:null};
// Load saved keys
try{const saved=JSON.parse(fs.readFileSync(keyFile,'utf8'));Object.assign(apiKeys,saved)}catch(e){}
// Env override
if(process.env.FINNHUB_KEY)apiKeys.finnhub=process.env.FINNHUB_KEY;
if(process.env.ALPHA_VANTAGE_KEY)apiKeys.alphaVantage=process.env.ALPHA_VANTAGE_KEY;

function setApiKey(provider,key){apiKeys[provider]=key;try{fs.writeFileSync(keyFile,JSON.stringify(apiKeys))}catch(e){}}
function getApiKeys(){return{finnhub:!!apiKeys.finnhub,alphaVantage:!!apiKeys.alphaVantage}}

async function fetchPrices(field){
  const now=Date.now();
  if(priceCache&&now-lastFetchTime<25000)return priceCache;
  const R={};

  // ═══ CRYPTO — CoinGecko + CoinCap ═══
  try{
    const coins='bitcoin,ethereum,solana,dogecoin,cardano,ripple,polkadot,toncoin,chainlink,avalanche-2,uniswap,litecoin,near,aptos,sui,arbitrum,optimism,celestia,render-token,injective-protocol,fetch-ai,bonk,pepe,floki,aave,maker,lido-dao,pendle,fantom,cosmos,algorand,hedera-hashgraph,theta-token,vechain';
    const r=await fetch('https://api.coingecko.com/api/v3/simple/price?ids='+coins+'&vs_currencies=usd&include_24hr_change=true');
    const d=await r.json();if(d.status)throw new Error('rate limited');
    for(const[id,info]of Object.entries(d)){if(info.usd)R[id.toUpperCase()]={price:info.usd,change:info.usd_24h_change||0,type:'crypto'}}
  }catch(e){}

  try{
    const capMap={bitcoin:'BITCOIN',ethereum:'ETHEREUM',solana:'SOLANA',dogecoin:'DOGECOIN',cardano:'CARDANO',
      xrp:'RIPPLE',polkadot:'POLKADOT',toncoin:'TONCOIN',chainlink:'CHAINLINK',avalanche:'AVALANCHE-2',
      uniswap:'UNISWAP',litecoin:'LITECOIN',near:'NEAR',cosmos:'COSMOS'};
    const r2=await fetch('https://api.coincap.io/v2/assets?limit=30');const d2=await r2.json();
    for(const c of(d2.data||[])){const p=parseFloat(c.priceUsd),ch=parseFloat(c.changePercent24Hr);
      const key=capMap[c.id]||c.id.toUpperCase();
      if(R[key]){R[key].price=(R[key].price+p)/2;R[key].change=(R[key].change+ch)/2}}
  }catch(e){}

  // ═══ FOREX — Finnhub real-time or ExchangeRate fallback ═══
  const forexPairs=['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'];

  // Forex: always use ExchangeRate (Finnhub free doesn't include forex)
  try{
    const r3=await fetch('https://open.er-api.com/v6/latest/USD');const d3=await r3.json();
    for(const c of['EUR','GBP','JPY','CHF','AUD','CAD','MXN','SEK','BRL','CNY']){
      if(!d3.rates||!d3.rates[c])continue;const key='USD/'+c;const rate=d3.rates[c];
      let fxChange=0;if(field){const fn=field.nodes.get(key);if(fn&&fn.history.length>1){const prev=fn.history[fn.history.length-1];fxChange=(rate-prev)/prev*100}}
      R[key]={price:rate,change:fxChange,type:'forex'}}
  }catch(e){}

  // ═══ COMMODITIES — Alpha Vantage or Finnhub ═══
  if(apiKeys.finnhub){
    // Finnhub commodity ETFs as proxies for commodity prices
    const commodities=[
      {sym:'GLD',name:'GOLD',type:'commodity'},
      {sym:'SLV',name:'SILVER',type:'commodity'},
      {sym:'USO',name:'OIL (WTI)',type:'commodity'},
      {sym:'UNG',name:'NAT GAS',type:'commodity'},
      {sym:'CPER',name:'COPPER',type:'commodity'},
      {sym:'WEAT',name:'WHEAT',type:'commodity'}
    ];
    for(const c of commodities){
      try{
        const r=await fetch('https://finnhub.io/api/v1/quote?symbol='+c.sym+'&token='+apiKeys.finnhub);
        const d=await r.json();
        if(d.c&&d.c>0){
          const prev=d.pc||d.c;const change=prev>0?((d.c-prev)/prev*100):0;
          R[c.name]={price:d.c,change:change,type:'commodity'};
        }
      }catch(e){}
    }
  }

  if(apiKeys.alphaVantage){
    // Alpha Vantage direct commodity prices
    const avCommodities=[
      {fn:'WTI',name:'OIL (WTI)'},
      {fn:'BRENT',name:'OIL (BRENT)'},
      {fn:'NATURAL_GAS',name:'NAT GAS'},
      {fn:'COPPER',name:'COPPER'}
    ];
    for(const c of avCommodities){
      if(R[c.name])continue; // skip if Finnhub already got it
      try{
        const r=await fetch('https://www.alphavantage.co/query?function='+c.fn+'&interval=daily&apikey='+apiKeys.alphaVantage);
        const d=await r.json();
        const data=d.data||d.dataset;
        if(data&&data.length>1){
          const latest=parseFloat(data[0].value);const prev=parseFloat(data[1].value);
          const change=prev>0?((latest-prev)/prev*100):0;
          R[c.name]={price:latest,change:change,type:'commodity'};
        }
      }catch(e){}
    }
  }

  // ═══ STOCK INDICES — Finnhub ═══
  if(apiKeys.finnhub){
    const indices=[
      {sym:'SPY',name:'S&P 500',type:'index'},
      {sym:'QQQ',name:'NASDAQ',type:'index'},
      {sym:'DIA',name:'DOW JONES',type:'index'},
      {sym:'EWU',name:'FTSE 100',type:'index'},
      {sym:'EWG',name:'DAX',type:'index'},
      {sym:'EWJ',name:'NIKKEI',type:'index'},
      {sym:'EWH',name:'HANG SENG',type:'index'},
      {sym:'VGK',name:'EURO STOXX',type:'index'},
      {sym:'EEM',name:'EMERGING MKT',type:'index'},
      {sym:'IWM',name:'RUSSELL 2000',type:'index'}
    ];
    for(const idx of indices){
      try{
        const r=await fetch('https://finnhub.io/api/v1/quote?symbol='+idx.sym+'&token='+apiKeys.finnhub);
        const d=await r.json();
        if(d.c&&d.c>0){
          const prev=d.pc||d.c;const change=prev>0?((d.c-prev)/prev*100):0;
          R[idx.name]={price:d.c,change:change,type:'index'};
        }
      }catch(e){}
    }
  }

  // ═══ POLYMARKET ═══
  try{
    const r4=await fetch('https://gamma-api.polymarket.com/markets?limit=10&active=true&closed=false');
    const d4=await r4.json();
    for(const m of d4){if(m.closed)continue;const q=(m.question||'').substring(0,22).trim();const v=parseFloat(m.volumeNum||0);
      if(v<500||!q)continue;R[q]={price:parseFloat(m.lastTradePrice||.5),change:parseFloat(m.oneDayPriceChange||0)*100,type:'poly'}}
  }catch(e){}

  if(Object.keys(R).length>5){priceCache=R;lastFetchTime=now}
  return R;
}

module.exports={fetchPrices,setApiKey,getApiKeys};
