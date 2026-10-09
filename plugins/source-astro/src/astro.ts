/**
 * Sonne und Mond für einen Ort und einen Zeitpunkt – gerechnet nach den gebräuchlichen
 * Näherungsformeln der Himmelsmechanik. Genau genug für eine Anzeige: Sonnenzeiten auf wenige
 * Minuten, die Mondphase auf einige Stunden.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
/** Schiefe der Erdachse. */
const OBLIQUITY = 23.4397 * RAD;
/** Mittlere Dauer von Neumond zu Neumond in Tagen. */
const SYNODIC_MONTH = 29.530588853;
/** Ein Neumond als Bezugspunkt: 6. Januar 2000, 18:14 Uhr Weltzeit. */
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/** Tage seit dem 1. Januar 2000, 12 Uhr Weltzeit. */
const daysSince2000 = (time: number) => time / DAY_MS - 0.5 + J1970 - J2000;
const fromDays = (days: number) => (days + 0.5 - J1970 + J2000) * DAY_MS;

function sunCoordinates(days: number): { declination: number; rightAscension: number; anomaly: number; longitude: number } {
  const anomaly = (357.5291 + 0.98560028 * days) * RAD;
  const center = (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly)) * RAD;
  const longitude = anomaly + center + 102.9372 * RAD + Math.PI;
  return {
    declination: Math.asin(Math.sin(longitude) * Math.sin(OBLIQUITY)),
    rightAscension: Math.atan2(Math.sin(longitude) * Math.cos(OBLIQUITY), Math.cos(longitude)),
    anomaly,
    longitude,
  };
}

export interface SunPosition {
  /** Höhe über dem Horizont in Grad; unter dem Horizont negativ. */
  altitude: number;
  /** Himmelsrichtung in Grad: 0 Norden, 90 Osten, 180 Süden, 270 Westen. */
  azimuth: number;
}

export function sunPosition(time: number, latitude: number, longitude: number): SunPosition {
  const days = daysSince2000(time);
  const sun = sunCoordinates(days);
  const phi = latitude * RAD;
  const hourAngle = (280.16 + 360.9856235 * days) * RAD + longitude * RAD - sun.rightAscension;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(sun.declination) + Math.cos(phi) * Math.cos(sun.declination) * Math.cos(hourAngle));
  const fromSouth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(sun.declination) * Math.cos(phi));
  return { altitude: altitude / RAD, azimuth: (((fromSouth / RAD + 180) % 360) + 360) % 360 };
}

export interface SunTimes {
  /** Bürgerliche Dämmerung beginnt: Die Sonne steht 6 Grad unter dem Horizont. */
  dawn?: number;
  sunrise?: number;
  /** Höchststand. */
  noon: number;
  sunset?: number;
  dusk?: number;
}

/**
 * Die Sonnenzeiten des Tages, in den der Zeitpunkt am Ort fällt. Wo die Sonne an diesem Tag nicht
 * auf- oder untergeht – Polartag, Polarnacht –, fehlen die betreffenden Zeiten.
 */
export function sunTimes(time: number, latitude: number, longitude: number): SunTimes {
  const west = -longitude * RAD;
  const phi = latitude * RAD;
  const cycle = Math.round(daysSince2000(time) - 0.0009 - west / (2 * Math.PI));
  const approx = (hourAngle: number) => 0.0009 + (hourAngle + west) / (2 * Math.PI) + cycle;
  const sun = sunCoordinates(approx(0));
  const exact = (days: number) => J2000 + days + 0.0053 * Math.sin(sun.anomaly) - 0.0069 * Math.sin(2 * sun.longitude);
  const noonJulian = exact(approx(0));
  const toTime = (julian: number) => fromDays(julian - J2000);

  /** Wann die Sonne am Vor- und am Nachmittag auf dieser Höhe steht. */
  const crossing = (degrees: number): [number, number] | undefined => {
    const cosine = (Math.sin(degrees * RAD) - Math.sin(phi) * Math.sin(sun.declination)) / (Math.cos(phi) * Math.cos(sun.declination));
    if (cosine < -1 || cosine > 1) return undefined;
    const after = exact(approx(Math.acos(cosine)));
    return [toTime(noonJulian - (after - noonJulian)), toTime(after)];
  };
  // Auf- und Untergang: der obere Rand der Sonne am Horizont, mit der Lichtbrechung der Luft
  const horizon = crossing(-0.833);
  const civil = crossing(-6);
  return {
    noon: toTime(noonJulian),
    ...(horizon ? { sunrise: horizon[0], sunset: horizon[1] } : {}),
    ...(civil ? { dawn: civil[0], dusk: civil[1] } : {}),
  };
}

export interface Moon {
  /** Lauf durch den Mondmonat: 0 Neumond, 0,25 zunehmender Halbmond, 0,5 Vollmond, 0,75 abnehmender Halbmond. */
  phase: number;
  /** Beleuchteter Anteil der Scheibe, 0 bis 1. */
  illumination: number;
}

export function moon(time: number): Moon {
  const cycles = (time - NEW_MOON) / (SYNODIC_MONTH * DAY_MS);
  const phase = cycles - Math.floor(cycles);
  return { phase, illumination: (1 - Math.cos(2 * Math.PI * phase)) / 2 };
}

/** Der Name der Mondphase als Kennung – die Anzeige übersetzt ihn. */
export function moonPhaseName(phase: number): 'new' | 'waxing-crescent' | 'first-quarter' | 'waxing-gibbous' | 'full' | 'waning-gibbous' | 'last-quarter' | 'waning-crescent' {
  const names = ['new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter', 'waning-crescent'] as const;
  // Die vier Hauptphasen gelten für einen Tag um ihren Zeitpunkt, dazwischen liegen die Übergänge
  const width = 1 / SYNODIC_MONTH;
  for (const [index, at] of [0, 0.25, 0.5, 0.75].entries()) {
    const distance = Math.min(Math.abs(phase - at), 1 - Math.abs(phase - at));
    if (distance <= width / 2) return names[index * 2]!;
  }
  return names[Math.floor(phase * 4) * 2 + 1]!;
}
