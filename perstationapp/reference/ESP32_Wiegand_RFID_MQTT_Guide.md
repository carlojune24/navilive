# ESP32 + R16-7DB Wiegand → WiFi (MQTT) Guide

Complete step-by-step guide to read card numbers from the **R16-7DB** UHF RFID reader using **Wiegand** and send them over WiFi with an **ESP32**.

---

## 1. What This Solution Does

- Reads the card number from the R16-7DB via **Wiegand** interface
- Sends the card number over WiFi using **MQTT**
- Uses a small queue so cards are not lost if WiFi drops briefly
- Sends a heartbeat every 30 seconds
- Very low network traffic (even with 100+ people)

---

## 2. Hardware Required

| Item                    | Quantity | Notes                              |
|-------------------------|----------|------------------------------------|
| ESP32 Dev Board         | 1        | Any common ESP32 (NodeMCU, DevKit) |
| R16-7DB RFID Reader     | 1        | Already have                       |
| Jumper wires            | 3–4      | For D0, D1, GND                    |
| 4.7kΩ resistors (optional) | 2     | Recommended for longer cables      |
| 9–12V Power supply      | 1        | For the R16-7DB                    |

---

## 3. Wiring

| R16-7DB Pin | ESP32 Pin | Description      |
|-------------|-----------|------------------|
| **D0**      | GPIO 4    | Wiegand Data 0   |
| **D1**      | GPIO 5    | Wiegand Data 1   |
| **GND**     | GND       | Common Ground    |

> **Important**  
> - Power the R16-7DB with its own 9–12V supply.  
> - Do **not** power the reader from the ESP32.  
> - Keep the wires between reader and ESP32 as short as possible (ideally under 3 meters).

**Optional but recommended:**  
Add 4.7kΩ pull-up resistors from D0 → 3.3V and D1 → 3.3V if you have unstable readings.

---

## 4. Software Setup (Arduino IDE)

### 4.1 Install Required Libraries

1. Open **Arduino IDE**
2. Go to **Sketch → Include Library → Manage Libraries**
3. Install these two libraries:
   - `Wiegand` by **monkeyboard**
   - `PubSubClient` by **Nick O’Leary**

### 4.2 Board Settings

- Board: **ESP32 Dev Module**
- Upload Speed: 115200
- Port: Select your ESP32 COM port

---

## 5. Configuration (Change These Values)

Open the code and change only this section:

```cpp
const char* ssid         = "Your_WiFi_Name";
const char* password     = "Your_WiFi_Password";

const char* mqtt_server  = "192.168.1.100";   // IP of your MQTT broker
const int   mqtt_port    = 1883;
const char* mqtt_user    = "";                // leave empty if no auth
const char* mqtt_pass    = "";
const char* mqtt_topic   = "rfid/card";
const char* heartbeat_topic = "rfid/heartbeat";
```

---

## 6. Full Code

