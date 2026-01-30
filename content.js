console.log("🔥 ChatGPT Energy Tracker Extension loaded (GPT-5 optimized) - VERSION 2.0");

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
let countedResponseIds = new Set();
let activeQueryTokens = 0;

// Resistance tracking
let resistanceLevel = 0; // 0-100%
let decayInterval = null;
let lastDecayTime = null;

// Resistance calculation: simple percentage based on tokens
// 100 tokens = 10%, 500 tokens = 50%, 1000 tokens = 100%
const TOKENS_FOR_MAX_RESISTANCE = 1000;

// Decay rate: lose 1% every 15 seconds (but check more frequently)
const DECAY_RATE = 1; // % per interval
const DECAY_INTERVAL = 15000; // 15 seconds in ms
const DECAY_UPDATE_INTERVAL = 1000; // Send updates every 1 second

// GPT-5 Energy conversion constants (updated estimates)
const ENERGY_PER_TOKEN = 0.0004; // Wh per token (estimated for GPT-5, higher than GPT-4)
const SMARTPHONE_CHARGE = 15; // Wh
const GOOGLE_SEARCH = 0.0003; // Wh
const LED_HOUR = 10; // Wh

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
    ledHours: (energyWh / LED_HOUR).toFixed(4)
  };
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
      <span class="energy-title">⚡ Energy Impact (GPT-5)</span>
      <button id="close-overlay" class="close-btn">×</button>
    </div>
    <div class="energy-content">
      <div class="resistance-section">
        <div class="resistance-header">
          <span class="resistance-label">🎯 Resistance Level</span>
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
      <div class="cost-estimate">
        <div class="cost-item">
          💰 Estimated cost: $<span id="cost-value">0.00</span>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  console.log("✅ Overlay created and appended to body");
  
  const checkElems = {
    'resistance-percent': document.getElementById('resistance-percent'),
    'progress-fill': document.getElementById('progress-fill'),
    'resistance-status': document.getElementById('resistance-status')
  };
  
  console.log("🔍 Resistance elements check:", checkElems);
  
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

function sendResistanceToArduino(resistance, tokens) {
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
  overlay.classList.add('flash');
  setTimeout(() => overlay.classList.remove('flash'), 500);
  
  if (typeof metrics.tokens === 'number') {
    document.getElementById('tokens-value').textContent = metrics.tokens.toLocaleString();
  }
  
  if (cumulative) {
    document.getElementById('cumulative-tokens').textContent = sessionData.totalTokens.toLocaleString();
    const cumulativeMetrics = calculateEnergyMetrics(sessionData.totalTokens);
    document.getElementById('smartphone-equiv').textContent = cumulativeMetrics.smartphoneCharges;
    document.getElementById('search-equiv').textContent = cumulativeMetrics.googleSearches.toLocaleString();
    document.getElementById('led-equiv').textContent = cumulativeMetrics.ledHours;
    
    const tokenCosts = (enginesCreditsMapping[engineName] || enginesCreditsMapping['gpt-5']) / 1000;
    const totalCost = (sessionData.totalTokens * tokenCosts).toFixed(3);
    document.getElementById('cost-value').textContent = totalCost;
  }
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
    depth: sessionData.queries.length + 1
  };
  
  if (!sessionData.firstQueryTime) {
    sessionData.firstQueryTime = Date.now();
    queryData.timeToFirstQuery = sessionData.firstQueryTime - sessionData.startTime;
    startResistanceDecay();
  }
  
  sessionData.queries.push(queryData);
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
  
  // Check if this is actually a NEW query (different from last one)
  if (sessionData.queries.length > 0) {
    const lastQuery = sessionData.queries[sessionData.queries.length - 1];
    
    // If same text and less than 3 seconds, it's a duplicate
    if (lastQuery.promptText === promptText && (now - lastQuery.timestamp) < 3000) {
      console.log("⚠️ Duplicate query detected - ignoring");
      return;
    }
  }
  
  promptSent = true;
  lastPromptTime = now;
  
  const engineName = getCurrentEngine();
  trackQuery(promptText, "", engineName);
  observeResponse(engineName);
  
  capturedPromptText = "";

  setTimeout(() => {
    promptSent = false;
  }, 1000);
}

