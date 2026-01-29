// background.js - Service worker for session management + Arduino
console.log("🟢 Background service worker loaded - VERSION 2.0");

const ARDUINO_SERVER_URL = "http://localhost:3000/update";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message.type);

  // Session management
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

  // Arduino communication
  if (message.type === 'ARDUINO_UPDATE') {
    const { tokens, resistance } = message;
    
    console.log(`📡 Sending to Arduino: ${Math.round(resistance)}% resistance (${tokens} tokens)`);

    // Save to storage for popup display
    chrome.storage.local.set({
      lastTokens: tokens,
      lastResistance: Math.round(resistance),
      lastUpdate: Date.now()
    });

    // Send data to local server
    fetch(ARDUINO_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tokens: tokens,
        resistance: Math.round(resistance),
        timestamp: Date.now()
      })
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('✅ Arduino update successful:', data);
      sendResponse({ success: true, data });
    })
    .catch(error => {
      console.error('❌ Arduino update failed:', error.message);
      sendResponse({ success: false, error: error.message });
    });

    return true; // Keep channel open for async response
  }

  return true;
});