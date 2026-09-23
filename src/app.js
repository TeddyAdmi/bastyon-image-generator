import { MIYA_CONFIG } from "./config.js";
import { getState, setState } from "./state.js";
import { initBastyon } from "./bastyon.js";

const ideas = [
  "Кинематографичный портрет, мягкий свет, ultra detailed",
  "Футуристический город после дождя, neon reflections",
  "Милый кудрявый поросёнок в роскошном отеле",
  "Editorial fashion portrait, natural skin, studio light",
  "Фантастический лес, volumetric light, cinematic",
  "Минималистичный продуктовый кадр для рекламы",
  "Средневековый замок на скале на рассвете",
  "Космический исследователь на неизвестной планете",
  "Cozy coffee shop, warm morning light, film look",
  "Кинематографичная сцена из фильма, realistic photography"
];

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function status(message="") { const el=$("#status"); el.textContent=message; el.classList.toggle("show",!!message); }
function error(message="") { const el=$("#error"); el.textContent=message; el.classList.toggle("show",!!message); }
function busy(value) { $("#generate").disabled=value; $("#progress").classList.toggle("hidden",!value); }

function renderIdeas() {
  const box=$("#ideas"); box.innerHTML="";
  [...ideas].sort(()=>Math.random()-.5).slice(0,6).forEach(idea=>{
    const b=document.createElement("button"); b.className="idea"; b.textContent=idea; b.onclick=()=>$("#prompt").value=idea; box.appendChild(b);
  });
}

function renderAccount(user) {
  const name=user.name || (user.mode==="bastyon" ? "Bastyon user" : "Miya User");
  $("#account-name").textContent=name;
  $("#account-balance").textContent=user.mode==="bastyon" ? `${user.balance ?? "—"} PKOIN` : "Web mode";
  $("#runtime-status").textContent=user.mode==="bastyon" ? "Bastyon" : "Web mode";
  $("#system-runtime").textContent=user.mode==="bastyon" ? "Bastyon" : "Web";
  $("#system-auth").textContent=user.mode==="bastyon" ? "Bastyon SDK" : "Browser";
  const avatar=$("#account-avatar"); avatar.innerHTML="";
  if(user.avatar){const img=document.createElement("img");img.src=user.avatar;img.alt="";avatar.appendChild(img)}else avatar.textContent=name.slice(0,1).toUpperCase();
}

function switchView(view) {
  setState({view});
  $$(".view").forEach(el=>el.classList.toggle("active",el.id===`view-${view}`));
  $$("[data-view]").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
}

function switchTool(tool) {
  const labels={
    image:["Генератор изображений","Создай изображение по описанию"],
    edit:["Фото-редактор","Редактирование и reference workflow"],
    video:["Видео-студия","Text → Video / Image → Video / Video → Video"],
    audio:["Аудио-студия","Voice, music и sound effects"],
    character:["Character","Модуль будет подключён к router"],
    lipsync:["Lip Sync","Модуль будет подключён к router"]
  };
  setState({tool});
  $$(".tool").forEach(el=>el.classList.toggle("active",el.dataset.tool===tool));
  $("#workspace-title").textContent=labels[tool]?.[0] || "Miya AI";
  $("#workspace-subtitle").textContent=labels[tool]?.[1] || "";
  if(tool!=="image") status("Foundation готов. Этот модуль подключим к AI Router на следующем этапе."); else status("");
}

function chooseRatio(ratio) {
  setState({ratio});
  $$("#ratio-group button").forEach(el=>el.classList.toggle("selected",el.dataset.ratio===ratio));
}

async function generate() {
  const prompt=$("#prompt").value.trim();
  if(!prompt){error("Сначала введи описание изображения.");return}
  error("");busy(true);status("Miya Router: готовим запрос…");
  try {
    const r=await fetch(`${MIYA_CONFIG.apiBase}/generate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,ratio:getState().ratio,mode:getState().tool})});
    const type=r.headers.get("content-type")||"";
    if(!r.ok){const body=type.includes("json")?JSON.stringify(await r.json()):await r.text();throw new Error(body||`HTTP ${r.status}`)}
    if(!type.includes("json")) throw new Error("API foundation");
    const data=await r.json();
    if(!data?.imageUrl) throw new Error("No imageUrl");
    showImage(data.imageUrl);status("Готово");
  } catch(e) {
    status("");error("Foundation готов. Следующий этап — подключение бесплатного Image Router.");console.warn(e);
  } finally { busy(false); }
}

function showImage(url) {
  $("#empty-state").classList.add("hidden");$("#result-video").classList.add("hidden");$("#result-image").classList.remove("hidden");$("#result-image").src=url;setState({result:{type:"image",url}});
}
function clearWorkspace() {
  $("#empty-state").classList.remove("hidden");$("#result-image").classList.add("hidden");$("#result-video").classList.add("hidden");$("#result-image").removeAttribute("src");$("#result-video").removeAttribute("src");status("");error("");setState({result:null});
}

function initEvents() {
  $$("[data-view]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
  $$(".tool").forEach(b=>b.addEventListener("click",()=>switchTool(b.dataset.tool)));
  $$("#ratio-group button").forEach(b=>b.addEventListener("click",()=>chooseRatio(b.dataset.ratio)));
  $("#random-idea").onclick=()=>$("#prompt").value=ideas[Math.floor(Math.random()*ideas.length)];
  $("#generate").onclick=generate;
  $("#clear-workspace").onclick=clearWorkspace;
  $("#mobile-profile").onclick=()=>status(getState().account.mode==="bastyon"?"Профиль Bastyon подключён через SDK.":"Открой Miya AI внутри Bastyon для авторизации.");
}

async function init() {
  renderIdeas();initEvents();
  const result=await initBastyon();
  const account=result.user||getState().account;
  setState({account});renderAccount(account);
  window.addEventListener("miya:bastyon-balance",e=>{const a=getState().account;const value=typeof e.detail==="number"?e.detail.toFixed(4):e.detail;const next={...a,balance:value};setState({account:next});renderAccount(next)});
  console.info("Miya AI foundation",MIYA_CONFIG.version);
}
init();
