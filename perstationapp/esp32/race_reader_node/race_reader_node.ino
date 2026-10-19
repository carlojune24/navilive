/*
 * Race Tracker reader node: R16-7DB UHF RFID reader (RS232) -> MAX3232 module -> ESP32 -> WiFi -> Race Tracker app.
 *
 * Wiring (ESP32 DevKit):
 *   MAX3232 module VCC -> 3V3        (the module works at 3.3 V; do NOT feed it 5 V into ESP32 pins)
 *   MAX3232 module GND -> GND
 *   MAX3232 module RXD -> GPIO16 (ESP32 RX2)     <- data coming FROM the reader
 *   MAX3232 module TXD -> GPIO17 (ESP32 TX2)     -> data going TO the reader (optional)
 *   Module DB9: pin 2 = driver output, pin 3 = receiver input, pin 5 = GND. The reader transmits on its
 *   pin 2, so wire reader pin 2 -> module pin 3 and GND -> GND, nothing else (do not wire straight
 *   through pin-for-pin: two outputs would fight). Power the reader from its own supply; share GND.
 *   The reader frames each tag as STX (02) + 10 ASCII digits + ETX (03), e.g. 0000000001.
 *
 * Delivery guarantee (why no read is lost):
 *   - Every tag read gets a sequence number and is appended to a flash journal (LittleFS) BEFORE sending.
 *   - Reads are POSTed to the app in batches. The app answers HTTP 200 only after the read is committed
 *     to SQLite. Only then does this node forget the read.
 *   - Any failure (WiFi down, app closed, reboot, power loss) just means the read is sent again later;
 *     the app ignores duplicates by (device, boot id, seq).
 *   - Reads are timestamped as "age at send time"; reads recovered after a reboot have unknown age and the
 *     app marks them "late time" (it falls back to arrival time).
 *
 * Arduino IDE: install "esp32 by Espressif Systems" and the library "WiFiManager" by tzapu.
 * Board: ESP32 Dev Module. Serial Monitor 115200 baud.
 *
 * To change WiFi later: press EN, then hold BOOT for 2 s while the blue LED blinks (not during the EN press; that is flashing mode).
 * First boot: it opens the WiFi network "RaceReader-XXXX". Join it, pick the race WiFi, enter its password,
 * the laptop's IP (leave blank to find the app automatically as racetracker.local) and the reader's baud
 * rate. Serial commands (type in Serial Monitor + Enter):
 *   reset        wipe WiFi settings and reopen the setup portal
 *   ip 192.168.1.50  set the laptop IP directly (saved); "ip auto" goes back to racetracker.local
 *   stat         show how many bytes the reader has sent so far
 *   pins         check whether anything is driving the RX2 pin
 *   autoloop     loopback test in BOTH pin orders (short DB9 pins 2 and 3 first)
 *   sweep        listen on both pin orders and all common baud rates; hold a tag near the reader
 *   swap         swap RX/TX pins in software (same as swapping the two wires), saved
 *   loop         loopback self-test (short DB9 pins 2 and 3 first)
 *   send 1B 02   send hex bytes to the reader
 *   baud 115200  change reader baud rate (saved)
 *   raw          toggle printing every raw frame (use this to learn the reader's output format)
 */

#include <WiFi.h>
#include <WiFiManager.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <WiFiUdp.h>
#include <esp_system.h>
#include <deque>

#define FW_VERSION "1.0.0"
#define READER_RX 16
#define READER_TX 17
uint8_t rxPin = READER_RX;  // can be swapped at runtime with the swap command
uint8_t txPin = READER_TX;
#define LED_PIN 2
#define BOOT_BUTTON_PIN 0

const uint16_t APP_PORT = 4390;
const uint16_t DISCOVERY_PORT = 4391;
const size_t MAX_PENDING = 3000;           // reads kept while the app is unreachable
const size_t BATCH_SIZE = 20;              // reads per POST
const uint8_t POST_FAILS_BEFORE_REDISCOVER = 4;  // consecutive failed posts before searching for the app again
const size_t MIN_TAG_LEN = 6;             // shorter frames are noise
const uint32_t FRAME_GAP_MS = 15;         // silence that ends a reader frame without a newline
const uint32_t SAME_TAG_SUPPRESS_MS = 1000; // ignore the reader re-sending one tag while it stays in range
const uint32_t HEARTBEAT_MS = 5000;
const uint32_t HTTP_TIMEOUT_MS = 2500;
const uint32_t CONNECT_TIMEOUT_MS = 800;
const char* JOURNAL = "/q.log";
const size_t JOURNAL_COMPACT_BYTES = 200 * 1024;

