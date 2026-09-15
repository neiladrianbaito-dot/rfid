export function formatAmount(type: string, amount: number | string): string { const sign=type==="Fare"?"-":"+"; const num=Math.abs(Number(amount||0)).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); return `${sign}₱${num}`; }
export function getInitials(name:string):string{return name.split(" ").filter(Boolean).slice(0,2).map(n=>n[0].toUpperCase()).join("");}
export function isValidEmail(value:string):boolean{return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
export function normalizeApiBaseUrl(rawUrl?:string|null):string{const trimmed=(rawUrl||"").trim().replace(/\/+$/g,"");if(!trimmed)return "";return trimmed.endsWith("/api")?trimmed.slice(0,-4):trimmed;}
export function formatPeso(value:number|string):string{return `₱${Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
export function formatCardDate(value:string|null|undefined):string{if(!value)return "N/A";const date=new Date(value);if(Number.isNaN(date.getTime()))return "N/A";return date.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});}
