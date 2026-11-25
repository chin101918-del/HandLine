import { CharCategory } from '../types/font';

export interface CharacterSpec {
  codepoint: number;
  char: string;
  category: CharCategory;
  isCombining?: boolean;
  hint?: string;
}

function makeChars(
  chars: string[],
  category: CharCategory,
  combiningSet: Set<string> = new Set()
): CharacterSpec[] {
  return chars.map((ch) => ({
    codepoint: ch.codePointAt(0)!,
    char: ch,
    category,
    isCombining: combiningSet.has(ch),
  }));
}

const COMBINING = new Set(['ั', 'ิ', 'ี', 'ึ', 'ื', 'ุ', 'ู', 'ฺ', '็', '่', '้', '๊', '๋', '์', 'ํ']);

export const CHARACTER_SET: CharacterSpec[] = [
  ...makeChars(
    [
      'ก','ข','ฃ','ค','ฅ','ฆ','ง','จ','ฉ','ช','ซ','ฌ','ญ','ฎ','ฏ','ฐ','ฑ','ฒ','ณ',
      'ด','ต','ถ','ท','ธ','น','บ','ป','ผ','ฝ','พ','ฟ','ภ','ม','ย','ร','ล','ว','ศ',
      'ษ','ส','ห','ฬ','อ','ฮ',
    ],
    'thai_consonants'
  ),
  ...makeChars(
    ['ะ','ั','า','ำ','ิ','ี','ึ','ื','ุ','ู','เ','แ','โ','ใ','ไ','ฤ','ฦ'],
    'thai_vowels',
    COMBINING
  ),
  ...makeChars(['่','้','๊','๋','็','์','ํ','ฯ','ๆ','฿'], 'thai_tones', COMBINING),
  ...makeChars(['๐','๑','๒','๓','๔','๕','๖','๗','๘','๙'], 'thai_digits'),
  ...makeChars('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), 'latin_upper'),
  ...makeChars('abcdefghijklmnopqrstuvwxyz'.split(''), 'latin_lower'),
  ...makeChars('0123456789.,!?;:-()"\'/'.split(''), 'digits_punct'),
];

export const CATEGORY_LABELS: Record<CharCategory, { th: string; en: string }> = {
  thai_consonants: { th: 'พยัญชนะไทย (ก–ฮ)', en: 'Thai Consonants (ก–ฮ)' },
  thai_vowels: { th: 'สระไทย', en: 'Thai Vowels' },
  thai_tones: { th: 'วรรณยุกต์และเครื่องหมาย', en: 'Tones & Marks' },
  thai_digits: { th: 'ตัวเลขไทย (๐–๙)', en: 'Thai Digits (๐–๙)' },
  latin_upper: { th: 'อังกฤษตัวพิมพ์ใหญ่ (A–Z)', en: 'English Uppercase (A–Z)' },
  latin_lower: { th: 'อังกฤษตัวพิมพ์เล็ก (a–z)', en: 'English Lowercase (a–z)' },
  digits_punct: { th: 'ตัวเลขและเครื่องหมาย', en: 'Digits & Punctuation' },
};