struct Pending {
  uint32_t seq;
  String boot;
  uint32_t ms;     // millis() at read time, valid only when boot == bootId
  String tag;
  String raw;
};

std::deque<Pending> pending;
String bootId;
String deviceId;
uint32_t seqCounter = 0;
uint8_t postFailures = 0;
size_t journalBytes = 0;

String appHost;          // resolved or configured app IP
String appHostOverride;  // from setup portal; empty = discover via mDNS
uint32_t readerBaud = 9600;
bool printRaw = false;
uint32_t rxTotal = 0;  // every byte ever received from the reader (for the stat command)

uint32_t lastPostAt = 0, lastResolveAt = 0, lastWifiRetryAt = 0, ledOffAt = 0;

// ---- reader frame assembly ---------------------------------------------------
uint8_t fbuf[160];
size_t flen = 0;
uint32_t lastByteAt = 0;

struct Recent { String tag; uint32_t at; };
Recent recent[8];

String toHex(const uint8_t* b, size_t n) {
  static const char* H = "0123456789ABCDEF";
  String s;
  s.reserve(n * 2);
  for (size_t i = 0; i < n; i++) {
    s += H[b[i] >> 4];
    s += H[b[i] & 15];
  }
  return s;
}

void journalAppend(const Pending& p) {
  File f = LittleFS.open(JOURNAL, "a");
  if (!f) return;
  String line = p.boot + "," + String(p.seq) + "," + String(p.ms) + "," + p.tag + "," + p.raw + "\n";
  f.print(line);
  journalBytes += line.length();
  f.close();
}

void journalRewrite() {
  if (pending.empty()) {
    LittleFS.remove(JOURNAL);
    journalBytes = 0;
    return;
  }
  File f = LittleFS.open("/q.tmp", "w");
  if (!f) return;
  size_t bytes = 0;
  for (const Pending& p : pending) {
    String line = p.boot + "," + String(p.seq) + "," + String(p.ms) + "," + p.tag + "," + p.raw + "\n";
    f.print(line);
    bytes += line.length();
  }
  f.close();
  LittleFS.remove(JOURNAL);
  LittleFS.rename("/q.tmp", JOURNAL);
  journalBytes = bytes;
}

void journalLoad() {
  File f = LittleFS.open(JOURNAL, "r");
  if (!f) return;
  while (f.available() && pending.size() < MAX_PENDING) {
    String line = f.readStringUntil('\n');
    line.trim();
    int c1 = line.indexOf(','), c2 = line.indexOf(',', c1 + 1), c3 = line.indexOf(',', c2 + 1), c4 = line.indexOf(',', c3 + 1);
    if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) continue;
    Pending p;
    p.boot = line.substring(0, c1);
    p.seq = line.substring(c1 + 1, c2).toInt();
    p.ms = line.substring(c2 + 1, c3).toInt();
    p.tag = line.substring(c3 + 1, c4);
    p.raw = line.substring(c4 + 1);
    pending.push_back(p);
  }
  journalBytes = f.size();
  f.close();
  Serial.printf("Recovered %u unsent reads from flash\n", (unsigned)pending.size());
}

void addRead(const String& tag, const String& raw) {
  Pending p;
  p.seq = ++seqCounter;
  p.boot = bootId;
  p.ms = millis();
  p.tag = tag;
  p.raw = raw;
  if (pending.size() >= MAX_PENDING) {
    Serial.println("!! queue full, oldest unsent read dropped");
    pending.pop_front();
  }
  journalAppend(p);   // persist first
  pending.push_back(p);
  digitalWrite(LED_PIN, HIGH);
  ledOffAt = millis() + 120;
  Serial.printf("READ #%u %s\n", p.seq, tag.c_str());
}

bool suppressedRepeat(const String& tag) {
  uint32_t now = millis();
  int slot = -1, oldest = 0;
  for (int i = 0; i < 8; i++) {
    if (recent[i].tag == tag) {
      bool dup = now - recent[i].at < SAME_TAG_SUPPRESS_MS;
      recent[i].at = now;  // stays suppressed while the reader keeps re-reading it
      return dup;
    }
    if (recent[i].at < recent[oldest].at) oldest = i;
    if (recent[i].tag.length() == 0 && slot < 0) slot = i;
  }
  if (slot < 0) slot = oldest;
  recent[slot].tag = tag;
  recent[slot].at = now;
  return false;
}

