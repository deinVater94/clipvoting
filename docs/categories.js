export const CATEGORIES = [
  { id: 'laugh', icon: '😂', title: 'Lachflash des Monats', subtitle: 'Der Moment, bei dem niemand ernst bleiben kann.' },
  { id: 'iq', icon: '🧠', title: '5-IQ-Moment', subtitle: 'Entscheidung katastrophal, Unterhaltung maximal.' },
  { id: 'random', icon: '🫨', title: 'Was zur Hölle?!', subtitle: 'Der wildeste, unerklärlichste Moment.' },
  { id: 'rage', icon: '💥', title: 'Niki.exe funktioniert nicht mehr', subtitle: 'Rage, Brainlag und kompletter Kurzschluss.' },
  { id: 'cinema', icon: '🎬', title: 'Absolutes Cinema', subtitle: 'Perfektes Timing und legendäre Plot-Twists.' }
];
export const category = id => CATEGORIES.find(c => c.id === id) ?? CATEGORIES[0];
