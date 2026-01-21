console.log("🔧 Background service worker started");

// Store Arduino script generation state
let currentTokenCount = 0;
let currentPWM = 0;

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ARDUINO_UPDATE') {
    currentTokenCount = message.tokens;
    currentPWM = message.pwmValue;
    
    console.log(`🤖 Arduino update: ${currentTokenCount} tokens → PWM ${currentPWM}`);
    
    // Generate Arduino script
    generateArduinoScript(currentTokenCount, currentPWM);
  }
  
  return true;
});

// Generate Arduino script based on token count
function generateArduinoScript(tokens, pwmValue) {
  const script = `
/*
  ChatGPT Energy Tracker - Motor Control
  Generated: ${new Date().toISOString()}
  Tokens: ${tokens}
  PWM Value: ${pwmValue}
*/

const int motorPin = 9;  // PWM-capable pin for motor control
const int ledPin = 13;   // Built-in LED for visual feedback

// Configuration
const int TOKEN_COUNT = ${tokens};
const int PWM_VALUE = ${pwmValue};  // 0-255

void setup() {
  pinMode(motorPin, OUTPUT);
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
  
  Serial.println("ChatGPT Energy Tracker Initialized");
  Serial.print("Token Count: ");
  Serial.println(TOKEN_COUNT);
  Serial.print("PWM Value: ");
  Serial.println(PWM_VALUE);
}

void loop() {
  // Set motor speed based on token count
  analogWrite(motorPin, PWM_VALUE);
  
  // Visual feedback - blink LED proportional to energy use
  int blinkDelay = map(PWM_VALUE, 0, 255, 1000, 100);
  
  digitalWrite(ledPin, HIGH);
  delay(blinkDelay);
  digitalWrite(ledPin, LOW);
  delay(blinkDelay);
  
  // Optional: Serial output for debugging
  if (Serial.available() > 0) {
    char cmd = Serial.read();
    if (cmd == 's') {
      // Status report
      Serial.print("Current PWM: ");
      Serial.println(PWM_VALUE);
      Serial.print("Tokens: ");
      Serial.println(TOKEN_COUNT);
    }
  }
}

/*
  WIRING INSTRUCTIONS:
  
  1. Motor Driver (L298N or similar):
     - Connect motor driver IN1 to Arduino pin 9
     - Connect motor driver VCC to external power (6-12V)
     - Connect motor driver GND to Arduino GND and power supply GND
     - Connect motor to motor driver outputs
  
  2. Alternative - Direct DC Motor (small motors only):
     - Connect motor through transistor (TIP120 or similar)
     - Base to pin 9 through 1kΩ resistor
     - Collector to motor negative
     - Emitter to GND
     - Motor positive to external power supply
     - Flyback diode across motor (cathode to +)
  
  3. Power considerations:
     - DO NOT power motor directly from Arduino
     - Use external power supply rated for your motor
     - Common ground between Arduino and motor supply
  
  SCALING NOTES:
  - Current scaling: 0-1000 tokens = 0-255 PWM
  - Modify map() function in code to adjust sensitivity
  - Higher PWM = faster motor = more energy visualization
*/
`;

  // Store the script for retrieval by popup
  chrome.storage.local.set({ 
    arduinoScript: script,
    lastUpdate: Date.now(),
    tokens: tokens,
    pwm: pwmValue
  });
}

// Initialize with default script
generateArduinoScript(0, 0);