void finishFrame() {
  size_t n = flen;
  flen = 0;
  // trim control bytes and spaces: STX (02) / ETX (03) framing, CR, LF, NUL
  while (n > 0 && fbuf[n - 1] <= ' ') n--;
  size_t s = 0;
  while (s < n && fbuf[s] <= ' ') s++;
  if (n <= s) return;
  size_t len = n - s;

  bool printable = true;
  for (size_t i = s; i < n; i++) {
    if (!isalnum(fbuf[i])) { printable = false; break; }
  }
  String raw = toHex(fbuf + s, len > 64 ? 64 : len);
  if (printRaw) Serial.printf("FRAME %u bytes: %s%s\n", (unsigned)len, raw.c_str(), printable && len >= MIN_TAG_LEN ? "" : "  (rejected as noise)");
  // This reader sends STX + 10 ASCII digits + ETX. Anything else is line noise, not a tag read.
  if (!printable || len < MIN_TAG_LEN) return;
  String tag;
  for (size_t i = s; i < n && tag.length() < 64; i++) tag += (char)fbuf[i];
  tag.toUpperCase();
  if (suppressedRepeat(tag)) return;
  addRead(tag, raw);
}

void pollReader() {
  while (Serial2.available()) {
    int c = Serial2.read();
    if (c < 0) break;
    rxTotal++;
    if (c == 0x02) finishFrame();  // STX starts a new frame; flush anything left over
    if (flen < sizeof(fbuf)) fbuf[flen++] = (uint8_t)c;
    lastByteAt = millis();
    if (c == '\n' || c == 0x03) finishFrame();  // newline or ETX ends a frame
  }
  if (flen > 0 && millis() - lastByteAt >= FRAME_GAP_MS) finishFrame();
}

// ---- delivery ----------------------------------------------------------------
IPAddress discoverByBroadcast();
void resolveApp() {
  lastResolveAt = millis();
  if (appHostOverride.length() > 0) {
    appHost = appHostOverride;
    return;
  }
  IPAddress ip = MDNS.queryHost("racetracker", 1500);
  if (ip == IPAddress(0, 0, 0, 0)) ip = discoverByBroadcast();
  if (ip == IPAddress(0, 0, 0, 0)) {
    Serial.println("Race Tracker app not found yet (is it running? same WiFi? firewall allows UDP 4391?)");
    return;
  }
  appHost = ip.toString();
  Serial.printf("Found app at %s\n", appHost.c_str());
}

// Broadcast "RACETRACKER?" and take the app's address from whoever answers.
IPAddress discoverByBroadcast() {
  WiFiUDP udp;
  if (!udp.begin(DISCOVERY_PORT + 1)) return IPAddress(0, 0, 0, 0);
  IPAddress targets[2] = {WiFi.broadcastIP(), IPAddress(255, 255, 255, 255)};
  for (int attempt = 0; attempt < 2; attempt++) {
    for (int t = 0; t < 2; t++) {
      udp.beginPacket(targets[t], DISCOVERY_PORT);
      udp.print("RACETRACKER?");
      udp.endPacket();
    }
    uint32_t start = millis();
    while (millis() - start < 700) {
      int n = udp.parsePacket();
      if (n > 0) {
        char buf[32];
        int len = udp.read(buf, sizeof(buf) - 1);
        buf[len > 0 ? len : 0] = 0;
        if (strncmp(buf, "RACETRACKER", 11) == 0) {
          IPAddress from = udp.remoteIP();
          // only accept an app on our own subnet: a reply from another network (VPN, hotspot, second
          // router) would be an address we cannot reach reliably
          if ((uint32_t)from != 0 && ((uint32_t)from & (uint32_t)WiFi.subnetMask()) != ((uint32_t)WiFi.localIP() & (uint32_t)WiFi.subnetMask())) {
            Serial.printf("ignoring app reply from %s (different network)\n", from.toString().c_str());
            continue;
          }
          udp.stop();
          return from;
        }
      }
      delay(10);
      pollReader();  // never stop listening to the reader while searching
    }
  }
  udp.stop();
  return IPAddress(0, 0, 0, 0);
}

String ssidClean() {
  String s = WiFi.SSID();
  s.replace("\"", "_");
  s.replace("\\", "_");
  return s;
}

