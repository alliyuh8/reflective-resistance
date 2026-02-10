// background.js - Service worker for session management + Arduino
console.log("🟢 Background service worker loaded - VERSION 2.1");

const ARDUINO_SERVER_URL = "http://localhost:3000/update";

// Track Arduino enabled state
let arduinoEnabled = true;

// Load Arduino state from storage on startup
chrome.storage.local.get(['arduinoEnabled'], (result) => {
  arduinoEnabled = result.arduinoEnabled !== undefined ? result.arduinoEnabled : true;
  console.log('Arduino enabled state loaded:', arduinoEnabled);
});

// Listen for storage changes to update state
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.arduinoEnabled) {
    arduinoEnabled = changes.arduinoEnabled.newValue;
    console.log('Arduino enabled state updated:', arduinoEnabled);
    
    // If Arduino was disabled, send stop command immediately
    if (!arduinoEnabled) {
      console.log('🛑 Arduino disabled - sending stop command');
      sendArduinoUpdate(0, 0, true); // Force send stop command
    }
  }
});

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
    
    // Check if Arduino is enabled
    if (!arduinoEnabled) {
      console.log('⚠️ Arduino disabled - ignoring update');
      sendResponse({ success: false, error: 'Arduino communication disabled' });
      return true;
    }
    
    console.log(`📡 Sending to Arduino: ${Math.round(resistance)}% resistance (${tokens} tokens)`);

    sendArduinoUpdate(tokens, resistance, false, sendResponse);
    return true; // Keep channel open for async response
  }

  return true;
});

// Separate function to handle Arduino updates
function sendArduinoUpdate(tokens, resistance, forceStop = false, sendResponse = null) {
  const resistanceValue = forceStop ? 0 : Math.round(resistance);
  
  // Save to storage for popup display
  chrome.storage.local.set({
    lastTokens: tokens,
    lastResistance: resistanceValue,
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
      resistance: resistanceValue,
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
    if (sendResponse) {
      sendResponse({ success: true, data });
    }
  })
  .catch(error => {
    console.error('❌ Arduino update failed:', error.message);
    if (sendResponse) {
      sendResponse({ success: false, error: error.message });
    }
  });
}