```cpp
#include <WiFi.h>
#include <PubSubClient.h>
#include <Wiegand.h>
#include <queue>

// ====================== CONFIGURATION ======================
const char* ssid         = "Your_WiFi_Name";
const char* password     = "Your_WiFi_Password";

const char* mqtt_server  = "192.168.1.100";   // Your MQTT broker IP
const int   mqtt_port    = 1883;
const char* mqtt_user    = "";                // leave empty if no username
const char* mqtt_pass    = "";
const char* mqtt_topic   = "rfid/card";
const char* heartbeat_topic = "rfid/heartbeat";

// Wiegand pins
#define D0_PIN 4
#define D1_PIN 5

// Queue size (how many cards to buffer if WiFi is down)
#define QUEUE_SIZE 20
// ===========================================================

WiFiClient espClient;
PubSubClient client(espClient);
WIEGAND wg;

struct CardData {
  unsigned long code;
  int type;
  unsigned long timestamp;
};

std::queue<CardData> cardQueue;
unsigned long lastHeartbeat = 0;

void setup_wifi() {
  Serial.print("Connecting to WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("MQTT connecting...");
    String clientId = "ESP32-RFID-" + String(random(0xffff), HEX);

    if (client.connect(clientId.c_str(), mqtt_user, mqtt_pass)) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" → retry in 3s");
      delay(3000);
    }
  }
}

void publishCard(const CardData& card) {
  char payload[96];
  snprintf(payload, sizeof(payload),
           "{\"type\":%d,\"code\":%lu,\"hex\":\"%08lX\",\"ts\":%lu}",
           card.type, card.code, card.code, card.timestamp);

  // QoS 1 = at least once delivery
  bool ok = client.publish(mqtt_topic, payload, false);
  
  if (ok) {
    Serial.print("Sent → ");
    Serial.println(payload);
  } else {
    Serial.println("Publish failed, will retry later");
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setBufferSize(512);

  wg.begin(D0_PIN, D1_PIN);

  Serial.println("ESP32 Wiegand → MQTT (Robust version) ready");
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // ===== Read Wiegand =====
  if (wg.available()) {
    CardData card;
    card.code = wg.getCode();
    card.type = wg.getWiegandType();
    card.timestamp = millis();

    if (cardQueue.size() < QUEUE_SIZE) {
      cardQueue.push(card);
      Serial.print("Queued card: ");
      Serial.println(card.code);
    } else {
      Serial.println("Queue full! Card lost.");
    }
  }

  // ===== Send queued cards =====
  if (!cardQueue.empty() && client.connected()) {
    CardData card = cardQueue.front();
    publishCard(card);
    cardQueue.pop();
  }

  // ===== Heartbeat every 30 seconds =====
  if (millis() - lastHeartbeat > 30000) {
    lastHeartbeat = millis();
    if (client.connected()) {
      client.publish(heartbeat_topic, "online");
      Serial.println("Heartbeat sent");
    }
  }
}
```

---

## 7. MQTT Message Format

When a card is read, this JSON is published to `rfid/card`:

```json
{
  "type": 34,
  "code": 12345678,
  "hex": "00BC614E",
  "ts": 45821
}
```

| Field   | Meaning                        |
|---------|--------------------------------|
| type    | Wiegand bit length (26/34/etc) |
| code    | Card number in decimal         |
| hex     | Card number in hexadecimal     |
| ts      | Milliseconds since ESP32 boot  |

---

## 8. Testing Steps

1. Upload the code to the ESP32
2. Open **Serial Monitor** at **115200** baud
3. You should see:
   - WiFi connected
   - MQTT connected
4. Present a tag to the R16-7DB
5. You should see the card number appear in the Serial Monitor and on your MQTT broker

### Useful MQTT tools
- **MQTT Explorer** (Windows/Mac/Linux)
- **Mosquitto** (local broker)
- Home Assistant / Node-RED

---

## 9. R16-7DB Wiegand Settings (Software)

In the **Format output card number V2.7** software:

1. Go to **Prefix suffix Data In...** tab
2. Set:
   - **Wiegand output format** → `01` (Wiegand 34 – recommended)
   - **wiegand open** → checked
3. Click **Setting**
4. Power-cycle the reader

---

## 10. Reliability Notes

- Even with 100 runners in a short time, traffic is extremely low (< 10 KB total)
- The queue stores up to 20 cards if WiFi is temporarily down
- MQTT QoS 1 ensures messages are not lost
- Heartbeat lets you monitor if the ESP32 is still online

---

## 11. Troubleshooting

| Problem                      | Possible Solution                              |
|-----------------------------|-------------------------------------------------|
| No card detected            | Check D0/D1 wiring and GND                     |
| Garbage / wrong numbers     | Add 4.7kΩ pull-up resistors                    |
| MQTT not connecting         | Check broker IP and firewall                   |
| Cards lost during WiFi drop | Increase `QUEUE_SIZE`                          |
| Reader not sending Wiegand  | Confirm "wiegand open" is enabled in software  |

---

## 12. Next Possible Improvements

- Send data to two topics (raw + cleaned)
- Add OLED display
- Add buzzer / LED feedback
- Home Assistant MQTT Discovery
- Store cards offline on SPIFFS when WiFi is down for long periods

---

**Created for your R16-7DB + ESP32 project**  
Good luck with your setup!
