let sessionActive = false;
let updateInterval;

// DOM elements
const startBtn = document.getElementById('startBtn');
const endBtn = document.getElementById('endBtn');
const status = document.getElementById('status');
const totalQueries = document.getElementById('totalQueries');
const totalTokens = document.getElementById('totalTokens');
const timeToFirst = document.getElementById('timeToFirst');
const duration = document.getElementById('duration');
const arduinoTokens = document.getElementById('arduinoTokens');
const arduinoPWM = document.getElementById('arduinoPWM');
const downloadArduinoBtn = document.getElementById('downloadArduino');
const exportDataBtn = document.getElementById('exportData');

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

// Update UI with session data
function updateUI() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0] || !tabs[0].url.includes('chatgpt.com')) {
      status.textContent = 'Please navigate to chatgpt.com';
      status.classList.remove('active');
      return;
    }
    
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_SESSION_DATA' }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      
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
      
      // Update metrics
      totalQueries.textContent = data.queries.length;
      totalTokens.textContent = data.totalTokens.toLocaleString();
      
      if (data.firstQueryTime && data.startTime) {
        timeToFirst.textContent = formatDuration(data.firstQueryTime - data.startTime);
      }
      
      if (data.startTime && sessionActive) {
        duration.textContent = formatDuration(Date.now() - data.startTime);
      }
    });
  });
  
  // Update Arduino info
  chrome.storage.local.get(['tokens', 'pwm'], (result) => {
    arduinoTokens.textContent = result.tokens || 0;
    arduinoPWM.textContent = result.pwm || 0;
  });
}

// Start session
startBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      console.error('No active tab found');
      return;
    }
    
    console.log('Sending START_SESSION to tab:', tabs[0].id);
    
    chrome.tabs.sendMessage(tabs[0].id, { type: 'START_SESSION' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error:', chrome.runtime.lastError.message);
        alert('Error starting session. Make sure you are on chatgpt.com and refresh the page.');
        return;
      }
      
      if (response && response.success) {
        console.log('Session started successfully');
        updateUI();
        // Start periodic updates
        updateInterval = setInterval(updateUI, 1000);
      } else {
        console.error('No response from content script');
      }
    });
  });
});

// End session
endBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    
    chrome.tabs.sendMessage(tabs[0].id, { type: 'END_SESSION' }, (response) => {
      if (response && response.success) {
        console.log('Final session data:', response.data);
        updateUI();
        clearInterval(updateInterval);
        
        // Optionally auto-export
        setTimeout(() => exportData(response.data), 500);
      }
    });
  });
});

// Download Arduino script
downloadArduinoBtn.addEventListener('click', () => {
  chrome.storage.local.get(['arduinoScript'], (result) => {
    if (!result.arduinoScript) {
      alert('No Arduino script available yet. Submit a query first.');
      return;
    }
    
    const blob = new Blob([result.arduinoScript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chatgpt_energy_tracker_${Date.now()}.ino`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

// Export session data
exportDataBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_SESSION_DATA' }, (response) => {
      if (response && response.data) {
        exportData(response.data);
      }
    });
  });
});

function exportData(data) {
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
  csv += 'Query #,Timestamp,Prompt Length,Tokens,Depth,Time from Start (ms)\n';
  data.queries.forEach((query, idx) => {
    csv += `${idx + 1},${new Date(query.timestamp).toISOString()},${query.promptLength},${query.tokens},${query.depth},${query.timestamp - data.startTime}\n`;
  });
  
  // Download
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chatgpt_session_${data.startTime}_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Initial update
updateUI();
updateInterval = setInterval(updateUI, 2000);