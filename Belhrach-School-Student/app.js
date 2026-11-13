
const API = (window.APP_CONFIG?.API_BASE || "").replace(/\/$/, "");

const $ = (id) => document.getElementById(id);

const form = $("requestForm");

let token = localStorage.getItem("bs_request_token");
let requestStatus = null;

// ==========================================
// STATUS DISPLAY
// ==========================================

function showStatus(status, setupAvailable = false) {
  $("formView").hidden = true;
  $("statusView").hidden = false;

  const states = {
    pending: [
      "طلبك قيد المراجعة",
      "تم استلام طلبك بنجاح. انتظر قرار الإدارة."
    ],

    approved: [
      "تم قبول طلبك بنجاح",
      setupAvailable
        ? "تم إنشاء حسابك بنجاح. ستتمكن من ربط جهازك والتحقق البيومتري عند إتاحة مرحلة إعداد الحساب."
        : "تمت الموافقة على طلبك. حسابك قيد التجهيز."
    ],

    rejected: [
      "تم رفض طلبك",
      "نعتذر، لم تتم الموافقة على طلب التسجيل. يرجى التواصل مع الإدارة."
    ]
  };

  const [title, desc] = states[status] || states.pending;

  $("statusTitle").textContent = title;
  $("statusText").textContent = desc;

  requestStatus = status;
}

// ==========================================
// CHECK REQUEST STATUS
// ==========================================

async function checkStatus() {
  if (!token || !API || API.includes("YOUR-WORKER")) {
    return;
  }

  const refreshBtn = $("refreshBtn");

  if (refreshBtn) {
    refreshBtn.disabled = true;
  }

  try {
    const response = await fetch(
      `${API}/api/student/status`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`
        },
        cache: "no-store"
      }
    );

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 404 || response.status === 401) {
        localStorage.removeItem("bs_request_token");
        token = null;

        $("statusView").hidden = true;
        $("formView").hidden = false;

        $("message").textContent =
          "تعذر العثور على طلبك. يرجى إرسال طلب جديد.";

        return;
      }

      throw new Error(data.error || "تعذر التحقق من حالة الطلب");
    }

    if (
      !["pending", "approved", "rejected"].includes(data.status)
    ) {
      throw new Error("حالة الطلب غير معروفة");
    }

    showStatus(data.status, data.setupAvailable === true);

  } catch (error) {
    console.error("Status check error:", error);

    if (requestStatus === null) {
      $("message").textContent =
        "تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مجدداً.";
    }

  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
    }
  }
}

// ==========================================
// CREATE STUDENT REQUEST
// ==========================================

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  $("message").textContent = "";

  if (!API || API.includes("YOUR-WORKER")) {
    $("message").textContent =
      "يرجى ضبط رابط السيرفر داخل config.js أولاً.";
    return;
  }

  const submitBtn = $("submitBtn");

  submitBtn.disabled = true;
  submitBtn.textContent = "جارٍ إرسال الطلب...";

  const formData = new FormData(form);

  const payload = {
    firstName: String(formData.get("firstName") || "").trim(),
    lastName: String(formData.get("lastName") || "").trim(),
    className: String(formData.get("className") || "").trim()
  };

  try {
    if (
      !payload.firstName ||
      !payload.lastName ||
      !payload.className
    ) {
      throw new Error("يرجى ملء جميع الحقول.");
    }

    const response = await fetch(
      `${API}/api/student/requests`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "تعذر إرسال الطلب.");
    }

    if (!data.token) {
      throw new Error("لم يستلم الموقع رمز متابعة الطلب.");
    }

    token = data.token;

    localStorage.setItem("bs_request_token", token);

    showStatus(data.status || "pending");

    form.reset();

  } catch (error) {
    console.error("Request error:", error);
    $("message").textContent = error.message;

  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "إرسال طلب التفعيل";
  }
});

// ==========================================
// REFRESH BUTTON
// ==========================================

$("refreshBtn").addEventListener("click", checkStatus);

// ==========================================
// INITIALIZATION
// ==========================================

if (token) {
  showStatus("pending");
  checkStatus();
}