bool postBatch() {
  size_t n = pending.size() < BATCH_SIZE ? pending.size() : BATCH_SIZE;
  String body = "{\"device_id\":\"" + deviceId + "\",\"boot_id\":\"" + bootId + "\",\"fw\":\"" FW_VERSION "\",\"ssid\":\"" + ssidClean() + "\",\"queue\":" +
                String((unsigned)pending.size()) + ",\"reads\":[";
  uint32_t now = millis();
  for (size_t i = 0; i < n; i++) {
    const Pending& p = pending[i];
    long age = (p.boot == bootId) ? (long)(now - p.ms) : -1;  // -1 = unknown (recovered after reboot)
    if (i) body += ",";
    body += "{\"seq\":" + String(p.seq) + ",\"age_ms\":" + String(age) + ",\"tag\":\"" + p.tag + "\",\"raw\":\"" + p.raw + "\"}";
  }
  body += "]}";

  HTTPClient http;
  http.setConnectTimeout(CONNECT_TIMEOUT_MS);  // short: a stalled connect is retried at once below
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin("http://" + appHost + ":" + String(APP_PORT) + "/ingest");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  if (code < 0) {  // connection-level failure: retry once straight away, it is usually a one-off hiccup
    delay(150);
    pollReader();
    code = http.POST(body);
  }
  http.end();

  if (code == 200) {
    postFailures = 0;
    for (size_t i = 0; i < n; i++) pending.pop_front();  // committed in SQLite: safe to forget
    if (pending.empty() || journalBytes > JOURNAL_COMPACT_BYTES) journalRewrite();
    return true;
  }
  Serial.printf("POST failed (%d), will retry; %u reads kept, WiFi %d dBm\n", code, (unsigned)pending.size(), (int)WiFi.RSSI());
  // One failed post is usually a WiFi hiccup. Only forget the app address after several in a row.
  if (++postFailures >= POST_FAILS_BEFORE_REDISCOVER && appHostOverride.length() == 0) {
    appHost = "";  // app IP may have changed: re-discover
    postFailures = 0;
  }
  return false;
}

// ---- setup / loop ------------------------------------------------------------
bool portalSaved = false;
void onPortalSaved() { portalSaved = true; }

void connectWifi(bool forceReprovision) {
  WiFiManager wm;
  if (forceReprovision) wm.resetSettings();

  Preferences prefs;
  prefs.begin("racereader", true);
  String savedIp = prefs.getString("app_ip", "");
  String savedBaud = String(prefs.getUInt("baud", 9600));
  prefs.end();

  WiFiManagerParameter ipParam("app_ip", "Laptop IP (blank = find racetracker.local)", savedIp.c_str(), 15);
  WiFiManagerParameter baudParam("baud", "Reader baud rate", savedBaud.c_str(), 7);
  wm.addParameter(&ipParam);
  wm.addParameter(&baudParam);
  wm.setSaveParamsCallback(onPortalSaved);
  wm.setSaveConfigCallback(onPortalSaved);  // fires after WiFi + custom fields are submitted
  wm.setConfigPortalTimeout(180);

  String apName = "RaceReader-" + WiFi.macAddress().substring(12);
  apName.replace(":", "");
  Serial.printf("Connecting to saved WiFi, or opening setup network \"%s\"\n", apName.c_str());
  if (!wm.autoConnect(apName.c_str())) {
    Serial.println("No WiFi: restarting");
    delay(1000);
    ESP.restart();
  }
  appHostOverride = savedIp;
  readerBaud = savedBaud.toInt();
  if (portalSaved) {
    appHostOverride = String(ipParam.getValue());
    readerBaud = String(baudParam.getValue()).toInt();
    prefs.begin("racereader", false);
    prefs.putString("app_ip", appHostOverride);
    prefs.putUInt("baud", readerBaud);
    prefs.end();
  }
  if (readerBaud < 1200) readerBaud = 9600;
  Serial.printf("App address: %s\n", appHostOverride.length() ? appHostOverride.c_str() : "(auto: racetracker.local)");
  Serial.printf("WiFi connected, IP %s\n", WiFi.localIP().toString().c_str());
}

// ---- wiring diagnostics --------------------------------------------------------
bool loopOnce(uint8_t rx, uint8_t tx, uint32_t baud) {
  Serial2.end();
  Serial2.begin(baud, SERIAL_8N1, rx, tx);
  delay(20);
  while (Serial2.available()) Serial2.read();
  Serial2.print("HELLO123");
  Serial2.flush();
  delay(300);
  String got;
  while (Serial2.available()) got += (char)Serial2.read();
  return got.indexOf("HELLO123") >= 0;
}

void restoreUart() {
  Serial2.end();
  Serial2.begin(readerBaud, SERIAL_8N1, rxPin, txPin);
}

