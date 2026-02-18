console.log("🔥 ChatGPT Energy Tracker Extension loaded (GPT-5 optimized) - VERSION 2.2");

// Session tracking state
let sessionActive = false;
let sessionData = {
  startTime: null,
  firstQueryTime: null,
  queries: [],
  totalTokens: 0,
  cumulativeEnergy: 0
};

// Track which responses we've already counted
let activeQueryTokens = 0;

// Resistance tracking
let resistanceLevel = 0; // 0-100%
let decayInterval = null;
let lastDecayTime = null;

// Timer tracking
let timerInterval = null;

// Arduino enabled state
let arduinoEnabled = true;

// Resistance calculation: simple percentage based on tokens
// 100 tokens = 10%, 500 tokens = 50%, 1000 tokens = 100%
const TOKENS_FOR_MAX_RESISTANCE = 90;

// Decay rate: lose 1% every 15 seconds (but check more frequently)
const DECAY_RATE = 1.25; // % per interval
const DECAY_INTERVAL = 5000; // 5 seconds in ms
const DECAY_UPDATE_INTERVAL = 1000; // Send updates every 1 second

// Image generation scaling factor
const IMAGE_GENERATION_MULTIPLIER = 2.907;

// GPT-5 Energy conversion constants (updated estimates)
const ENERGY_PER_TOKEN = 0.004; // Wh per token (estimated for GPT-5, higher than GPT-4)
const SMARTPHONE_CHARGE = 15; // Wh
const GOOGLE_SEARCH = 0.3; // Wh
const LED_MINUTE = 0.1667; // Wh

// GPT-5 pricing mapping (credits per 1K tokens)
const enginesCreditsMapping = {
  'gpt-5': 0.15,
  'gpt-5-turbo': 0.10,
  'gpt-4': 0.06,
  'gpt-4-turbo': 0.03,
  'gpt-3.5-turbo': 0.002
};

const freeEngines = ['gpt-3.5-turbo-free'];
const maxTokenSize = 128000;
const pageLoadWaitIntervals = 1000;

// Variable to store captured prompt text
let capturedPromptText = "";

// Track current query index for image detection
let currentQueryIndex = -1;

// Load Arduino enabled state from storage
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get(['arduinoEnabled'], (result) => {
    arduinoEnabled = result.arduinoEnabled !== undefined ? result.arduinoEnabled : true;
    console.log('Content script: Arduino enabled state loaded:', arduinoEnabled);
  });
  
  // Listen for changes to Arduino enabled state
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.arduinoEnabled) {
      arduinoEnabled = changes.arduinoEnabled.newValue;
      console.log('Content script: Arduino enabled state updated:', arduinoEnabled);
      
      // If Arduino was disabled, send stop command
      if (!arduinoEnabled) {
        console.log('🛑 Arduino disabled - sending stop command');
        sendResistanceToArduino(0, 0, true); // Force send stop
      }
    }
  });
}

function getPromptText() {
  const textarea = document.querySelector("textarea");
  if (textarea && textarea.value.trim()) return textarea.value.trim();

  const editable = document.querySelector('[contenteditable="true"]');
  if (editable && editable.textContent.trim()) return editable.textContent.trim();

  const promptArea = document.querySelector('div[data-contents=true]');
  if (promptArea && promptArea.textContent.trim()) return promptArea.textContent.trim();

  return "";
}

function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  const tokens = Math.ceil(trimmed.length / 4);
  
  console.log(`Token estimation - Chars: ${trimmed.length}, Tokens: ${tokens}`);
  
  return tokens;
}

function calculateEnergyMetrics(tokens) {
  const energyWh = tokens * ENERGY_PER_TOKEN;
  return {
    tokens,
    energyWh,
    smartphoneCharges: (energyWh / SMARTPHONE_CHARGE).toFixed(4),
    googleSearches: Math.round(energyWh / GOOGLE_SEARCH),
    ledMinutes: (energyWh / LED_MINUTE).toFixed(2)
  };
}

