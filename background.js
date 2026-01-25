// background.js - Combined service worker for session management + Arduino
console.log("🟢 Background service worker loaded");

const ARDUINO_SERVER_URL = "http://localhost:3000/update";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message);
  
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
    console.log(`📡 Sending to Arduino: ${message.tokens} tokens (PWM: ${message.pwmValue})`);
    
    // Save to storage for popup display
    chrome.storage.local.set({
      lastTokens: message.tokens,
      lastPWM: message.pwmValue
    });
    
    // Send data to local server
    fetch(ARDUINO_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tokens: message.tokens,
        pwmValue: message.pwmValue,
        timestamp: Date.now()
      })
    })
    .then(response => response.json())
    .then(data => {
      console.log('✅ Arduino update successful:', data);
      sendResponse({ success: true, data });
    })
    .catch(error => {
      console.error('❌ Arduino update failed:', error);
      // Don't fail silently - but don't break the extension either
      sendResponse({ success: false, error: error.message });
    });
    
    return true; // Keep channel open for async response
  }
  
  return true;
});