let sessionActive = false;
let updateInterval;
let timerInterval;
let sessionStartTime = null;

// DOM elements
const startBtn = document.getElementById('startBtn');
const endBtn = document.getElementById('endBtn');
const status = document.getElementById('status');
const totalQueries = document.getElementById('totalQueries');
const totalTokens = document.getElementById('totalTokens');
const timeToFirst = document.getElementById('timeToFirst');
const duration = document.getElementById('duration');
const exportDataBtn = document.getElementById('exportData');

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
      status.classList.remove('active');
      return;
    }

    const url = tabs[0].url;
    if (!url || (!url.includes('chatgpt.com') && !url.includes('chat.openai.com'))) {
      status.textContent = 'Please navigate to chatgpt.com';
      status.classList.remove('active');
      return;
    }
    
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_SESSION_DATA' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Content script not ready:', chrome.runtime.lastError.message);
        status.textContent = 'Refresh ChatGPT page to activate';
        status.classList.remove('active');
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
        status.classList.add('active');
      } else {
        status.textContent = 'Session Inactive';
        status.classList.remove('active');
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
    
    chrome.tabs.sendMessage(tabs[0].id, { type: 'START_SESSION' }, (response) => {
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
        status.classList.add('active');
        
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
        status.classList.remove('active');
        
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
  
  // Query details
  csv += 'Query #,Timestamp,Prompt Length,Prompt Tokens,Response Tokens,Total Tokens,Depth,Resistance Level (%),Image Generated,Image Scaling Applied,Original Tokens,Time from Start (ms)\n';
  data.queries.forEach((query, idx) => {
    const resistanceLevel = query.resistanceLevel !== undefined ? query.resistanceLevel : 'N/A';
    const imageGenerated = query.imageGenerated ? 'Yes' : 'No';
    const imageScalingApplied = query.imageScalingApplied ? 'Yes' : 'No';
    const originalTokens = query.originalPromptTokens !== undefined ? query.originalPromptTokens : query.promptTokens;
    csv += `${idx + 1},${new Date(query.timestamp).toISOString()},${query.promptLength},${query.promptTokens},${query.responseTokens},${query.tokens},${query.depth},${resistanceLevel},${imageGenerated},${imageScalingApplied},${originalTokens},${query.timestamp - data.startTime}\n`;
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