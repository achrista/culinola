import { describe, expect, it } from 'vitest';
import { go2rtcYaml, isStreamId, modeOf, tvSource, tvTemplates } from './streams.ts';

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

  it('schreibt eigene ffmpeg-Vorlagen neben den Pfad', () => {
    const withTemplates = go2rtcYaml({ apiPort: 1984, rtspPort: 8554, webrtcPort: 8555, ffmpeg: '/usr/bin/ffmpeg', templates: tvTemplates('vaapi') }, []);
    expect(withTemplates).toContain('ffmpeg:\n  bin: "/usr/bin/ffmpeg"\n  tv-vaapi-input: "-init_hw_device vaapi=va:/dev/dri/renderD128');
    expect(withTemplates).toMatch(/\n {2}tv-vaapi: ".*deinterlace_vaapi.*-c:v h264_vaapi/);
  });

  it('lässt den Abschnitt ffmpeg ohne Pfad und Vorlagen weg', () => {
    expect(go2rtcYaml({ apiPort: 1984, rtspPort: 8554, webrtcPort: 8555, templates: {} }, [])).not.toContain('ffmpeg:');
  });
});

describe('tvSource', () => {
  const tvh = 'http://tvh:9981/stream/channelid/1?profile=pass';

  it('rechnet ohne Grafikchip mit dem Prozessor um – deinterlaced und verkleinert', () => {
    expect(tvSource(tvh, 'cpu')).toBe(`ffmpeg:${tvh}#input=tv-input#video=h264#raw=-vf yadif=deint=interlaced,fps=25,scale=1024:576,setsar=1#audio=aac#audio=opus`);
    expect(tvTemplates('cpu')).toEqual({ 'tv-input': '-i {input}' });
  });

  it('bleibt bei einem fremden go2rtc bei dessen eigener Eingangsvorlage', () => {
    expect(tvSource(tvh, 'cpu', false)).toBe(`ffmpeg:${tvh}#video=h264#raw=-vf yadif=deint=interlaced,fps=25,scale=1024:576,setsar=1#audio=aac#audio=opus`);
  });

  it('liest ohne low_delay, damit B-Frames in der richtigen Reihenfolge erscheinen', () => {
    for (const engine of ['cpu', 'vaapi'] as const) for (const args of Object.values(tvTemplates(engine))) expect(args).not.toContain('low_delay');
  });

  it('verweist mit Grafikchip auf die eigenen Vorlagen', () => {
    const source = tvSource(tvh, 'vaapi');
    expect(source).toBe(`ffmpeg:${tvh}#input=tv-vaapi-input#video=tv-vaapi#audio=aac#audio=opus`);
    for (const name of ['tv-vaapi-input', 'tv-vaapi']) expect(tvTemplates('vaapi')).toHaveProperty([name]);
    expect(tvTemplates('vaapi')['tv-vaapi-input']).toContain('-i {input}');
  });

  it('lässt eine selbst geschriebene ffmpeg-Quelle unverändert', () => {
    expect(tvSource(`ffmpeg:${tvh}#video=copy`, 'vaapi')).toBe(`ffmpeg:${tvh}#video=copy`);
  });
});
