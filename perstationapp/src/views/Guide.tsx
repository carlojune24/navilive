import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const WIRING = [
  ["VCC", "3V3", "Power for the module. Never use VIN or 5V."],
  ["GND", "GND", "Common ground."],
  ["TXD", "RX2 (GPIO16)", "Data coming from the reader into the ESP32. Idle is clean (no bytes)."],
  ["RXD", "TX2 (GPIO17)", "Data going back to the reader (optional)."],
];

const COMMANDS = [
  ["raw", "Print every frame the reader sends, in hex. Use this to check the reader is connected."],
  ["baud 115200", "Change the reader baud rate (try 9600, 19200, 38400, 57600, 115200). Saved, then restarts."],
  ["ip 192.168.1.50", "Send reads to this laptop IP. Use only if automatic discovery fails."],
  ["ip auto", "Go back to automatic discovery."],
  ["reset", "Forget the WiFi and open the RaceReader-XXXX setup network again."],
];

const TROUBLE = [
  ["Reader never appears in Setup", "Laptop and ESP32 must be on the same WiFi. If the laptop cannot ping the ESP32, the router is isolating WiFi devices: turn on the laptop's Mobile hotspot (2.4 GHz) and join the ESP32 to it. Also allow TCP 4390 and UDP 4391 in Windows Firewall."],
  ["Reader is online but no tags show", "In the Serial Monitor type raw and tap a tag. Nothing printed: check the TXD to RX2 wire, try the other baud rates, then try a null-modem (crossover) DB9 cable. Garbage printed: wrong baud rate."],
  ["Tags show as long hex or unmapped", "That is the tag's own ID. Open Runners, tap Last scan to fill it in, and give it a bib number."],
  ["The same tag counts twice", "Repeat reads inside the debounce window are kept but marked Repeat. Raise the window in Data if runners linger at the antenna."],
  ["EN and BOOT do not reset it", "Do not hold BOOT while pressing EN: that is flashing mode and the program never starts. Press EN first, then hold BOOT for 2 seconds while the blue LED blinks (see Change WiFi). Or type reset in the Serial Monitor."],
  ["Upload fails in Arduino IDE", "Board: ESP32 Dev Module, correct COM port, and hold BOOT while it says Connecting. The CP210x driver must be installed."],
];

function Section({ title, children, open: initial = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="border-t-2 border-ink first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-accent"
      >
        <span className="font-bib text-3xl">{title}</span>
        <ChevronDown className={cn("size-6 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}

export function GuidePanel() {
  return (
    <section className="sheet p-5">
      <h2 className="font-bib text-4xl">HARDWARE GUIDE</h2>
      <p className="mb-3 mt-1 text-sm font-medium text-ink-soft">
        Reader (R16-7DB) to MAX3232 module to ESP32 to this laptop. Open a section to read it.
      </p>

      <Section title="WIRING" open>
        <p className="mb-3 font-medium">Unplug the ESP32 before wiring. Four wires between the MAX3232 module and the ESP32:</p>
        <table className="mb-3 w-full max-w-3xl border-2 border-ink text-left">
          <thead className="bg-ink text-sheet">
            <tr>
              <th className="px-3 py-2 text-sm font-bold uppercase">MAX3232 module</th>
              <th className="px-3 py-2 text-sm font-bold uppercase">ESP32 pin</th>
              <th className="px-3 py-2 text-sm font-bold uppercase">Note</th>
            </tr>
          </thead>
          <tbody>
            {WIRING.map(([a, b, c]) => (
              <tr key={a} className="border-t border-ink/20">
                <td className="px-3 py-2 font-bold">{a}</td>
                <td className="px-3 py-2 font-bold">{b}</td>
                <td className="px-3 py-2 font-medium">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="list-disc space-y-1 pl-6 font-medium">
          <li>TXD goes to RX2 and RXD to TX2. If the monitor fills with FF bytes that do not depend on tags, RX2 is connected to an undriven pin: that is noise, not data.</li>
          <li>Do not use the RX0 / TX0 pins. Those carry the USB connection.</li>
          <li>The DB9 plug goes to the reader's RS232 port. If no data ever arrives, use a null-modem (crossover) cable.</li>
          <li>Power the reader from its own 9-12 V supply. The ESP32 runs from USB (a laptop port or a power bank). Only ground is shared.</li>
        </ul>
      </Section>

      <Section title="FIRST-TIME SETUP">
        <ol className="list-decimal space-y-1.5 pl-6 font-medium">
          <li>Install the CP210x USB driver, then in Arduino IDE install the "esp32" board package and the "WiFiManager" (tzapu) library.</li>
          <li>Open esp32/race_reader_node/race_reader_node.ino, choose board "ESP32 Dev Module" and the COM port, and press Upload (the arrow, not the bug).</li>
          <li>On the first boot the ESP32 opens a WiFi network called RaceReader-XXXX. Join it from a phone or laptop; the setup page opens by itself (or go to 192.168.4.1).</li>
          <li>Choose the race WiFi and enter its password. Leave Laptop IP blank for automatic discovery. Set the Reader baud rate (start with 9600).</li>
          <li>This app must be running on a laptop on the same WiFi. The ESP32 appears under Readers above within a few seconds.</li>
          <li>Create your stations, assign each reader to its station, add runners, then tap a tag to test.</li>
        </ol>
        <p className="mt-3 border-2 border-ink p-3 text-sm font-semibold">
          Best for race day: turn on the laptop's Mobile hotspot (2.4 GHz) and join the ESP32 to it. It does not depend on venue WiFi.
        </p>
      </Section>

      <Section title="CHANGE WIFI (RESET THE ESP32)">
        <ol className="list-decimal space-y-1.5 pl-6 font-medium">
          <li>Press and release the <b>EN</b> button on the ESP32.</li>
          <li>The blue LED now blinks for 4 seconds. During that time, press and hold the <b>BOOT</b> button for 2 seconds.</li>
          <li>The ESP32 forgets the saved WiFi and opens the RaceReader-XXXX setup network. Join it and pick the new WiFi as in First-time setup.</li>
        </ol>
        <p className="mt-3 border-2 border-ink p-3 text-sm font-semibold">
          Do not hold BOOT while you press EN. That starts the ESP32 in flashing mode, so the reader program does not run at all. If nothing happens
          after EN, wait for the blinking, then hold BOOT. A short BOOT press is ignored, and with no press the ESP32 starts normally.
          Without the buttons, type reset in the Serial Monitor.
        </p>
      </Section>

      <Section title="SERIAL MONITOR COMMANDS">
        <p className="mb-3 font-medium">In Arduino IDE open Tools, Serial Monitor, set 115200 baud and "Newline", then type:</p>
        <dl className="grid max-w-3xl grid-cols-[200px_1fr] gap-y-2">
          {COMMANDS.map(([c, d]) => (
            <div key={c} className="contents">
              <dt className="font-bold">{c}</dt>
              <dd className="font-medium">{d}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="TROUBLESHOOTING">
        <dl className="max-w-3xl space-y-3">
          {TROUBLE.map(([q, a]) => (
            <div key={q}>
              <dt className="font-bold">{q}</dt>
              <dd className="font-medium text-ink-soft">{a}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </section>
  );
}
