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
        
        if (data.startTime && sessionActive) {
          duration.textContent = formatDuration(Date.now() - data.startTime);
        }
      }
    });
  });
  
  // Update Arduino info from storage
  chrome.storage.local.get(['lastTokens', 'lastPWM'], (result) => {
    if (result.lastTokens !== undefined) {
      arduinoTokens.textContent = result.lastTokens;
    }
    if (result.lastPWM !== undefined) {
      arduinoPWM.textContent = result.lastPWM;
    }
  });
}

// Start session
startBtn.addEventListener('click', () => {
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
        updateUI();
        // Start periodic updates
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = setInterval(updateUI, 1000);
      } else {
        console.error('Failed to start session');
        alert('Failed to start session');
      }
    });
  });
});

// End session
endBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    
    chrome.tabs.sendMessage(tabs[0].id, { type: 'END_SESSION' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error ending session:', chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        console.log('📊 Final session data:', response.data);
        updateUI();
        if (updateInterval) {
          clearInterval(updateInterval);
          updateInterval = null;
        }
        
        // Optionally auto-export
        if (response.data && response.data.queries.length > 0) {
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

// Download Arduino script
downloadArduinoBtn.addEventListener('click', () => {
  // Arduino code template
  const arduinoCode = `// Token-based Air Pump Control
// Generated by ChatGPT Energy Tracker

const int pwmPin = 9;
const int in1Pin = 7;
const int in2Pin = 6;

int currentPwm = 0;
int targetPwm = 0;
String inputString = "";

void setup() {
  pinMode(pwmPin, OUTPUT);
  pinMode(in1Pin, OUTPUT);
  pinMode(in2Pin, OUTPUT);
  
  Serial.begin(9600);
  Serial.println("Arduino Energy Tracker Ready");
}

void loop() {
  while (Serial.available()) {
    char inChar = (char)Serial.read();
    inputString += inChar;
    if (inChar == '\\n') {
      processCommand(inputString);
      inputString = "";
    }
  }
  
  // Ramp to target
  if (currentPwm < targetPwm) {
    currentPwm = min(currentPwm + 4, targetPwm);
  } else if (currentPwm > targetPwm) {
    currentPwm = max(currentPwm - 4, targetPwm);
  }
  
  // Apply PWM
  if (currentPwm == 0) {
    digitalWrite(in1Pin, LOW);
    digitalWrite(in2Pin, LOW);
  } else {
    digitalWrite(in1Pin, HIGH);
    digitalWrite(in2Pin, LOW);
    analogWrite(pwmPin, currentPwm);
  }
  
  delay(10);
}

void processCommand(String cmd) {
  cmd.trim();
  if (cmd.startsWith("PWM:")) {
    targetPwm = cmd.substring(4).toInt();
    Serial.print("PWM set to: ");
    Serial.println(targetPwm);
  }
}`;

  const blob = new Blob([arduinoCode], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `energy_tracker_${Date.now()}.ino`;
  a.click();
  URL.revokeObjectURL(url);
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
  csv += 'Query #,Timestamp,Prompt Length,Prompt Tokens,Response Tokens,Total Tokens,Depth,Time from Start (ms)\n';
  data.queries.forEach((query, idx) => {
    csv += `${idx + 1},${new Date(query.timestamp).toISOString()},${query.promptLength},${query.promptTokens},${query.responseTokens},${query.tokens},${query.depth},${query.timestamp - data.startTime}\n`;
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
});