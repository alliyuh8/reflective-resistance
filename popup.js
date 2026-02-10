let sessionActive = false;
let updateInterval;
let timerInterval;
let sessionStartTime = null;
let arduinoEnabled = true; // Track Arduino state

// DOM elements
const startBtn = document.getElementById('startBtn');
const endBtn = document.getElementById('endBtn');
const status = document.getElementById('status');
const statusContainer = document.getElementById('statusContainer');
const totalQueries = document.getElementById('totalQueries');
const totalTokens = document.getElementById('totalTokens');
const timeToFirst = document.getElementById('timeToFirst');
const duration = document.getElementById('duration');
const exportDataBtn = document.getElementById('exportData');
const arduinoToggle = document.getElementById('arduinoToggle');

// Load Arduino toggle state from storage
chrome.storage.local.get(['arduinoEnabled'], (result) => {
  arduinoEnabled = result.arduinoEnabled !== undefined ? result.arduinoEnabled : true;
  arduinoToggle.checked = arduinoEnabled;
  console.log('Arduino toggle loaded:', arduinoEnabled);
});

// Arduino toggle event listener
arduinoToggle.addEventListener('change', (e) => {
  arduinoEnabled = e.target.checked;
  
  // Save state to storage
  chrome.storage.local.set({ arduinoEnabled }, () => {
    console.log('Arduino toggle state saved:', arduinoEnabled);
  });
  
  // Send updated state to content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { 
        type: 'SET_ARDUINO_ENABLED', 
        enabled: arduinoEnabled 
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Could not send to content script:', chrome.runtime.lastError.message);
        } else {
          console.log('Arduino state sent to content script:', arduinoEnabled);
        }
      });
    }
  });
  
  // If turning off, send stop signal to Arduino immediately
  if (!arduinoEnabled) {
    chrome.runtime.sendMessage({
      type: 'ARDUINO_UPDATE',
      resistance: 0,
      tokens: 0,
      enabled: false
    });
  }
});

// Resistance calculation
const TOKENS_FOR_MAX_RESISTANCE = 1000;

// Calculate resistance level
function calculateResistance(tokens) {
  const percent = Math.min(100, (tokens / TOKENS_FOR_MAX_RESISTANCE) * 100);
  
  let label = "No resistance";
  if (percent >= 75) label = "Maximum resistance";
  else if (percent >= 50) label = "Significant resistance";
  else if (percent >= 20) label = "Medium resistance";
  else if (percent >= 10) label = "Slight resistance";
  
  return { percent, label };
}

// Format time duration
function formatDuration(ms) {
  if (!ms) return '--';
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

// Update live timer
function updateTimer() {
  if (sessionActive && sessionStartTime) {
    const elapsed = Date.now() - sessionStartTime;
    duration.textContent = formatDuration(elapsed);
  }
}

// Start live timer
function startTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  timerInterval = setInterval(updateTimer, 1000);
}

// Stop live timer
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Update UI with session data
function updateUI() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      status.textContent = 'No active tab found';
      statusContainer.classList.remove('active');
      return;
    }

    const url = tabs[0].url;
    if (!url || (!url.includes('chatgpt.com') && !url.includes('chat.openai.com'))) {
      status.textContent = 'Please navigate to chatgpt.com';
      statusContainer.classList.remove('active');
      return;
    }
    
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_SESSION_DATA' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Content script not ready:', chrome.runtime.lastError.message);
        status.textContent = 'Refresh ChatGPT page to activate';
        statusContainer.classList.remove('active');
        return;
      }

      if (!response) {
        console.log('No response from content script');
        return;
      }
      
      const data = response.data;
      sessionActive = response.active;
      
      // Update buttons
      startBtn.disabled = sessionActive;
      endBtn.disabled = !sessionActive;
      
      // Update status
      if (sessionActive) {
        status.textContent = '🟢 Session Active';
        statusContainer.classList.add('active');
      } else {
        status.textContent = 'Session Inactive';
        statusContainer.classList.remove('active');
      }
      
      // Update metrics if data exists
      if (data) {
        totalQueries.textContent = data.queries?.length || 0;
        totalTokens.textContent = (data.totalTokens || 0).toLocaleString();
        
        if (data.firstQueryTime && data.startTime) {
          timeToFirst.textContent = formatDuration(data.firstQueryTime - data.startTime);
        }
        
        // Store session start time for live timer
        if (data.startTime && sessionActive) {
          sessionStartTime = data.startTime;
          // Timer updates separately every second
        } else if (!sessionActive) {
          sessionStartTime = null;
          // Show final duration if session ended
          if (data.startTime) {
            const completionTime = data.completionTime || (Date.now() - data.startTime);
            duration.textContent = formatDuration(completionTime);
          }
        }
      }
    });
  });
}

