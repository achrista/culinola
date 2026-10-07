import { describe, expect, it } from 'vitest';
import { loginResponse, parseCalls, parseMonitorLine, parseSession } from './fritz.ts';

describe('loginResponse', () => {
  // Beide Beispiele stammen aus der Beschreibung des Anmeldeverfahrens von AVM
  it('beantwortet die Frage neuerer Geräte (PBKDF2)', () => {
    expect(loginResponse('2$10000$5A1711$2000$5A1722', '1example!')).toBe('5A1722$1798a1672bca7c6463d6b245f82b53703b0f50813401b03e4045a5861e689adb');
  });

  it('beantwortet die Frage älterer Geräte (MD5)', () => {
    expect(loginResponse('1234567z', 'äbc')).toBe('1234567z-9e224a41eeefa284df7bb0f26c2913e2');
  });

  it('meldet eine Frage in unbekannter Form', () => {
    expect(() => loginResponse('2$10000$5A1711', 'x')).toThrow(/unbekannter Form/);
  });
});

describe('parseSession', () => {
  it('liest Sitzung, Frage und Sperrzeit', () => {
    expect(parseSession('<?xml version="1.0"?><SessionInfo><SID>0000000000000000</SID><Challenge>2$60000$ab$6000$cd</Challenge><BlockTime>12</BlockTime><Users><User last="1">kueche</User></Users></SessionInfo>')).toEqual({ sid: '0000000000000000', challenge: '2$60000$ab$6000$cd', blockSeconds: 12 });
    expect(parseSession('<html>keine FRITZ!Box</html>')).toEqual({ sid: '', challenge: '', blockSeconds: 0 });
  });
});

describe('parseCalls', () => {
  const call = (fields: Record<string, string>) => `<Call>${Object.entries(fields).map(([key, value]) => `<${key}>${value}</${key}>`).join('')}</Call>`;
  const xml = (...calls: string[]) => `<?xml version="1.0" encoding="UTF-8"?><root><timestamp>1791397000</timestamp>${calls.join('')}</root>`;
  const at = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).toISOString();

  it('liest eingehende, verpasste und ausgehende Anrufe mit der Nummer der Gegenseite', () => {
    const { calls, recordings } = parseCalls(
      xml(
        call({ Id: '31', Type: '1', Caller: '0821123456', Called: '987654', Name: 'Tante Rosa', Device: 'Küche', Port: '10', Date: '07.10.26 18:30', Duration: '0:12', Path: '' }),
        call({ Id: '30', Type: '2', Caller: '', Called: '987654', Name: '', Device: '', Port: '-1', Date: '07.10.26 09:05', Duration: '0:00' }),
        call({ Id: '29', Type: '3', Caller: '987654', Called: '08955512', Name: 'Praxis', Device: 'Büro', Port: '11', Date: '06.10.26 14:00', Duration: '1:03' }),
        call({ Id: '28', Type: '10', Caller: '0900111', Called: '987654', Date: '05.10.26 03:15', Duration: '0:00' }),
      ),
    );
    expect(calls).toEqual([
      { id: '31', kind: 'incoming', number: '0821123456', name: 'Tante Rosa', date: at(7, 18, 30), minutes: 12, device: 'Küche', voicemail: false },
      { id: '30', kind: 'missed', number: '', name: '', date: at(7, 9, 5), minutes: 0, device: '', voicemail: false },
      { id: '29', kind: 'outgoing', number: '08955512', name: 'Praxis', date: at(6, 14, 0), minutes: 63, device: 'Büro', voicemail: false },
      { id: '28', kind: 'rejected', number: '0900111', name: '', date: at(5, 3, 15), minutes: 0, device: '', voicemail: false },
    ]);
    expect(recordings.size).toBe(0);
  });

  it('erkennt Nachrichten des Anrufbeantworters und behält deren Pfad für sich', () => {
    const { calls, recordings } = parseCalls(
      xml(
        call({ Id: '40', Type: '1', Caller: '0171555', Name: 'Jonas', Device: 'Anrufbeantworter 1', Port: '40', Date: '07.10.26 12:00', Duration: '0:01', Path: '/download.lua?path=/data/tam/rec/rec.0.007' }),
        call({ Id: '39', Type: '1', Caller: '0821999', Device: 'Faxfunktion', Port: '5', Date: '07.10.26 11:00', Duration: '0:01', Path: '/download.lua?path=/var/media/ftp/FRITZ/faxbox/07.10.26_11.00_Telefax.pdf' }),
      ),
    );
    expect(calls.map((entry) => [entry.id, entry.voicemail])).toEqual([['40', true], ['39', false]]);
    expect([...recordings]).toEqual([['40', '/download.lua?path=/data/tam/rec/rec.0.007']]);
    // Der Pfad gehört nicht in das, was die Anzeige bekommt
    expect(JSON.stringify(calls)).not.toContain('download.lua');
  });

  it('kommt mit einer leeren Liste und mit einem einzelnen Eintrag zurecht', () => {
    expect(parseCalls(xml()).calls).toEqual([]);
    expect(parseCalls(xml(call({ Id: '1', Type: '2', Caller: '0821', Date: '01.10.26 08:00', Duration: '0:00' }))).calls).toHaveLength(1);
    expect(parseCalls('<html>Anmeldung nötig</html>').calls).toEqual([]);
  });
});

describe('parseMonitorLine', () => {
  it('liest die Ereignisse des Anrufmonitors', () => {
    expect(parseMonitorLine('07.10.26 18:30:12;RING;0;0821123456;987654;SIP0;\r\n')).toEqual({ kind: 'ring', connection: '0', number: '0821123456' });
    expect(parseMonitorLine('07.10.26 18:30:20;CONNECT;0;10;0821123456;')).toEqual({ kind: 'connect', connection: '0', number: '' });
    expect(parseMonitorLine('07.10.26 18:31:00;DISCONNECT;0;40;')).toEqual({ kind: 'disconnect', connection: '0', number: '' });
    expect(parseMonitorLine('07.10.26 18:40:00;CALL;1;11;987654;08955512;SIP0;')).toMatchObject({ kind: 'call', connection: '1' });
    expect(parseMonitorLine('irgendwas')).toBeUndefined();
    expect(parseMonitorLine('')).toBeUndefined();
  });
});
