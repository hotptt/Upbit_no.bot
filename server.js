// Upbit → Discord alert server with Discord slash-commands
import WebSocket from "ws";
import fetch from "node-fetch";
import fs from "fs";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";

const CFG_FILE = "config.json";
function loadCfg(){
  try{ return JSON.parse(fs.readFileSync(CFG_FILE, "utf-8")); }catch{return {};}
}
function saveCfg(cfg){ fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2), "utf-8"); }

const envDefaults = {
  MARKET: process.env.MARKET || "KRW-BTC",
  AVERAGE: parseFloat(process.env.AVERAGE || "98000000"),
  UP_PCT: parseFloat(process.env.UP_PCT || "2"),
  DOWN_PCT: parseFloat(process.env.DOWN_PCT || "-1"),
  COOLDOWN_MIN: parseInt(process.env.COOLDOWN_MIN || "5", 10)
};
let cfg = { ...envDefaults, ...loadCfg() };
saveCfg(cfg);

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || "";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || "";
if(!DISCORD_WEBHOOK or DISCORD_WEBHOOK===""){ throw new Error("Set DISCORD_WEBHOOK"); }
if(!DISCORD_TOKEN or DISCORD_TOKEN===""){ throw new Error("Set DISCORD_TOKEN"); }
if(!DISCORD_GUILD_ID or DISCORD_GUILD_ID===""){ throw new Error("Set DISCORD_GUILD_ID"); }

let lastUp=0,lastDown=0, ws, reconnectTimer=null, attempts=0;
function relPct(p,a){ return (p/a-1)*100; }
function fmtKRW(n){ return new Intl.NumberFormat("ko-KR",{maximumFractionDigits:8}).format(n); }

async function sendDiscordAlert({ title, market, price, rel, threshold, isUp }){
  const color = isUp ? 0x16a34a : 0xef4444;
  const payload={embeds:[{title, color, fields:[
    {name:"시장", value:market, inline:true},
    {name:"현재가", value:`${fmtKRW(price)} KRW`, inline:true},
    {name:"평단대비", value:`${rel>=0?"+":""}${rel.toFixed(2)}%`, inline:true},
    {name:"임계값", value:`${isUp?">=":"<="} ${threshold}%`, inline:true}
  ], timestamp:new Date().toISOString()}]};
  const res = await fetch(DISCORD_WEBHOOK,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!res.ok){ console.error("Discord send failed", res.status, await res.text().catch(()=>"(no body)")); }
}

function startWatcher(){
  clearTimeout(reconnectTimer); attempts+=1;
  ws = new WebSocket("wss://api.upbit.com/websocket/v1");
  ws.on("open", ()=>{
    attempts=0;
    console.log(`Watcher: ${cfg.MARKET} avg=${cfg.AVERAGE} up=${cfg.UP_PCT} down=${cfg.DOWN_PCT} cd=${cfg.COOLDOWN_MIN}m`);
    ws.send(JSON.stringify([{ticket:"avgpct"},{type:"ticker",codes:[cfg.MARKET]},{format:"SIMPLE"}]));
  });
  ws.on("message", async (d)=>{
    let obj; try{ obj=JSON.parse(d.toString("utf8")); }catch{return;}
    const price = obj.tp ?? obj.trade_price; if(price==null) return;
    const rel = relPct(price, cfg.AVERAGE);
    const now = Date.now(), cdMs = cfg.COOLDOWN_MIN*60*1000;
    if(Number.isFinite(cfg.UP_PCT) && rel>=cfg.UP_PCT && now-lastUp>=cdMs){ lastUp=now; await sendDiscordAlert({title:"🚀 상향 알림",market:cfg.MARKET,price,rel,threshold:cfg.UP_PCT,isUp:true}); }
    if(Number.isFinite(cfg.DOWN_PCT) && rel<=cfg.DOWN_PCT && now-lastDown>=cdMs){ lastDown=now; await sendDiscordAlert({title:"📉 하향 알림",market:cfg.MARKET,price,rel,threshold:cfg.DOWN_PCT,isUp:false}); }
  });
  ws.on("close", ()=>{ const delay=Math.min(30000,1000*Math.pow(2,Math.min(attempts,5))); reconnectTimer=setTimeout(startWatcher,delay); });
  ws.on("error", (e)=>{ console.error("WS error", e?.message||e); try{ws.close();}catch{} });
}
startWatcher();

