console.log("🔥 ChatGPT Energy Tracker Extension loaded");

// Session tracking state
let sessionActive = false;
let sessionData = {
  startTime: null,
  firstQueryTime: null,
  queries: [],
  totalTokens: 0,
  cumulativeEnergy: 0
};

// Energy conversion constants (based on typical LLM energy usage)
const ENERGY_PER_TOKEN = 0.0003; // Wh per token (approximate for GPT-4)
const SMARTPHONE_CHARGE = 15; // Wh
const GOOGLE_SEARCH = 0.0003; // Wh
const LED_HOUR = 10; // Wh

// Token estimation (rough approximation: ~4 chars per token)
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// Calculate energy metrics
function calculateEnergyMetrics(tokens) {
  const energyWh = tokens * ENERGY_PER_TOKEN;
  return {
    tokens,
    energyWh,
    smartphoneCharges: (energyWh / SMARTPHONE_CHARGE).toFixed(4),
    googleSearches: Math.round(energyWh / GOOGLE_SEARCH),
    ledHours: (energyWh / LED_HOUR).toFixed(4)
  };
}

// Create overlay UI
function createOverlay() {
  if (document.getElementById('energy-overlay')) return;
  
  const overlay = document.createElement('div');
  overlay.id = 'energy-overlay';
  overlay.className = 'energy-overlay';
  overlay.innerHTML = `
    <div class="energy-header">
      <span class="energy-title">⚡ Energy Impact</span>
      <button id="close-overlay" class="close-btn">×</button>
    </div>
    <div class="energy-content">
      <div class="energy-stat">
        <span class="stat-value" id="tokens-value">0</span>
        <span class="stat-label">tokens this query</span>
      </div>
      <div class="energy-divider"></div>
      <div class="energy-stat cumulative">
        <span class="stat-value" id="cumulative-tokens">0</span>
        <span class="stat-label">total tokens</span>
      </div>
      <div class="equivalents">
        <div class="equiv-item">
          📱 <span id="smartphone-equiv">0</span> smartphone charges
        </div>
        <div class="equiv-item">
          🔍 <span id="search-equiv">0</span> Google searches
        </div>
        <div class="equiv-item">
          💡 <span id="led-equiv">0</span> hours of LED light
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Close button
  document.getElementById('close-overlay').addEventListener('click', () => {
    overlay.style.display = 'none';
  });
}

// Update overlay with new data
function updateOverlay(metrics, cumulative = false) {
  const overlay = document.getElementById('energy-overlay');
  if (!overlay) return;
  
  overlay.style.display = 'block';
  
  // Flash animation
  overlay.classList.add('flash');
  setTimeout(() => overlay.classList.remove('flash'), 500);
  
  // Update values
  document.getElementById('tokens-value').textContent = metrics.tokens.toLocaleString();
  
  if (cumulative) {
    document.getElementById('cumulative-tokens').textContent = sessionData.totalTokens.toLocaleString();
    const cumulativeMetrics = calculateEnergyMetrics(sessionData.totalTokens);
    document.getElementById('smartphone-equiv').textContent = cumulativeMetrics.smartphoneCharges;
    document.getElementById('search-equiv').textContent = cumulativeMetrics.googleSearches.toLocaleString();
    document.getElementById('led-equiv').textContent = cumulativeMetrics.ledHours;
  }
}

// Send token data to Arduino via background script
function sendToArduino(tokens) {
  // PWM value (0-255) based on tokens
  // Scale: 0-1000 tokens = 0-255 PWM
  const pwmValue = Math.min(Math.round((tokens / 1000) * 255), 255);
  
  chrome.runtime.sendMessage({
    type: 'ARDUINO_UPDATE',
    tokens,
    pwmValue
  });
}

// Track query
function trackQuery(promptText, responseText = "") {
  if (!sessionActive) return;
  
  const promptTokens = estimateTokens(promptText);
  const responseTokens = estimateTokens(responseText);
  const totalTokens = promptTokens + responseTokens;
  
  const queryData = {
    timestamp: Date.now(),
    promptText,
    promptLength: promptText.length,
    tokens: totalTokens,
    depth: sessionData.queries.length + 1
  };
  
  // First query tracking
  if (!sessionData.firstQueryTime) {
    sessionData.firstQueryTime = Date.now();
    queryData.timeToFirstQuery = sessionData.firstQueryTime - sessionData.startTime;
  }
  
  sessionData.queries.push(queryData);
  sessionData.totalTokens += totalTokens;
  
  // Update UI
  const metrics = calculateEnergyMetrics(totalTokens);
  updateOverlay(metrics, true);
  
  // Send to Arduino
  sendToArduino(totalTokens);
  
  // Save to storage
  chrome.storage.local.set({ sessionData });
  
  console.log('📊 Query tracked:', queryData);
}

// Store the last prompt text before it gets cleared
let lastPromptText = "";

// Handle prompt submission
function handleSubmit(promptText, source) {
  console.log(`🚀 Prompt submitted via ${source}! Session active:`, sessionActive, "Prompt:", promptText.substring(0, 50) + "...");
  
  if (!promptText || !sessionActive) {
    console.log("⚠️ Not tracking - session active:", sessionActive, "has text:", !!promptText);
    return;
  }
  
  // Track immediately with prompt tokens
  trackQuery(promptText);
  
  // Try to capture response (observer for new messages)
  observeResponse();
}

// Attach listener to send button and textarea
function attachListener() {
  const textarea = document.querySelector("textarea");
  const sendButton = document.querySelector('#composer-submit-button') || 
                     document.querySelector('button[data-testid="send-button"]') ||
                     document.querySelector('button[aria-label="Send prompt"]');
  
  if (!textarea) {
    return;
  }
  
  // Track text changes to capture prompt before it's cleared
  if (!textarea.dataset.inputListenerAttached) {
    textarea.dataset.inputListenerAttached = "true";
    
    textarea.addEventListener("input", () => {
      lastPromptText = textarea.value;
    });
  }
  
  // Attach Enter key listener to textarea
  if (!textarea.dataset.listenerAttached) {
    textarea.dataset.listenerAttached = "true";
    console.log("✅ Textarea listener attached");
    
    textarea.addEventListener("keydown", (e) => {
      // Enter without Shift (Shift+Enter is for new line)
      if (e.key === "Enter" && !e.shiftKey) {
        const promptText = textarea.value.trim() || lastPromptText.trim();
        if (promptText) {
          console.log("⌨️ Enter key pressed, prompt:", promptText.substring(0, 30));
          handleSubmit(promptText, "Enter key");
        }
      }
    });
  }
  
  // Attach button click listener
  if (!sendButton) {
    return;
  }
  
  if (sendButton.dataset.listenerAttached === "true") {
    return;
  }
  
  sendButton.dataset.listenerAttached = "true";
  console.log("✅ Send button listener attached to:", sendButton.id || sendButton.className);
  
  sendButton.addEventListener("click", () => {
    const promptText = textarea.value.trim() || lastPromptText.trim();
    console.log("🖱️ Button clicked, prompt:", promptText.substring(0, 30));
    
    if (promptText) {
      handleSubmit(promptText, "button click");
    }
  });
}

// Observe for ChatGPT responses
function observeResponse() {
  const targetNode = document.querySelector('main') || document.body;
  
  const observer = new MutationObserver((mutations) => {
    // Look for assistant responses
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      const responseText = latestMessage.textContent || "";
      
      // Update last query with response tokens
      if (sessionData.queries.length > 0) {
        const lastQuery = sessionData.queries[sessionData.queries.length - 1];
        const responseTokens = estimateTokens(responseText);
        
        if (!lastQuery.responseTokens) {
          lastQuery.responseTokens = responseTokens;
          lastQuery.tokens += responseTokens;
          sessionData.totalTokens += responseTokens;
          
          const metrics = calculateEnergyMetrics(lastQuery.tokens);
          updateOverlay(metrics, true);
          sendToArduino(lastQuery.tokens);
          
          chrome.storage.local.set({ sessionData });
        }
      }
    }
  });
  
  observer.observe(targetNode, {
    childList: true,
    subtree: true
  });
  
  // Disconnect after 30 seconds
  setTimeout(() => observer.disconnect(), 30000);
}

// Listen for session control messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Message received:', message.type);
  
  if (message.type === 'START_SESSION') {
    sessionActive = true;
    sessionData = {
      startTime: Date.now(),
      firstQueryTime: null,
      queries: [],
      totalTokens: 0,
      cumulativeEnergy: 0
    };
    createOverlay();
    console.log("✅ Session started");
    sendResponse({ success: true });
    return true; // Keep channel open
  } 
  else if (message.type === 'END_SESSION') {
    sessionActive = false;
    const completionTime = Date.now() - sessionData.startTime;
    const finalData = {
      ...sessionData,
      completionTime,
      timeToFirstQuery: sessionData.firstQueryTime ? 
        sessionData.firstQueryTime - sessionData.startTime : null
    };
    
    console.log("📊 Session ended:", finalData);
    sendResponse({ success: true, data: finalData });
    return true; // Keep channel open
  }
  else if (message.type === 'GET_SESSION_DATA') {
    sendResponse({ data: sessionData, active: sessionActive });
    return true; // Keep channel open
  }
  
  return true; // Keep message channel open
});

// Watch for DOM changes to reattach listeners
const pageObserver = new MutationObserver(attachListener);
pageObserver.observe(document.body, {
  childList: true,
  subtree: true
});

// Initial attachment
attachListener();

// Load existing session if any
chrome.storage.local.get(['sessionData'], (result) => {
  if (result.sessionData && result.sessionData.startTime) {
    console.log("📂 Loaded existing session data");
  }
});