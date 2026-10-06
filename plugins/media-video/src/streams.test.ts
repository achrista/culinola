import { describe, expect, it } from 'vitest';
import { go2rtcYaml, isStreamId, modeOf } from './streams.ts';

describe('modeOf', () => {
  it('lässt HLS-Listen vom Browser abspielen', () => {
    expect(modeOf('https://example.org/live/master.m3u8')).toBe('hls');
    expect(modeOf('https://example.org/live/master.m3u8?token=1')).toBe('hls');
  });

  it('schickt Kameras und alles Übrige über go2rtc', () => {
    expect(modeOf('rtsp://kamera/stream')).toBe('webrtc');
    expect(modeOf('http://tvheadend:9981/stream/channelid/1?profile=pass')).toBe('webrtc');
    expect(modeOf('ffmpeg:http://tvheadend/stream#video=h264#audio=opus')).toBe('webrtc');
  });

  it('achtet eine ausdrückliche Vorgabe', () => {
    expect(modeOf('http://kamera:81/', 'mjpeg')).toBe('mjpeg');
  });
});

describe('isStreamId', () => {
  it('lässt Kleinbuchstaben, Ziffern und Bindestriche zu', () => {
    expect(isStreamId('kamera1')).toBe(true);
    expect(isStreamId('hit-rt1')).toBe(true);
  });

  it('lehnt alles ab, was eine Einstellungsdatei durcheinanderbrächte', () => {
    expect(isStreamId('Kamera 1')).toBe(false);
    expect(isStreamId('a: b')).toBe(false);
    expect(isStreamId('')).toBe(false);
    expect(isStreamId(undefined)).toBe(false);
  });
});

describe('go2rtcYaml', () => {
  const yaml = go2rtcYaml({ apiPort: 1984, rtspPort: 8554, webrtcPort: 8555, ffmpeg: 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe' }, [
    { id: 'kamera1', url: 'rtsp://benutzer:pass!wort@192.168.1.5:554/live?a=1&b=2' },
    { id: 'ts24', url: 'ffmpeg:http://tvh/stream#video=h264#audio=opus' },
  ]);

  it('bindet Verwaltung und interne Weitergabe an den eigenen Rechner', () => {
    expect(yaml).toContain('api:\n  listen: "127.0.0.1:1984"');
    expect(yaml).toContain('rtsp:\n  listen: "127.0.0.1:8554"');
  });

  it('setzt Adressen mit Sonderzeichen unverändert in Anführungszeichen', () => {
    expect(yaml).toContain('  kamera1: "rtsp://benutzer:pass!wort@192.168.1.5:554/live?a=1&b=2"');
    expect(yaml).toContain('  ts24: "ffmpeg:http://tvh/stream#video=h264#audio=opus"');
  });

  it('maskiert Rückstriche im Pfad zu ffmpeg', () => {
    expect(yaml).toContain('bin: "C:\\\\Program Files\\\\ffmpeg\\\\bin\\\\ffmpeg.exe"');
  });
});
