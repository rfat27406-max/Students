
const API = (window.APP_CONFIG?.API_BASE || "").replace(/\/+$/, "");

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
    throw new Error("جهازك أو متصفحك لا يدعم التحقق عبر WebAuthn.");
  }

  if (!webauthnBrowser) {
    webauthnBrowser = await import(
      "https://esm.sh/@simplewebauthn/browser@13"
    );
  }

  return webauthnBrowser;
}

// ==========================================
// API HELPER
// ==========================================

async function apiRequest(path, options = {}) {
  if (!API) {
    throw new Error("رابط السيرفر غير مضبوط في config.js");
  }

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
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
    const error = new Error(
      data.error || "حدث خطأ أثناء الاتصال بالخادم."
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

// ==========================================
// MESSAGE HELPERS
// ==========================================

function showMessage(elementId, message) {
  const element = $(elementId);

  if (element) {
    element.textContent = message || "";
  }
}

function setButtonLoading(button, loading, loadingText, normalText) {
  if (!button) return;

  button.disabled = loading;
  button.textContent = loading ? loadingText : normalText;
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
      "تم إنشاء حسابك. يمكنك ربط جهازك وتسجيل حضورك."
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
  const attendancePanel = $("attendancePanel");

  if (registerBtn) {
    registerBtn.hidden = !(
      status === "approved" && setupAvailable
    );
  }

  if (attendancePanel) {
    attendancePanel.hidden = status !== "approved";
  }

  requestStatus = status;

  if (status === "approved") {
    loadTodayAttendance();
  }
}

// ==========================================
// CHECK REQUEST STATUS
// ==========================================

async function checkStatus() {
  if (!token || !API) return;

  const refreshBtn = $("refreshBtn");

  setButtonLoading(
    refreshBtn,
    true,
    "جارٍ التحديث...",
    "تحديث الحالة"
  );

  try {
    const data = await apiRequest(
      "/api/student/status",
      { method: "GET" }
    );

    if (!["pending", "approved", "rejected"].includes(data.status)) {
      throw new Error("حالة الطلب غير معروفة.");
    }

    showStatus(data.status, data.setupAvailable === true);

  } catch (error) {
    console.error("Status check error:", error);

    if (
      error.status === 404 ||
      error.message.includes("رمز المتابعة غير صالح")
    ) {
      localStorage.removeItem("bs_request_token");
      token = null;

      $("statusView").hidden = true;
      $("formView").hidden = false;

      showMessage(
        "message",
        "تعذر العثور على طلبك. يرجى إرسال طلب جديد."
      );
    } else if (requestStatus === null) {
      showMessage(
        "message",
        "تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً."
      );
    }

  } finally {
    setButtonLoading(
      refreshBtn,
      false,
      "",
      "تحديث الحالة"
    );
  }
}

// ==========================================
// CREATE STUDENT REQUEST
// ==========================================

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  showMessage("message", "");

  if (!API) {
    showMessage(
      "message",
      "يرجى ضبط رابط السيرفر داخل config.js أولاً."
    );
    return;
  }

  const submitBtn = $("submitBtn");

  setButtonLoading(
    submitBtn,
    true,
    "جارٍ إرسال الطلب...",
    "إرسال طلب التفعيل"
  );

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

    const response = await fetch(`${API}/api/student/requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

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
    showMessage("message", error.message);

  } finally {
    setButtonLoading(
      submitBtn,
      false,
      "",
      "إرسال طلب التفعيل"
    );
  }
});

// ==========================================
// REGISTER STUDENT DEVICE
// ==========================================

async function registerDevice() {
  const registerBtn = $("registerDeviceBtn");

  if (!token) {
    showMessage("statusMessage", "تعذر العثور على بيانات حسابك.");
    return;
  }

  showMessage("statusMessage", "");

  setButtonLoading(
    registerBtn,
    true,
    "جارٍ تجهيز التحقق...",
    "ربط هذا الجهاز"
  );

  try {
    const { startRegistration } = await getWebAuthnBrowser();

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

    registerBtn.textContent = "تحقق من هويتك على الجهاز...";

    const registrationResponse = await startRegistration({
      optionsJSON: optionsData.options
    });

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

    showMessage(
      "statusMessage",
      "تم ربط جهازك بنجاح! يمكنك الآن تسجيل حضورك."
    );

    registerBtn.hidden = true;

    $("attendancePanel").hidden = false;

    await loadTodayAttendance();

  } catch (error) {
    console.error("Device registration error:", error);

    if (error.name === "NotAllowedError") {
      showMessage(
        "statusMessage",
        "تم إلغاء عملية التحقق أو انتهت مهلة الانتظار. يمكنك المحاولة مجدداً."
      );
    } else if (error.name === "InvalidStateError") {
      showMessage(
        "statusMessage",
        "قد يكون الجهاز مسجلاً مسبقاً. يمكنك تجربة تسجيل الحضور."
      );
    } else {
      showMessage(
        "statusMessage",
        error.message || "حدث خطأ أثناء ربط الجهاز."
      );
    }

  } finally {
    if (!registerBtn.hidden) {
      setButtonLoading(
        registerBtn,
        false,
        "",
        "ربط هذا الجهاز"
      );
    }
  }
}

// ==========================================
// ATTENDANCE STATUS DISPLAY
// ==========================================

function displayAttendance(data) {
  const labels = {
    present: "حاضر",
    late: "متأخر",
    absent: "غائب",
    not_yet: "لم يحن وقت الغياب",
    not_open: "لم يبدأ وقت تسجيل الحضور"
  };

  const statusElement = $("attendanceStatus");
  const detailsElement = $("attendanceDetails");

  if (!statusElement || !detailsElement) return;

  statusElement.textContent =
    labels[data.status] || "حالة الحضور غير معروفة";

  if (data.attendance) {
    const time = data.time || "";
    const checkInAt = data.attendance.checkInAt;

    let recordedTime = "";

    if (checkInAt) {
      recordedTime = new Date(checkInAt).toLocaleTimeString(
        "ar-DZ",
        {
          timeZone: data.timezone || "Africa/Algiers",
          hour: "2-digit",
          minute: "2-digit"
        }
      );
    }

    detailsElement.textContent = recordedTime
      ? `وقت تسجيل حضورك: ${recordedTime}`
      : `تاريخ اليوم: ${data.date || ""}`;

  } else {
    detailsElement.textContent =
      `تاريخ اليوم: ${data.date || ""} — الوقت الحالي: ${data.time || ""}`;
  }

  const attendanceBtn = $("attendanceBtn");

  if (attendanceBtn) {
    const alreadyRecorded = ["present", "late"].includes(data.status);

    attendanceBtn.hidden = alreadyRecorded;
    attendanceBtn.disabled = alreadyRecorded;
    attendanceBtn.textContent = alreadyRecorded
      ? "تم تسجيل حضورك اليوم"
      : "تسجيل الحضور";
  }
}

// ==========================================
// LOAD TODAY ATTENDANCE
// ==========================================

async function loadTodayAttendance() {
  if (!token || requestStatus !== "approved") return;

  const refreshAttendanceBtn = $("refreshAttendanceBtn");

  if (refreshAttendanceBtn) {
    refreshAttendanceBtn.disabled = true;
    refreshAttendanceBtn.textContent = "جارٍ التحديث...";
  }

  try {
    const data = await apiRequest(
      "/api/student/attendance/today",
      { method: "GET" }
    );

    displayAttendance(data);

  } catch (error) {
    console.error("Attendance status error:", error);

    showMessage(
      "attendanceMessage",
      error.message || "تعذر تحميل حالة الحضور."
    );

  } finally {
    if (refreshAttendanceBtn) {
      refreshAttendanceBtn.disabled = false;
      refreshAttendanceBtn.textContent = "تحديث الحضور";
    }
  }
}

// ==========================================
// RECORD ATTENDANCE WITH WEBAUTHN
// ==========================================

async function recordAttendance() {
  const attendanceBtn = $("attendanceBtn");

  if (!token) {
    showMessage("attendanceMessage", "تعذر العثور على حسابك.");
    return;
  }

  showMessage("attendanceMessage", "");

  setButtonLoading(
    attendanceBtn,
    true,
    "جارٍ تجهيز التحقق...",
    "تسجيل الحضور"
  );

  try {
    const { startAuthentication } = await getWebAuthnBrowser();

    // STEP 1: REQUEST AUTHENTICATION OPTIONS

    const optionsData = await apiRequest(
      "/api/student/webauthn/attendance/options",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      }
    );

    if (!optionsData.options || !optionsData.challengeId) {
      throw new Error("لم يتم استلام بيانات التحقق من الخادم.");
    }

    // STEP 2: VERIFY THE STUDENT ON THEIR DEVICE

    attendanceBtn.textContent = "تحقق من هويتك على الجهاز...";

    const authenticationResponse = await startAuthentication({
      optionsJSON: optionsData.options
    });

    // STEP 3: SEND AUTHENTICATION TO SERVER

    attendanceBtn.textContent = "جارٍ تسجيل حضورك...";

    const result = await apiRequest(
      "/api/student/webauthn/attendance/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          challengeId: optionsData.challengeId,
          response: authenticationResponse
        })
      }
    );

    if (!result.ok || !result.recorded) {
      throw new Error("لم يتم تأكيد تسجيل الحضور.");
    }

    displayAttendance({
      status: result.attendance.status,
      date: result.attendance.date,
      time: result.attendance.time,
      timezone: result.attendance.timezone,
      attendance: {
        checkInAt: Date.now()
      }
    });

    showMessage(
      "attendanceMessage",
      result.message || "تم تسجيل حضورك بنجاح."
    );

  } catch (error) {
    console.error("Attendance error:", error);

    if (error.name === "NotAllowedError") {
      showMessage(
        "attendanceMessage",
        "تم إلغاء التحقق أو انتهت مهلة الانتظار. حاول مجدداً."
      );
    } else {
      showMessage(
        "attendanceMessage",
        error.message || "تعذر تسجيل الحضور."
      );
    }

    // Refresh status in case the attendance was already recorded.
    await loadTodayAttendance();

  } finally {
    if (attendanceBtn && !attendanceBtn.hidden) {
      setButtonLoading(
        attendanceBtn,
        false,
        "",
        "تسجيل الحضور"
      );
    }
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

const attendanceBtn = $("attendanceBtn");

if (attendanceBtn) {
  attendanceBtn.addEventListener("click", recordAttendance);
}

const refreshAttendanceBtn = $("refreshAttendanceBtn");

if (refreshAttendanceBtn) {
  refreshAttendanceBtn.addEventListener(
    "click",
    loadTodayAttendance
  );
}

// ==========================================
// INITIALIZATION
// ==========================================

if (token) {
  showStatus("pending");
  checkStatus();
}