// autoloop: try both pin orders with the loopback in place (short DB9 pins 2 and 3 first)
void autoLoop() {
  bool a = loopOnce(READER_RX, READER_TX, readerBaud);
  bool b = loopOnce(READER_TX, READER_RX, readerBaud);
  Serial.println(String("loopback with RX=GPIO16/TX=GPIO17 (normal): ") + (a ? "OK" : "nothing"));
  Serial.println(String("loopback with RX=GPIO17/TX=GPIO16 (swapped): ") + (b ? "OK" : "nothing"));
  if (a && !b) Serial.println("=> wiring is right as it is. Nothing to change.");
  else if (b && !a) Serial.println("=> your module needs the swapped order. Type swap, and the board will remember it.");
  else if (a && b) Serial.println("=> both orders loop (RX and TX are probably joined directly). Remove that and try again.");
  else Serial.println("=> neither order works: the module path is not looping. Check VCC/GND, the wires and DB9 pins 2 and 3.");
  restoreUart();
}

// sweep: listen on every pin order and baud rate for a few seconds each. Hold a tag in front of the reader.
void sweepReader() {
  const uint32_t bauds[] = {9600, 115200, 57600, 38400, 19200, 4800};
  Serial.println("sweep: keep a tag in front of the reader for about 40 seconds");
  for (int m = 0; m < 2; m++) {
    uint8_t rx = m == 0 ? READER_RX : READER_TX;
    uint8_t tx = m == 0 ? READER_TX : READER_RX;
    for (size_t i = 0; i < sizeof(bauds) / sizeof(bauds[0]); i++) {
      Serial2.end();
      Serial2.begin(bauds[i], SERIAL_8N1, rx, tx);
      delay(20);
      while (Serial2.available()) Serial2.read();
      uint32_t start = millis(), count = 0;
      String first;
      while (millis() - start < 3000) {
        while (Serial2.available()) {
          int c = Serial2.read();
          if (c < 0) break;
          if (first.length() < 40) {
            char h[4];
            snprintf(h, sizeof(h), "%02X ", c);
            first += h;
          }
          count++;
        }
        delay(5);
      }
      Serial.println(String("RX=GPIO") + rx + " baud " + bauds[i] + ": " + count + " bytes  " + first);
    }
  }
  Serial.println("sweep done. Real data looks like 30 30 30 ... 0D 0A (digits, then 0D 0A). Mostly FF is noise.");
  restoreUart();
}