// Start session
startBtn.addEventListener('click', () => {
  console.log('🟢 Start button clicked');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      console.error('No active tab found');
      alert('No active tab found');
      return;
    }
    
    const url = tabs[0].url;
    if (!url || (!url.includes('chatgpt.com') && !url.includes('chat.openai.com'))) {
      alert('Please navigate to chatgpt.com first');
      return;
    }
    
    console.log('Sending START_SESSION to tab:', tabs[0].id);
    
    chrome.tabs.sendMessage(tabs[0].id, { 
      type: 'START_SESSION',
      arduinoEnabled: arduinoEnabled 
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error:', chrome.runtime.lastError.message);
        alert('Error starting session. Please refresh the ChatGPT page and try again.');
        return;
      }
      
      if (response && response.success) {
        console.log('✅ Session started successfully');
        sessionActive = true;
        sessionStartTime = Date.now();
        
        // Force button states
        startBtn.disabled = true;
        endBtn.disabled = false;
        status.textContent = '🟢 Session Active';
        statusContainer.classList.add('active');
        
        // Start periodic updates
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = setInterval(updateUI, 2000);
        // Start live timer
        startTimer();
      } else {
        console.error('Failed to start session');
        alert('Failed to start session');
      }
    });
  });
});

// End session
endBtn.addEventListener('click', () => {
  console.log('🔴 End button clicked, sessionActive:', sessionActive);
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      console.error('No active tab for end session');
      return;
    }
    
    console.log('Sending END_SESSION to tab:', tabs[0].id);
    
    chrome.tabs.sendMessage(tabs[0].id, { type: 'END_SESSION' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error ending session:', chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        console.log('📊 Final session data:', response.data);
        sessionActive = false;
        
        // Force button states
        startBtn.disabled = false;
        endBtn.disabled = true;
        status.textContent = 'Session Inactive';
        statusContainer.classList.remove('active');
        
        stopTimer();
        updateUI();
        
        if (updateInterval) {
          clearInterval(updateInterval);
          updateInterval = null;
        }
        
        // Auto-export prompt
        if (response.data && response.data.queries && response.data.queries.length > 0) {
          setTimeout(() => {
            if (confirm('Export session data to CSV?')) {
              exportData(response.data);
            }
          }, 500);
        }
      }
    });
  });
});

// Export session data
exportDataBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_SESSION_DATA' }, (response) => {
      if (response && response.data && response.data.queries && response.data.queries.length > 0) {
        exportData(response.data);
      } else {
        alert('No session data to export. Start a session and submit some queries first.');
      }
    });
  });
});

// Helper function to escape CSV fields
function escapeCSV(field) {
  if (field === null || field === undefined) {
    return '';
  }
  
  // Convert to string
  const str = String(field);
  
  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  
  return str;
}

function exportData(data) {
  if (!data || !data.queries) {
    alert('No data to export');
    return;
  }

  // Calculate completion time if session ended
  const completionTime = data.completionTime || (Date.now() - data.startTime);
  const timeToFirstQuery = data.firstQueryTime ? 
    data.firstQueryTime - data.startTime : null;
  
  // CSV Header
  let csv = 'Metric,Value\n';
  csv += `Session Start,${new Date(data.startTime).toISOString()}\n`;
  csv += `Time to First Query (ms),${timeToFirstQuery || 'N/A'}\n`;
  csv += `Total Queries,${data.queries.length}\n`;
  csv += `Total Tokens,${data.totalTokens}\n`;
  csv += `Completion Time (ms),${completionTime}\n`;
  csv += `Completion Time (formatted),${formatDuration(completionTime)}\n\n`;
  
  // Query details header
  csv += 'Query #,Timestamp,Prompt Text,Prompt Length,Prompt Tokens,Response Tokens,Total Tokens,Depth,Resistance Level (%),Image Generated,Image Scaling Applied,Original Tokens,Time from Start (ms)\n';
  
  // Query details rows
  data.queries.forEach((query, idx) => {
    const resistanceLevel = query.resistanceLevel !== undefined ? query.resistanceLevel : 'N/A';
    const imageGenerated = query.imageGenerated ? 'Yes' : 'No';
    const imageScalingApplied = query.imageScalingApplied ? 'Yes' : 'No';
    const originalTokens = query.originalPromptTokens !== undefined ? query.originalPromptTokens : query.promptTokens;
    
    // Escape the prompt text for CSV
    const promptText = escapeCSV(query.promptText || '');
    
    csv += `${idx + 1},${new Date(query.timestamp).toISOString()},${promptText},${query.promptLength},${query.promptTokens},${query.responseTokens},${query.tokens},${query.depth},${resistanceLevel},${imageGenerated},${imageScalingApplied},${originalTokens},${query.timestamp - data.startTime}\n`;
  });
  
  // Download
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chatgpt_session_${data.startTime}_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  
  console.log('✅ Data exported successfully');
}

// Initial update
updateUI();
updateInterval = setInterval(updateUI, 2000);

// Clean up on popup close
window.addEventListener('beforeunload', () => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  if (timerInterval) {
    clearInterval(timerInterval);
  }
});