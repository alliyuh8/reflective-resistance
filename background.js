console.log("🟢 Background service worker loaded");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message);

  if (message.type === "START_SESSION") {
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "END_SESSION") {
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "GET_SESSION_DATA") {
    sendResponse({ data: null, active: false });
    return true;
  }
});