void handleSerialCommands() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.equalsIgnoreCase("reset")) {
    WiFiManager wm;
    wm.resetSettings();
    delay(300);
    ESP.restart();
  } else if (line.equalsIgnoreCase("raw")) {
    printRaw = !printRaw;
    Serial.printf("raw frame printing %s\n", printRaw ? "ON" : "OFF");
  } else if (line.equalsIgnoreCase("stat")) {
    Serial.println(String("bytes received from reader so far: ") + rxTotal + ", baud " + readerBaud);
  } else if (line.equalsIgnoreCase("pins")) {
    // Is something actually driving the RX pin? A connected, powered module holds the pin at one level
    // whichever pull resistor we apply; an unconnected pin just follows the pull resistor.
    Serial2.end();
    pinMode(rxPin, INPUT_PULLDOWN);
    delay(20);
    int withPulldown = digitalRead(rxPin);
    pinMode(rxPin, INPUT_PULLUP);
    delay(20);
    int withPullup = digitalRead(rxPin);
    Serial2.begin(readerBaud, SERIAL_8N1, rxPin, txPin);
    Serial.println(String("RX2 (GPIO16) with pulldown=") + withPulldown + ", with pullup=" + withPullup);
    if (withPulldown == 1 && withPullup == 1) Serial.println("=> driven HIGH: the module is connected and powered (normal idle level)");
    else if (withPulldown == 0 && withPullup == 0) Serial.println("=> driven LOW: connected, but the module is unpowered or the line is stuck low");
    else Serial.println("=> FLOATING: nothing is driving RX2. The TXD wire is not connected, or not on RX2");
  } else if (line.equalsIgnoreCase("autoloop")) {
    autoLoop();
  } else if (line.equalsIgnoreCase("sweep")) {
    sweepReader();
  } else if (line.equalsIgnoreCase("swap")) {
    Preferences sp;
    sp.begin("racereader", false);
    bool now = !sp.getBool("swap", false);
    sp.putBool("swap", now);
    sp.end();
    Serial.println(String("RX/TX pin order is now ") + (now ? "swapped (RX=GPIO17, TX=GPIO16)" : "normal (RX=GPIO16, TX=GPIO17)") + ", restarting");
    delay(300);
    ESP.restart();
  } else if (line.equalsIgnoreCase("loop")) {
    // Short DB9 pins 2 and 3 together, then type loop: proves ESP32 + wires + MAX3232 module.
    while (Serial2.available()) Serial2.read();
    Serial2.print("HELLO123");
    Serial2.flush();
    delay(300);
    String got;
    while (Serial2.available()) got += (char)Serial2.read();
    Serial.println(got.length() ? String("loopback OK, got: ") + got : String("loopback: nothing received"));
  } else if (line.startsWith("send ")) {
    // send 1B 02 ... : write hex bytes to the reader (some readers only answer when asked)
    String h = line.substring(5);
    int n = 0;
    for (size_t i = 0; i + 1 < h.length();) {
      if (h[i] == ' ') { i++; continue; }
      Serial2.write((uint8_t)strtol(h.substring(i, i + 2).c_str(), NULL, 16));
      n++;
      i += 2;
    }
    Serial.println(String("sent ") + n + " bytes to reader");
  } else if (line.startsWith("ip ")) {
    String ip = line.substring(3);
    ip.trim();
    if (ip == "auto") ip = "";
    Preferences prefs;
    prefs.begin("racereader", false);
    prefs.putString("app_ip", ip);
    prefs.end();
    Serial.printf("app ip set to \"%s\", restarting\n", ip.c_str());
    delay(300);
    ESP.restart();
  } else if (line.startsWith("baud ")) {
    uint32_t b = line.substring(5).toInt();
    if (b >= 1200) {
      Preferences prefs;
      prefs.begin("racereader", false);
      prefs.putUInt("baud", b);
      prefs.end();
      Serial.printf("baud set to %u, restarting\n", (unsigned)b);
      delay(300);
      ESP.restart();
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed: reads will not survive a reboot!");

  char buf[9];
  snprintf(buf, sizeof(buf), "%08x", (unsigned)esp_random());
  bootId = String(buf);

  // Re-open the setup portal: press EN, then once the LED starts blinking hold BOOT for 2 s (blink window: 4 s).
  // Do NOT hold BOOT while pressing EN: GPIO0 low at reset puts the ESP32 in flashing mode and this sketch never runs.
  Serial.println("Hold BOOT for 2 s now to reopen WiFi setup...");
  bool hold = false;
  for (uint32_t t = millis(); millis() - t < 4000 && !hold;) {
    digitalWrite(LED_PIN, (millis() / 150) % 2);
    if (digitalRead(BOOT_BUTTON_PIN) == LOW) {
      uint32_t down = millis();
      while (digitalRead(BOOT_BUTTON_PIN) == LOW && millis() - down < 2000) delay(20);
      hold = digitalRead(BOOT_BUTTON_PIN) == LOW;  // still down after 2 s; a shorter press is ignored
    }
    delay(20);
  }
  digitalWrite(LED_PIN, LOW);
  connectWifi(hold);
  deviceId = WiFi.macAddress();
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);  // modem sleep drops incoming/outgoing packets now and then
  MDNS.begin("racetracker-reader");

  Serial2.setRxBufferSize(2048);
  {
    Preferences sp;
    sp.begin("racereader", true);
    if (sp.getBool("swap", false)) { rxPin = READER_TX; txPin = READER_RX; }
    sp.end();
  }
  Serial2.begin(readerBaud, SERIAL_8N1, rxPin, txPin);
  Serial.printf("Reader UART at %u baud 8N1. Device %s boot %s\n", (unsigned)readerBaud, deviceId.c_str(), bootId.c_str());

  journalLoad();
  resolveApp();
}

void loop() {
  pollReader();           // always first: never block the reader
  handleSerialCommands();
  if (ledOffAt && millis() > ledOffAt) { digitalWrite(LED_PIN, LOW); ledOffAt = 0; }

  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiRetryAt > 5000) {
      lastWifiRetryAt = millis();
      WiFi.reconnect();
    }
    return;  // reads keep being journaled above
  }
  if (appHost.isEmpty()) {
    if (millis() - lastResolveAt > 5000) resolveApp();
    return;
  }
  bool due = !pending.empty() ? (millis() - lastPostAt > 100) : (millis() - lastPostAt > HEARTBEAT_MS);
  if (due) {
    postBatch();
    lastPostAt = millis();
  }
}
