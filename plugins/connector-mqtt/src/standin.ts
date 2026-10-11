import { createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import mqttPacket from 'mqtt-packet';
import { topicMatches } from './mapping.ts';

/**
 * Ein Platzhalter für einen MQTT-Broker, nur für Tests und die Testinstanz: Er nimmt Verbindungen an, prüft
 * Benutzer und Kennwort, verteilt Nachrichten an Abonnenten und merkt sich die, die liegen bleiben sollen.
 * Dazu spielt er ein Gerät nach, wie Tasmota eines wäre: einen Luftsensor und ein schaltbares Licht, die
 * sich selbst anmelden. Er kann nur, was der Konnektor braucht – einfache Zustellung, keine Sitzungen.
 */
export interface StandIn {
  url: string;
  account: { username: string; password: string };
  /** Sendet eine Nachricht, als käme sie von einem Gerät. */
  publish(topic: string, payload: string, retain?: boolean): void;
  /** Alles, was Clients gesendet haben, in der Reihenfolge des Eintreffens. */
  received: { topic: string; payload: string; retain: boolean }[];
  /** Trennt alle Verbindungen, wie es ein Neustart des Brokers täte. */
  dropClients(): void;
  /** Zahl der angenommenen Anmeldungen. */
  logins(): number;
  close(): Promise<void>;
}

export const DISCOVERY = 'homeassistant';

/** Die Anmeldungen des nachgespielten Geräts – in den Kurzformen, die echte Geräte benutzen. */
const ANNOUNCED: [topic: string, config: Record<string, unknown>][] = [
  [`${DISCOVERY}/sensor/4E3812_CO2/config`, { name: 'Luft CO₂', stat_t: 'luft/tele/SENSOR', avty_t: 'luft/tele/LWT', pl_avail: 'Online', pl_not_avail: 'Offline', uniq_id: '4E3812_CO2', unit_of_meas: 'ppm', val_tpl: "{{value_json['MHZ19B']['CarbonDioxide']}}" }],
  [`${DISCOVERY}/sensor/4E3812_T/config`, { name: 'Luft Temperatur', '~': 'luft', stat_t: '~/tele/SENSOR', avty_t: '~/tele/LWT', pl_avail: 'Online', pl_not_avail: 'Offline', uniq_id: '4E3812_T', unit_of_meas: '°C', val_tpl: '{{value_json.MHZ19B.Temperature}}' }],
  [`${DISCOVERY}/sensor/4E3812_Signal/config`, { name: 'Luft Empfang', stat_t: 'luft/tele/STATE', uniq_id: '4E3812_Signal', unit_of_meas: '%', val_tpl: "{{value_json['Wifi']['RSSI'] | int}}" }],
  [`${DISCOVERY}/switch/A1B2C3_RL_1/config`, { name: 'Nachtlicht', stat_t: 'nachtlicht/tele/STATE', cmd_t: 'nachtlicht/cmnd/POWER', avty_t: 'nachtlicht/tele/LWT', pl_avail: 'Online', pl_not_avail: 'Offline', pl_on: 'ON', pl_off: 'OFF', uniq_id: 'A1B2C3_RL_1', val_tpl: '{{value_json.POWER}}' }],
  [`${DISCOVERY}/climate/heizung/config`, { name: 'Heizung' }],
];

export async function startStandIn(port = 0): Promise<StandIn> {
  const account = { username: 'kueche', password: 'nur-fuer-den-platzhalter' };
  const clients = new Map<Socket, string[]>();
  const retained = new Map<string, string>();
  const received: StandIn['received'] = [];
  let logins = 0;
  let power = 'OFF';
  let co2 = 640;

  const deliver = (topic: string, payload: string, retain = false) => {
    if (retain) {
      if (payload) retained.set(topic, payload);
      else retained.delete(topic);
    }
    const packet = mqttPacket.generate({ cmd: 'publish', topic, payload: Buffer.from(payload), qos: 0, dup: false, retain: false });
    for (const [socket, filters] of clients) if (filters.some((filter) => topicMatches(filter, topic))) socket.write(packet);
  };

  // Das nachgespielte Gerät: Anmeldung, Erreichbarkeit und erste Werte liegen auf dem Broker bereit
  for (const [topic, config] of ANNOUNCED) retained.set(topic, JSON.stringify(config));
  retained.set('luft/tele/LWT', 'Online');
  retained.set('nachtlicht/tele/LWT', 'Online');
  const sensor = () => JSON.stringify({ Time: new Date().toISOString().slice(0, 19), MHZ19B: { Model: 'B', CarbonDioxide: co2, Temperature: 21.5 }, TempUnit: 'C' });
  const stateOf = () => JSON.stringify({ POWER: power, Wifi: { RSSI: 72 } });
  retained.set('luft/tele/SENSOR', sensor());
  retained.set('nachtlicht/tele/STATE', stateOf());
  const beat = setInterval(() => {
    co2 = 600 + Math.round(Math.random() * 200);
    deliver('luft/tele/SENSOR', sensor(), true);
  }, 10_000);

  const server = createServer((socket) => {
    const parser = mqttPacket.parser({ protocolVersion: 4 });
    socket.on('data', (chunk) => parser.parse(chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => void clients.delete(socket));
    parser.on('error', () => socket.destroy());
    parser.on('packet', (packet) => {
      if (packet.cmd === 'connect') {
        const ok = packet.username === account.username && packet.password?.toString() === account.password;
        socket.write(mqttPacket.generate({ cmd: 'connack', returnCode: ok ? 0 : 4, sessionPresent: false }));
        if (!ok) return void socket.end();
        logins++;
        clients.set(socket, []);
      } else if (!clients.has(socket)) {
        socket.destroy();
      } else if (packet.cmd === 'subscribe') {
        const filters = packet.subscriptions.map((entry) => entry.topic);
        clients.get(socket)!.push(...filters);
        socket.write(mqttPacket.generate({ cmd: 'suback', messageId: packet.messageId!, granted: filters.map(() => 0) }));
        // Was liegen geblieben ist, bekommt ein neuer Abonnent sofort
        for (const [topic, payload] of retained) {
          if (filters.some((filter) => topicMatches(filter, topic))) socket.write(mqttPacket.generate({ cmd: 'publish', topic, payload: Buffer.from(payload), qos: 0, dup: false, retain: true }));
        }
      } else if (packet.cmd === 'publish') {
        const payload = packet.payload.toString();
        received.push({ topic: packet.topic, payload, retain: packet.retain });
        deliver(packet.topic, payload, packet.retain);
        // Das Gerät schaltet und meldet seinen neuen Stand
        if (packet.topic === 'nachtlicht/cmnd/POWER') {
          power = /^(on|1)$/i.test(payload) ? 'ON' : /^(off|0)$/i.test(payload) ? 'OFF' : /^toggle$/i.test(payload) ? (power === 'ON' ? 'OFF' : 'ON') : power;
          deliver('nachtlicht/stat/POWER', power);
          deliver('nachtlicht/tele/STATE', stateOf(), true);
        }
      } else if (packet.cmd === 'pingreq') {
        socket.write(mqttPacket.generate({ cmd: 'pingresp' }));
      } else if (packet.cmd === 'disconnect') {
        socket.end();
      }
    });
  });
  await new Promise<void>((ready) => server.listen(port, '127.0.0.1', ready));

  return {
    url: `mqtt://127.0.0.1:${(server.address() as AddressInfo).port}`,
    account,
    received,
    publish: deliver,
    dropClients: () => {
      for (const socket of clients.keys()) socket.destroy();
    },
    logins: () => logins,
    close: () => {
      clearInterval(beat);
      for (const socket of clients.keys()) socket.destroy();
      return new Promise<void>((done) => server.close(() => done()));
    },
  };
}
