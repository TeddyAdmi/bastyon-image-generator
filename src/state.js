const initialState = {
  view: "create",
  tool: "image",
  ratio: "1:1",
  prompt: "",
  account: { mode: "web", address: null, name: null, avatar: null, balance: null },
  result: null,
  history: []
};
let state = structuredClone(initialState);
const listeners = new Set();
export const getState = () => state;
export function setState(patch) { state = { ...state, ...patch }; listeners.forEach(fn => fn(state)); return state; }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function resetState() { state = structuredClone(initialState); listeners.forEach(fn => fn(state)); }