// Discord bot
const client = new Client({ intents:[GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName("status").setDescription("현재 설정 보기"),
  new SlashCommandBuilder().setName("set").setDescription("설정 변경")
    .addStringOption(o=>o.setName("market").setDescription("예: KRW-BTC"))
    .addNumberOption(o=>o.setName("average").setDescription("평단가 KRW"))
    .addNumberOption(o=>o.setName("up").setDescription("상향 임계 %"))
    .addNumberOption(o=>o.setName("down").setDescription("하향 임계 %"))
    .addIntegerOption(o=>o.setName("cooldown").setDescription("쿨다운 분")),
  new SlashCommandBuilder().setName("test").setDescription("테스트 알림 보내기")
].map(c=>c.toJSON());

async function registerCommands(){
  const rest = new REST({version:"10"}).setToken(DISCORD_TOKEN);
  const appId = (await rest.get(Routes.oauth2CurrentApplication())).id;
  await rest.put(Routes.applicationGuildCommands(appId, DISCORD_GUILD_ID), { body: commands });
  console.log("Slash commands registered");
}

client.on("ready", async ()=>{
  console.log(`Bot logged in as ${client.user.tag}`);
  try{ await registerCommands(); }catch(e){ console.error("register failed", e); }
});

client.on("interactionCreate", async (i)=>{
  try{
    if(!i.isChatInputCommand()) return;
    if(i.commandName==="status"){
      await i.reply({ephemeral:true, content:`📊 설정\nmarket: ${cfg.MARKET}\naverage: ${cfg.AVERAGE}\nup: ${cfg.UP_PCT}%\ndown: ${cfg.DOWN_PCT}%\ncooldown: ${cfg.COOLDOWN_MIN}분`});
    }else if(i.commandName==="set"){
      const upd = {...cfg};
      const m = i.options.getString("market");
      const a = i.options.getNumber("average");
      const u = i.options.getNumber("up");
      const d = i.options.getNumber("down");
      const c = i.options.getInteger("cooldown");
      if(m!=null) upd.MARKET = m;
      if(a!=null) upd.AVERAGE = a;
      if(u!=null) upd.UP_PCT = u;
      if(d!=null) upd.DOWN_PCT = d;
      if(c!=null) upd.COOLDOWN_MIN = c;
      cfg = upd; saveCfg(cfg);
      await i.reply({ephemeral:true, content:`✅ 변경됨\nmarket: ${cfg.MARKET}\naverage: ${cfg.AVERAGE}\nup: ${cfg.UP_PCT}%\ndown: ${cfg.DOWN_PCT}%\ncooldown: ${cfg.COOLDOWN_MIN}분`});
      try{ ws?.close(); }catch{} // resubscribe
    }else if(i.commandName==="test"){
      await sendDiscordAlert({title:"🔔 테스트 알림", market:cfg.MARKET, price:cfg.AVERAGE*(1+((cfg.UP_PCT||2)/100)), rel:(cfg.UP_PCT||2), threshold:(cfg.UP_PCT||2), isUp:true});
      await i.reply({ephemeral:true, content:"✅ 테스트 전송 완료"});
    }
  }catch(e){
    console.error("interaction error", e);
    try{ await i.reply({ephemeral:true, content:"❌ 에러: "+(e?.message||e)}); }catch{}
  }
});

client.login(DISCORD_TOKEN);
