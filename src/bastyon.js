import { MIYA_CONFIG } from "./config.js";
let sdk = null;

function loadSdk() {
  return new Promise((resolve, reject) => {
    if (window.BastyonSdk) return resolve(window.BastyonSdk);
    const old = document.querySelector("script[data-bastyon-sdk]");
    if (old) { old.addEventListener("load", () => resolve(window.BastyonSdk)); old.addEventListener("error", reject); return; }
    const script = document.createElement("script");
    script.src = MIYA_CONFIG.bastyon.sdkUrl;
    script.async = true;
    script.dataset.bastyonSdk = "1";
    script.onload = () => resolve(window.BastyonSdk);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function profileOf(profile) {
  const p = profile || {};
  return { name: p.name || p.pName || p.nickname || p.nick || p.n || null, avatar: p.i || p.image || p.avatar || p.avatarUrl || null };
}

export async function initBastyon() {
  try {
    const BastyonSdk = await loadSdk();
    sdk = typeof BastyonSdk === "function" ? new BastyonSdk() : BastyonSdk;
    if (sdk?.init) await sdk.init();
    if (sdk?.permissions?.request) { try { await sdk.permissions.request(["account"]); } catch {} }
    let account = null;
    try { account = sdk?.get?.account ? await sdk.get.account() : null; } catch {}
    if (!account?.address && account?.addr) account.address = account.addr;
    if (!account?.address) return { mode: "web", sdk };
    let profile = null;
    try { if (sdk.rpc) profile = await sdk.rpc("getuserprofile", { address: account.address, shortForm: "basic" }); } catch {}
    let balance = null;
    try { if (sdk.get?.balance) balance = await sdk.get.balance(); } catch {}
    const user = { mode: "bastyon", address: account.address, ...profileOf(profile), balance: typeof balance === "number" ? balance.toFixed(4) : balance };
    sdk?.on?.("balance", value => window.dispatchEvent(new CustomEvent("miya:bastyon-balance", { detail: value })));
    sdk?.emit?.("loaded");
    return { mode: "bastyon", sdk, user };
  } catch (error) {
    console.warn("Bastyon SDK unavailable; using web mode.", error);
    return { mode: "web", error };
  }
}