function formatDuration(ms) {
  if (!ms) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function updateTimer() {
  if (!sessionActive || !sessionData.startTime) return;
  
  const elapsed = Date.now() - sessionData.startTime;
  const timerElem = document.getElementById('session-timer');
  if (timerElem) {
    timerElem.textContent = formatDuration(elapsed);
  }
}

function startTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer(); // Update immediately
  console.log("⏱️ Timer started");
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
    console.log("⏱️ Timer stopped");
  }
}

function createOverlay() {
  if (document.getElementById('energy-overlay')) {
    console.log("⚠️ Overlay already exists");
    return;
  }
  
  console.log("🎨 Creating overlay...");
  
  const overlay = document.createElement('div');
  overlay.id = 'energy-overlay';
  overlay.className = 'energy-overlay';
  overlay.innerHTML = `
    <div class="energy-header">
      <span class="energy-title">🌱 Energy Impact</span>
      <button id="close-overlay" class="close-btn">×</button>
    </div>
    <div class="energy-content">
      <div class="timer-section">
        <div class="timer-display">
          <span class="timer-icon">⏱️</span>
          <span class="timer-label">Session Time:</span>
          <span class="timer-value" id="session-timer">0s</span>
        </div>
      </div>
      <div class="resistance-section">
        <div class="resistance-header">
          <span class="resistance-label">Resistance Level</span>
          <span class="resistance-value" id="resistance-percent">0%</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" id="progress-fill" style="width: 0%"></div>
          <div class="progress-bar-markers">
            <div class="progress-marker" style="left: 0%" data-label="0%"></div>
            <div class="progress-marker" style="left: 20%" data-label="20%"></div>
            <div class="progress-marker" style="left: 50%" data-label="50%"></div>
            <div class="progress-marker" style="left: 75%" data-label="75%"></div>
            <div class="progress-marker" style="left: 100%" data-label="100%"></div>
          </div>
        </div>
        <div class="resistance-status" id="resistance-status">No resistance</div>
      </div>
      <div class="equivalents">
        <div class="equiv-item">
          📱 <span id="smartphone-equiv">0</span> iPhone charges
        </div>
        <div class="equiv-item">
          🔍 <span id="search-equiv">0</span> Google searches
        </div>
        <div class="equiv-item">
          💡 <span id="led-equiv">0</span> minutes of LED light
        </div>
        <div class="equiv-item">
          💰 Energy cost: $<span id="cost-value">0.00</span>
        </div>
      </div>
      <div class="energy-stat">
        <span class="stat-label"><span class="stat-value" id="tokens-value">0</span> tokens this query</span>
      </div>
      <div class="energy-divider"></div>
      <div class="energy-stat cumulative">
        <span class="stat-label"><span class="stat-value" id="cumulative-tokens">0</span> total tokens</span>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  console.log("✅ Overlay created and appended to body");
  
  const checkElems = {
    'resistance-percent': document.getElementById('resistance-percent'),
    'progress-fill': document.getElementById('progress-fill'),
    'resistance-status': document.getElementById('resistance-status'),
    'session-timer': document.getElementById('session-timer')
  };
  
  console.log("🔍 Overlay elements check:", checkElems);
  
  document.getElementById('close-overlay').addEventListener('click', () => {
    overlay.style.display = 'none';
  });
}

function calculateResistanceIncrease(tokens) {
  return (tokens / TOKENS_FOR_MAX_RESISTANCE) * 100;
}

function getResistanceLabel(percent) {
  if (percent >= 75) return "Maximum resistance";
  if (percent >= 50) return "Significant resistance";
  if (percent >= 20) return "Medium resistance";
  if (percent >= 10) return "Slight resistance";
  return "No resistance";
}

function updateResistanceBar() {
  const percentElem = document.getElementById('resistance-percent');
  const fillElem = document.getElementById('progress-fill');
  const statusElem = document.getElementById('resistance-status');
  
  if (!percentElem || !fillElem || !statusElem) {
    console.error("❌ Resistance bar elements not found!");
    return;
  }
  
  const roundedLevel = Math.round(resistanceLevel);
  const label = getResistanceLabel(resistanceLevel);
  
  percentElem.textContent = `${roundedLevel}%`;
  fillElem.style.width = `${resistanceLevel}%`;
  statusElem.textContent = label;
}

function addResistance(tokens) {
  const increase = calculateResistanceIncrease(tokens);
  const oldLevel = resistanceLevel;
  
  resistanceLevel = Math.min(100, resistanceLevel + increase);
  
  console.log(`📈 Resistance increased: ${Math.round(oldLevel)}% → ${Math.round(resistanceLevel)}% (+${tokens} tokens)`);
  
  updateResistanceBar();
  sendResistanceToArduino(resistanceLevel, tokens);
  
  if (sessionActive && !lastDecayTime) {
    lastDecayTime = Date.now();
  }
}

function startResistanceDecay() {
  if (decayInterval) clearInterval(decayInterval);
  
  console.log(`⏱️ Starting resistance decay (${DECAY_RATE}% every ${DECAY_INTERVAL / 1000} seconds)`);
  
  lastDecayTime = Date.now();
  let decayCounter = 0;
  
  decayInterval = setInterval(() => {
    if (!sessionActive) return;
    
    decayCounter += DECAY_UPDATE_INTERVAL;
    
    if (decayCounter >= DECAY_INTERVAL && resistanceLevel > 0) {
      const oldLevel = resistanceLevel;
      resistanceLevel = Math.max(0, resistanceLevel - DECAY_RATE);
      
      console.log(`📉 Resistance decayed: ${Math.round(oldLevel)}% → ${Math.round(resistanceLevel)}%`);
      
      decayCounter = 0;
      lastDecayTime = Date.now();
    }
    
    if (resistanceLevel >= 0) {
      updateResistanceBar();
      sendResistanceToArduino(resistanceLevel, sessionData.totalTokens);
    }
    
  }, DECAY_UPDATE_INTERVAL);
}

function sendResistanceToArduino(resistance, tokens, forceStop = false) {
  // Check if Arduino is enabled (unless it's a force stop command)
  if (!arduinoEnabled && !forceStop) {
    return; // Don't send if Arduino is disabled
  }
  
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({
      type: 'ARDUINO_UPDATE',
      resistance: Math.round(resistance),
      tokens: tokens
    }, response => {
      if (chrome.runtime.lastError) {
        console.warn('⚠️ Arduino communication error:', chrome.runtime.lastError.message);
      }
    });
  }
}

function stopResistanceDecay() {
  if (decayInterval) {
    clearInterval(decayInterval);
    decayInterval = null;
    lastDecayTime = null;
    console.log("⏹️ Resistance decay stopped");
  }
}

function updateOverlay(metrics, cumulative = false, engineName = 'gpt-5') {
  const overlay = document.getElementById('energy-overlay');
  if (!overlay) return;
  
  overlay.style.display = 'block';
  
  if (typeof metrics.tokens === 'number') {
    document.getElementById('tokens-value').textContent = metrics.tokens.toLocaleString();
  }
  
  if (cumulative) {
    document.getElementById('cumulative-tokens').textContent = sessionData.totalTokens.toLocaleString();
    const cumulativeMetrics = calculateEnergyMetrics(sessionData.totalTokens);
    document.getElementById('smartphone-equiv').textContent = cumulativeMetrics.smartphoneCharges;
    document.getElementById('search-equiv').textContent = cumulativeMetrics.googleSearches.toLocaleString();
    document.getElementById('led-equiv').textContent = cumulativeMetrics.ledMinutes;
    
    const tokenCosts = (enginesCreditsMapping[engineName] || enginesCreditsMapping['gpt-5']) / 1000;
    const totalCost = (sessionData.totalTokens * tokenCosts).toFixed(3);
    document.getElementById('cost-value').textContent = totalCost;
  }
}

function applyImageScaling(queryIndex) {
  if (queryIndex < 0 || queryIndex >= sessionData.queries.length) {
    console.warn(`⚠️ Invalid query index for image scaling: ${queryIndex}`);
    return;
  }
  
  const query = sessionData.queries[queryIndex];
  
  // Check if scaling already applied
  if (query.imageScalingApplied) {
    console.log(`⚠️ Image scaling already applied to query ${queryIndex}`);
    return;
  }
  
  const originalTokens = query.promptTokens;
  const scaledTokens = Math.round(originalTokens * IMAGE_GENERATION_MULTIPLIER);
  const additionalTokens = scaledTokens - originalTokens;
  
  console.log(`🖼️ Image detected! Scaling query ${queryIndex} tokens: ${originalTokens} → ${scaledTokens} (×${IMAGE_GENERATION_MULTIPLIER})`);
  
  // Update query data
  query.promptTokens = scaledTokens;
  query.tokens = scaledTokens;
  query.imageGenerated = true;
  query.imageScalingApplied = true;
  query.originalPromptTokens = originalTokens;
  
  // Update session totals
  sessionData.totalTokens += additionalTokens;
  
  // Add resistance for the additional tokens
  addResistance(additionalTokens);
  
  // Update overlay
  updateOverlay({ tokens: scaledTokens }, true, query.engineName);
  
  // Save to storage
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.set({ sessionData });
  }
  
  console.log(`✅ Image scaling applied. Total tokens now: ${sessionData.totalTokens}`);
}

function detectImageGeneration() {
  // Monitor for image generation in ChatGPT responses
  const imageObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check for DALL-E image containers or generated images
          const imageContainers = node.querySelectorAll ? 
            node.querySelectorAll('img[src*="dalle"], img[alt*="generated"], .dalle-image, [data-message-author-role="assistant"] img') : [];
          
          // Also check if the node itself is an image
          if (node.tagName === 'IMG' && (
            node.src.includes('dalle') || 
            node.alt.toLowerCase().includes('generated') ||
            node.closest('[data-message-author-role="assistant"]')
          )) {
            console.log('🖼️ Image generated detected (direct)');
            if (currentQueryIndex >= 0) {
              applyImageScaling(currentQueryIndex);
            }
          }
          
          if (imageContainers.length > 0) {
            console.log(`🖼️ Image generated detected (${imageContainers.length} images found)`);
            if (currentQueryIndex >= 0) {
              applyImageScaling(currentQueryIndex);
            }
          }
        }
      }
    }
  });
  
  // Observe the main chat container
  const chatContainer = document.querySelector('main') || document.body;
  imageObserver.observe(chatContainer, {
    childList: true,
    subtree: true
  });
  
  console.log('👁️ Image generation observer started');
}

function trackQuery(promptText, responseText = "", engineName = 'gpt-5') {
  if (!sessionActive) return;
  
  const promptTokens = estimateTokens(promptText);
  activeQueryTokens = promptTokens;
  
  console.log(`🔢 Tracking query - Prompt: "${promptText.substring(0, 50)}..." (${promptText.length} chars, ${promptTokens} tokens)`);
  
  const queryData = {
    timestamp: Date.now(),
    promptText,
    promptLength: promptText.length,
    promptTokens,
    responseTokens: 0,
    tokens: promptTokens,
    engineName,
    depth: sessionData.queries.length + 1,
    resistanceLevel: Math.round(resistanceLevel),
    imageGenerated: false,
    imageScalingApplied: false
  };
  
  if (!sessionData.firstQueryTime) {
    sessionData.firstQueryTime = Date.now();
    queryData.timeToFirstQuery = sessionData.firstQueryTime - sessionData.startTime;
    startResistanceDecay();
  }
  
  sessionData.queries.push(queryData);
  currentQueryIndex = sessionData.queries.length - 1;
  sessionData.totalTokens += promptTokens;
  
  addResistance(promptTokens);
  
  console.log(`📊 Total tokens now: ${sessionData.totalTokens}`);
  
  updateOverlay({ tokens: activeQueryTokens }, true, engineName);
  console.log(`✅ updateOverlay completed`);
  
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.set({ sessionData });
  }
  
  console.log('📊 Query tracked (prompt only):', queryData);
}

let promptSent = false;
let lastPromptTime = 0;

function getCurrentEngine() {
  const engineSelect = document.querySelector('.engine-select');
  if (engineSelect) {
    const singleValue = engineSelect.querySelector('[class$="singleValue"]');
    if (singleValue) return singleValue.textContent.trim();
  }
  return 'gpt-5';
}

function capturePromptText() {
  const text = getPromptText();
  if (text) {
    capturedPromptText = text;
  }
}

function handleSubmit(source) {
  console.log(`🚀 Prompt submitted via ${source}! Session active:`, sessionActive);

  if (!sessionActive) return;

  const now = Date.now();
  
  // Check if this is a duplicate submission within 1 second
  if (promptSent && (now - lastPromptTime) < 1000) {
    console.log("⚠️ Ignoring duplicate submission within 1 second");
    return;
  }

  const promptText = capturedPromptText || getPromptText();
  
  if (!promptText) {
    console.warn("⚠️ No prompt text captured!");
    return;
  }
  
  // Check for partial or full duplicates within 30 seconds
  if (sessionData.queries.length > 0) {
    const lastQuery = sessionData.queries[sessionData.queries.length - 1];
    
    if ((now - lastQuery.timestamp) < 5000) {
      const lastText = lastQuery.promptText;
      
      // Check if current prompt starts with the last prompt (partial duplicate)
      if (promptText.startsWith(lastText)) {
        const newPortion = promptText.substring(lastText.length);
        
        if (newPortion.length === 0) {
          // Exact duplicate
          console.log("⚠️ Exact duplicate query detected within 30 seconds - ignoring");
          return;
        }
        
        // Partial duplicate - only count the new portion
        console.log(`📝 Partial duplicate detected. Only counting new portion: "${newPortion.substring(0, 50)}..."`);
        const newTokens = estimateTokens(newPortion);
        
        const queryData = {
          timestamp: Date.now(),
          promptText: promptText,
          promptLength: promptText.length,
          promptTokens: newTokens,
          responseTokens: 0,
          tokens: newTokens,
          engineName: getCurrentEngine(),
          depth: sessionData.queries.length + 1,
          resistanceLevel: Math.round(resistanceLevel),
          imageGenerated: false,
          imageScalingApplied: false,
          isPartialDuplicate: true,
          newPortionOnly: newPortion
        };
        
        sessionData.queries.push(queryData);
        currentQueryIndex = sessionData.queries.length - 1;
        sessionData.totalTokens += newTokens;
        activeQueryTokens = newTokens;
        
        addResistance(newTokens);
        
        console.log(`📊 Total tokens now: ${sessionData.totalTokens} (added ${newTokens} new tokens)`);
        
        updateOverlay({ tokens: newTokens }, true, getCurrentEngine());
        
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.set({ sessionData });
        }
        
        console.log('📊 Partial query tracked (new portion only):', queryData);
        
        capturedPromptText = "";
        promptSent = true;
        lastPromptTime = now;
        
        setTimeout(() => {
          promptSent = false;
        }, 1000);
        
        return;
      }
      
      // Check if it's an exact duplicate but not a partial
      if (lastText === promptText) {
        console.log("⚠️ Exact duplicate query detected within 30 seconds - ignoring");
        return;
      }
    }
  }
  
  // Normal new query
  promptSent = true;
  lastPromptTime = now;
  
  const engineName = getCurrentEngine();
  trackQuery(promptText, "", engineName);
  
  capturedPromptText = "";

  setTimeout(() => {
    promptSent = false;
  }, 1000);
}

function attachListener() {
  if (document.body.dataset.listenerAttached === "true") return;
  document.body.dataset.listenerAttached = "true";

  // More specific selector for ChatGPT's input area
  const getChatGPTInput = () => {
    return document.querySelector('#prompt-textarea') ||
           document.querySelector('textarea[placeholder*="Message"]') ||
           document.querySelector('div[contenteditable="true"][data-id="root"]');
  };

  document.addEventListener("input", (e) => {
    const chatInput = getChatGPTInput();
    if (chatInput && (e.target === chatInput || chatInput.contains(e.target))) {
      capturePromptText();
    }
  }, true);

  document.addEventListener("keydown", (e) => {
    const chatInput = getChatGPTInput();
    if (!chatInput || !(e.target === chatInput || chatInput.contains(e.target))) return;
    
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      capturePromptText();
      console.log("⌨️ Enter detected in ChatGPT input!");
      setTimeout(() => handleSubmit("Enter key"), 50);
    }
  }, true);

  const attachButton = () => {
    const sendButton = document.querySelector('#composer-submit-button') ||
                       document.querySelector('button[data-testid="send-button"]') ||
                       document.querySelector('button[aria-label="Send prompt"]');
    
    if (!sendButton) return;
    if (sendButton.dataset.listenerAttached === "true") return;

    sendButton.dataset.listenerAttached = "true";
    console.log("✅ Send button listener attached");

    sendButton.addEventListener("click", () => {
      capturePromptText();
      console.log("🖱️ Send button clicked");
      handleSubmit("button click");
    });
  };

  attachButton();

  const observer = new MutationObserver(() => attachButton());
  observer.observe(document.body, { childList: true, subtree: true });
}

function checkIfPageLoaded() {
  return document.querySelector('.slider-container');
}

function isKnownEngine(engineName) {
  return (Object.keys(enginesCreditsMapping).includes(engineName) || freeEngines.includes(engineName));
}

function changeContent(content) {
  const wrappedContent = `<div class="tokens-div">${content}</div>`;
  const tokensDiv = document.querySelector('.tokens-div');
  const headerSection = document.querySelector('.pg-header-section.pg-header-title');
  
  if (tokensDiv) {
    tokensDiv.outerHTML = wrappedContent;
  } else if (headerSection) {
    headerSection.insertAdjacentHTML('beforeend', wrappedContent);
  }
}

function updateTokensUsage(engineName) {
  const sliderInputs = document.querySelectorAll('.slider-container .text-input');
  if (sliderInputs.length < 6) return;
  
  const responseLen = Number(sliderInputs[0].value.trim()) || 0;
  const bestOf = Number(sliderInputs[5].value.trim()) || 1;
  const engineFactor = enginesCreditsMapping[engineName] || enginesCreditsMapping['gpt-5'];
  const tokenCosts = engineFactor / 1000;
  
  let promptTokensSize = 0;
  const textSpans = document.querySelectorAll('span[data-text=true]');
  
  textSpans.forEach(span => {
    const spanText = span.textContent || span.innerText || '';
    const tokens = estimateTokens(spanText);
    promptTokensSize += tokens;
  });
  
  console.log(`Total prompt tokens from ${textSpans.length} spans: ${promptTokensSize}`);
  
  const completionSize = (responseLen * bestOf);
  const promptsBilled = parseFloat((promptTokensSize * tokenCosts).toFixed(3));
  const completionBilled = parseFloat((completionSize * tokenCosts).toFixed(3));
  
  let usageCosts = promptsBilled + completionBilled;
  if (usageCosts < 0.01) {
    usageCosts = "<0.01>";
  } else {
    usageCosts = parseFloat((usageCosts).toFixed(2));
  }
  
  const usageCostsStrBreakdown = `${promptsBilled} prompt + ${completionBilled} completion`;
  const tokenInfo = `(${promptTokensSize} prompt tokens + ${completionSize} completion tokens)`;
  const usageCostsElement = `Usage costs: <strong>${usageCosts}</strong> ${tokenInfo} - ${usageCostsStrBreakdown}`;
  changeContent(usageCostsElement);
  checkMaxTokensWarning(promptTokensSize + responseLen);
}

function countWords() {
  const engineName = getCurrentEngine();
  
  if (!isKnownEngine(engineName)) {
    changeContent(`Unknown engine <strong>${engineName}</strong>`);
  } else {
    if (freeEngines.includes(engineName)) {
      changeContent(`<strong>${engineName}</strong> is currently free to use 🎉`);
    } else {
      updateTokensUsage(engineName);
    }
  }
}

function checkMaxTokensWarning(promptTokensSize) {
  const elementAlreadyExist = document.querySelector('.exceeded-prompts-error-msg');
  
  if (promptTokensSize > maxTokenSize) {
    const exceededTokensMsg = `<div class="exceeded-prompts-error-msg">Prompt exceeds maximum of ${maxTokenSize} tokens (${Math.ceil(Math.abs(maxTokenSize - promptTokensSize))} too much)</div>`;
    
    if (!elementAlreadyExist) {
      const headerSection = document.querySelector('.pg-header-section.pg-header-title');
      if (headerSection) {
        headerSection.insertAdjacentHTML('beforeend', exceededTokensMsg);
      }
    } else {
      elementAlreadyExist.outerHTML = exceededTokensMsg;
    }
  } else if (elementAlreadyExist) {
    elementAlreadyExist.remove();
  }
}

function registerEditorListeners() {
  const editableDiv = document.querySelector('div[data-contents=true]');
  if (editableDiv) {
    editableDiv.addEventListener('input', countWords);
    editableDiv.addEventListener('paste', countWords);
  }
  
  const engineSelect = document.querySelector('.engine-select [class$="singleValue"]');
  if (engineSelect) {
    const observer = new MutationObserver(countWords);
    observer.observe(engineSelect, { childList: true, subtree: true });
  }
  
  const appSelect = document.querySelector('.app-select-container [class$="singleValue"]');
  if (appSelect) {
    const observer = new MutationObserver(countWords);
    observer.observe(appSelect, { childList: true, subtree: true });
  }
  
  const sliderContainer = document.querySelector('.slider-container');
  if (sliderContainer) {
    sliderContainer.addEventListener('input', countWords);
    sliderContainer.addEventListener('change', countWords);
  }
  
  const rcSlider = document.querySelector('.rc-slider');
  if (rcSlider) {
    rcSlider.addEventListener('click', countWords);
    rcSlider.addEventListener('mousedown', countWords);
  }
  
  countWords();
}

function registerWhenPageLoad() {
  setTimeout(() => {
    if (!checkIfPageLoaded()) {
      setTimeout(registerWhenPageLoad, pageLoadWaitIntervals);
      return;
    }
    registerEditorListeners();
  }, pageLoadWaitIntervals);
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Message received:', message.type);
    
    if (message.type === 'START_SESSION') {
      console.log("🟢 Starting session...");
      sessionActive = true;
      resistanceLevel = 0;
      lastDecayTime = null;
      promptSent = false;
      lastPromptTime = 0;
      currentQueryIndex = -1;
      
      sessionData = {
        startTime: Date.now(),
        firstQueryTime: null,
        queries: [],
        totalTokens: 0,
        cumulativeEnergy: 0
      };
      
      console.log("🎨 About to create overlay...");
      createOverlay();
      console.log("✅ Overlay creation complete");
      
      // Start timer
      startTimer();
      
      // Start image detection
      detectImageGeneration();
      
      sendResponse({ success: true });
      return true;
    }
    else if (message.type === 'END_SESSION') {
      sessionActive = false;
      stopResistanceDecay();
      stopTimer();
      
      resistanceLevel = 0;
      updateResistanceBar();
      sendResistanceToArduino(0, 0, true); // Force stop even if Arduino is disabled
      console.log("🛑 Motor stopped - session ended");
      
      const completionTime = Date.now() - sessionData.startTime;
      const finalData = {
        ...sessionData,
        completionTime,
        timeToFirstQuery: sessionData.firstQueryTime ? 
          sessionData.firstQueryTime - sessionData.startTime : null
      };
      
      console.log("📊 Session ended:", finalData);
      sendResponse({ success: true, data: finalData });
      return true;
    }
    else if (message.type === 'GET_SESSION_DATA') {
      sendResponse({ data: sessionData, active: sessionActive });
      return true;
    }
    
    return true;
  });
}

const pageObserver = new MutationObserver(attachListener);
pageObserver.observe(document.body, {
  childList: true,
  subtree: true
});

attachListener();

if (document.readyState !== 'complete') {
  window.addEventListener('load', registerWhenPageLoad);
} else {
  registerWhenPageLoad();
}

if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get(['sessionData'], (result) => {
    if (result.sessionData && result.sessionData.startTime) {
      console.log("📂 Loaded existing session data");
    }
  });
}