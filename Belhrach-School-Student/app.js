
const API = (window.APP_CONFIG?.API_BASE || "").replace(/\/$/, "");

const $ = (id) => document.getElementById(id);

const form = $("requestForm");

let token = localStorage.getItem("bs_request_token");
let requestStatus = null;
let webauthnBrowser = null;

// ==========================================
// WEBAUTHN LIBRARY
// ==========================================

async function getWebAuthnBrowser() {
  if (!window.PublicKeyCredential) {
    throw new Error(
      "جهازك أو متصفحك لا يدعم التحقق عبر WebAuthn."
    );
  }

  if (!webauthnBrowser) {
    webauthnBrowser = await import(
      "https://esm.sh/@simplewebauthn/browser@13"
    );
  }

  return webauthnBrowser;
}

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
        ? "تم إنشاء حسابك بنجاح. يمكنك الآن ربط جهازك لتسجيل الحضور."
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

  const registerBtn = $("registerDeviceBtn");

  if (registerBtn) {
    registerBtn.hidden = !(
      status === "approved" && setupAvailable
    );
  }

  requestStatus = status;
}

// ==========================================
// API HELPER
// ==========================================

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Authorization": `Bearer ${token}`
    },
    cache: "no-store"
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("استجابة غير صالحة من الخادم.");
  }

  if (!response.ok) {
    throw new Error(
      data.error || "حدث خطأ أثناء الاتصال بالخادم."
    );
  }

  return data;
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
    const data = await apiRequest(
      "/api/student/status",
      {
        method: "GET"
      }
    );

    if (
      !["pending", "approved", "rejected"].includes(data.status)
    ) {
      throw new Error("حالة الطلب غير معروفة.");
    }

    showStatus(
      data.status,
      data.setupAvailable === true
    );

  } catch (error) {
    console.error("Status check error:", error);

    if (
      error.message.includes("غير صالح") ||
      error.message.includes("غير موجود")
    ) {
      localStorage.removeItem("bs_request_token");
      token = null;

      $("statusView").hidden = true;
      $("formView").hidden = false;

      $("message").textContent =
        "تعذر العثور على طلبك. يرجى إرسال طلب جديد.";

      return;
    }

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
// REGISTER STUDENT DEVICE
// ==========================================

async function registerDevice() {
  const registerBtn = $("registerDeviceBtn");
  const message = $("statusMessage");

  if (!token || !API) {
    message.textContent = "تعذر العثور على بيانات حسابك.";
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = "جارٍ تجهيز التحقق...";

  message.textContent = "";

  try {
    const { startRegistration } = await getWebAuthnBrowser();

    // STEP 1: GET REGISTRATION OPTIONS

    registerBtn.textContent = "يرجى الانتظار...";

    const optionsData = await apiRequest(
      "/api/student/webauthn/register/options",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      }
    );

    if (!optionsData.options || !optionsData.challengeId) {
      throw new Error("لم يتم استلام بيانات تسجيل الجهاز.");
    }

    // STEP 2: ASK THE DEVICE TO CREATE A CREDENTIAL

    registerBtn.textContent = "تحقق من هويتك على الجهاز...";

    const registrationResponse = await startRegistration({
      optionsJSON: optionsData.options
    });

    // STEP 3: VERIFY REGISTRATION ON THE SERVER

    registerBtn.textContent = "جارٍ حفظ الجهاز...";

    const result = await apiRequest(
      "/api/student/webauthn/register/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          challengeId: optionsData.challengeId,
          response: registrationResponse,
          deviceName: navigator.userAgent.slice(0, 100)
        })
      }
    );

    if (!result.ok || !result.registered) {
      throw new Error(
        result.message || "لم يكتمل تسجيل الجهاز."
      );
    }

    message.textContent =
      "تم ربط جهازك بنجاح! يمكنك الآن متابعة إعداد حسابك.";

    registerBtn.textContent = "تم ربط الجهاز بنجاح";
    registerBtn.disabled = true;

  } catch (error) {
    console.error("Device registration error:", error);

    if (error.name === "NotAllowedError") {
      message.textContent =
        "تم إلغاء عملية التحقق أو انتهت مهلة الانتظار. يمكنك المحاولة مجدداً.";

    } else if (error.name === "InvalidStateError") {
      message.textContent =
        "قد يكون الجهاز مسجلاً مسبقاً. يرجى التواصل مع الإدارة.";

    } else {
      message.textContent =
        error.message || "حدث خطأ أثناء ربط الجهاز.";
    }

    registerBtn.disabled = false;
    registerBtn.textContent = "ربط هذا الجهاز";
  }
}

// ==========================================
// BUTTON EVENTS
// ==========================================

$("refreshBtn").addEventListener("click", checkStatus);

const registerDeviceBtn = $("registerDeviceBtn");

if (registerDeviceBtn) {
  registerDeviceBtn.addEventListener("click", registerDevice);
}

// ==========================================
// INITIALIZATION
// ==========================================

if (token) {
  showStatus("pending");
  checkStatus();
}