function attachListener() {
  if (document.body.dataset.listenerAttached === "true") return;
  document.body.dataset.listenerAttached = "true";

  document.addEventListener("input", (e) => {
    const target = e.target;
    const isChatGPTInput = target.tagName === "TEXTAREA" || target.isContentEditable;
    if (isChatGPTInput) {
      capturePromptText();
    }
  }, true);

  document.addEventListener("keydown", (e) => {
    const target = e.target;
    const isChatGPTInput = target.tagName === "TEXTAREA" || target.isContentEditable;
    
    if (!isChatGPTInput) return;
    
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

function observeResponse(engineName = 'gpt-5') {
  const targetNode = document.querySelector('main') || document.body;
  
  let lastResponseLength = 0;
  let responseComplete = false;
  let stableCheckTimeout = null;
  let stabilityCounter = 0;
  const REQUIRED_STABLE_CHECKS = 3;
  
  const observer = new MutationObserver((mutations) => {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    
    if (messages.length > 0 && sessionData.queries.length > 0) {
      const latestMessage = messages[messages.length - 1];
      const responseText = latestMessage.textContent || "";
      const currentLength = responseText.length;
      
      const lastQuery = sessionData.queries[sessionData.queries.length - 1];
      const responseId = `${lastQuery.timestamp}-${sessionData.queries.length - 1}`;
      
      if (countedResponseIds.has(responseId)) {
        observer.disconnect();
        return;
      }
      
      if (currentLength > 0 && lastQuery.responseTokens === 0) {
        
        if (currentLength === lastResponseLength) {
          stabilityCounter++;
          console.log(`🔍 Response stable ${stabilityCounter}/${REQUIRED_STABLE_CHECKS} (${currentLength} chars)`);
        } else {
          stabilityCounter = 0;
        }
        
        if (stableCheckTimeout) {
          clearTimeout(stableCheckTimeout);
        }
        
        if (stabilityCounter >= REQUIRED_STABLE_CHECKS && !responseComplete) {
          stableCheckTimeout = setTimeout(() => {
            if (!responseComplete && currentLength === lastResponseLength) {
              const responseTokens = estimateTokens(responseText);
              
              console.log(`📥 Response FINAL: ${responseTokens} tokens (${currentLength} chars)`);
              
              lastQuery.responseTokens = responseTokens;
              lastQuery.tokens = lastQuery.promptTokens + responseTokens;
              sessionData.totalTokens += responseTokens;
              
              activeQueryTokens = lastQuery.promptTokens + responseTokens;
              
              countedResponseIds.add(responseId);
              responseComplete = true;
              
              addResistance(responseTokens);
              
              updateOverlay({ tokens: activeQueryTokens }, true, engineName);
              
              if (typeof chrome !== 'undefined' && chrome.storage) {
                chrome.storage.local.set({ sessionData });
              }
              
              observer.disconnect();
            }
          }, 2000);
        }
        
        lastResponseLength = currentLength;
      }
    }
  });

  observer.observe(targetNode, {
    childList: true,
    subtree: true,
    characterData: true
  });
  
  setTimeout(() => {
    observer.disconnect();
    
    if (sessionData.queries.length > 0) {
      const lastQuery = sessionData.queries[sessionData.queries.length - 1];
      const responseId = `${lastQuery.timestamp}-${sessionData.queries.length - 1}`;
      
      if (!countedResponseIds.has(responseId) && lastQuery.responseTokens === 0) {
        const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (messages.length > 0) {
          const latestMessage = messages[messages.length - 1];
          const responseText = latestMessage.textContent || "";
          const responseTokens = estimateTokens(responseText);
          
          if (responseTokens > 0) {
            console.log(`⏱️ Safety timeout: Counting response ${responseTokens} tokens`);
            
            lastQuery.responseTokens = responseTokens;
            lastQuery.tokens = lastQuery.promptTokens + responseTokens;
            sessionData.totalTokens += responseTokens;
            
            activeQueryTokens = lastQuery.promptTokens + responseTokens;
            
            countedResponseIds.add(responseId);
            
            addResistance(responseTokens);
            
            updateOverlay({ tokens: activeQueryTokens }, true, engineName);
            
            if (typeof chrome !== 'undefined' && chrome.storage) {
              chrome.storage.local.set({ sessionData });
            }
          }
        }
      }
    }
  }, 90000);
}

// Remaining functions (checkIfPageLoaded, isKnownEngine, etc.) stay the same...
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
      countedResponseIds.clear();
      promptSent = false;
      lastPromptTime = 0;
      
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
      
      sendResponse({ success: true });
      return true;
    }
    else if (message.type === 'END_SESSION') {
      sessionActive = false;
      stopResistanceDecay();
      
      resistanceLevel = 0;
      updateResistanceBar();
      sendResistanceToArduino(0, 0);
      console.log("🛑 Motor stopped - session ended");
      
      countedResponseIds.clear();
      
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