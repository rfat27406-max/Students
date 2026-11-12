const API = (window.APP_CONFIG?.API_BASE || "").replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
const form = $("requestForm");
let token = localStorage.getItem("bs_request_token");

function showStatus(status) {
  $("formView").hidden = true; $("statusView").hidden = false;
  const states = {
    pending: ["طلبك قيد المراجعة", "تم استلام طلبك بنجاح. انتظر قرار الإدارة."],
    approved: ["تم قبول طلبك", "تم تفعيل طلبك. ستُضاف مساحة التلميذ في مرحلة لاحقة."],
    rejected: ["تم رفض طلبك", "نعتذر، لم تتم الموافقة على طلب التفعيل. يرجى التواصل مع الإدارة."]
  };
  const [title, desc] = states[status] || states.pending;
  $("statusTitle").textContent = title; $("statusText").textContent = desc;
}
async function checkStatus() {
  if (!token || !API || API.includes("YOUR-WORKER")) return;
  try {
    const r = await fetch(`${API}/api/student/status`, {headers: {"Authorization": `Bearer ${token}`}});
    if (r.ok) { const data = await r.json(); showStatus(data.status); }
  } catch (_) {}
}
form.addEventListener("submit", async (e) => {
  e.preventDefault(); $("message").textContent = "";
  if (!API || API.includes("YOUR-WORKER")) { $("message").textContent = "يرجى ضبط رابط السيرفر داخل config.js أولاً."; return; }
  const btn = $("submitBtn"); btn.disabled = true; btn.textContent = "جارٍ الإرسال...";
  const payload = Object.fromEntries(new FormData(form));
  try {
    const r = await fetch(`${API}/api/student/requests`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "تعذر إرسال الطلب");
    token = data.token; localStorage.setItem("bs_request_token", token); showStatus("pending");
  } catch (err) { $("message").textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = "إرسال طلب التفعيل"; }
});
$("refreshBtn").addEventListener("click", checkStatus);
if (token) { showStatus("pending"); checkStatus(); }
