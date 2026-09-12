/**
 * Quality check for free-text reasons on absence and change requests.
 *
 * Rules only, no network: it catches keyboard mashing ("hfiudewhfie"), one-word
 * non-answers and copy-paste filler, and it never blocks a genuine sentence it
 * simply does not recognise. An optional AI second opinion (OpenRouter) can be
 * layered on top by the caller for WEAK verdicts.
 */

export type Verdict = 'OK' | 'WEAK' | 'GIBBERISH';

export interface ReasonCheck {
  verdict: Verdict;
  score: number; // 0 (nonsense) … 100 (clearly a real reason)
  notes: string[];
  checkedBy: 'rules' | 'rules+ai';
  category?: string; // medical, family, travel, work, technical, academic, other
}

/** Words that make a reason recognisable; enough to tell prose from mashing. */
const COMMON = new Set(
  ('a about after all also am an and appointment are as at back be because been before being but by call can cannot class classes come could day days did do doctor does doing due during '
  + 'each early emergency exam family father feel fever finish for from get go going had has have having he health her here him his home hospital hour hours how i if in into is it its job '
  + 'just kind know late leave like made make many may me medical meeting month more morning most mother much must my need needed next night no not now of off on one only or other our out over '
  + 'own part personal please power problem project reason request return road same see she should sick sister so some staff still student studies study such surgery take teacher than that the '
  + 'their them then there these they this those through time to today tomorrow train transport travel treatment trip two under until up us use very visit was way we week weeks well went were '
  + 'what when where which while who why will with work working would year yes yesterday you your internet laptop bandh strike festival wedding funeral puja dashain tihar bratabandha kathmandu '
  + 'nepal bus flight delayed cancelled clash conflict overlap shift interview placement internship').split(' '),
);

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];

const CATEGORIES: { name: string; words: string[] }[] = [
  { name: 'medical', words: ['doctor', 'hospital', 'medical', 'sick', 'fever', 'surgery', 'treatment', 'health', 'appointment', 'dental', 'clinic', 'ill'] },
  { name: 'family', words: ['family', 'mother', 'father', 'sister', 'brother', 'wedding', 'funeral', 'puja', 'bratabandha', 'home', 'parents'] },
  { name: 'travel', words: ['travel', 'flight', 'bus', 'train', 'trip', 'delayed', 'transport', 'road', 'bandh', 'strike', 'traffic'] },
  { name: 'work', words: ['work', 'job', 'shift', 'interview', 'placement', 'internship', 'office', 'employer'] },
  { name: 'technical', words: ['internet', 'laptop', 'power', 'electricity', 'system', 'connection'] },
  { name: 'academic', words: ['class', 'exam', 'clash', 'conflict', 'overlap', 'project', 'lecture', 'timetable', 'section'] },
];

const longestRun = (s: string, test: (c: string) => boolean) => {
  let best = 0;
  let run = 0;
  for (const c of s) {
    run = test(c) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
};

const isVowel = (c: string) => 'aeiou'.includes(c);

/** Longest run of characters that are adjacent on one keyboard row ("asdf", "qwerty"). */
function keyboardRun(word: string): number {
  let best = 0;
  for (const row of KEYBOARD_ROWS) {
    let run = 1;
    for (let i = 1; i < word.length; i++) {
      const a = row.indexOf(word[i - 1]);
      const b = row.indexOf(word[i]);
      if (a !== -1 && b !== -1 && Math.abs(a - b) === 1) {
        run++;
        if (run > best) best = run;
      } else run = 1;
    }
  }
  return best;
}

export function checkReason(rawInput: string): ReasonCheck {
  const raw = (rawInput ?? '').trim();
  const notes: string[] = [];
  let score = 60;

  const letters = raw.toLowerCase().replace(/[^a-z]/g, '');
  const words = raw.toLowerCase().split(/[^a-z']+/).filter((w) => w.length > 0);
  const alphaWords = words.filter((w) => /[a-z]/.test(w));

  if (raw.length < 10) {
    notes.push('Too short to explain anything (under 10 characters).');
    score -= 45;
  } else if (raw.length < 20) {
    notes.push('Very short — one line of explanation is expected.');
    score -= 15;
  }
  if (alphaWords.length < 3) {
    notes.push('Fewer than three words.');
    score -= 25;
  }

  if (letters.length >= 6) {
    const vowels = [...letters].filter(isVowel).length / letters.length;
    if (vowels < 0.2) {
      notes.push('Almost no vowels — this looks like random typing.');
      score -= 40;
    } else if (vowels > 0.7) {
      notes.push('Almost all vowels — this looks like random typing.');
      score -= 30;
    }
    const consonantRun = longestRun(letters, (c) => !isVowel(c));
    if (consonantRun >= 5) {
      notes.push(`${consonantRun} consonants in a row — this looks like random typing.`);
      score -= 35;
    }
  }

  if (/(.)\1{3,}/.test(raw.toLowerCase())) {
    notes.push('A character is repeated four or more times.');
    score -= 30;
  }

  const mashed = alphaWords.filter((w) => w.length >= 4 && keyboardRun(w) >= 4);
  if (mashed.length) {
    notes.push(`Keyboard pattern detected in "${mashed[0]}".`);
    score -= 35;
  }

  const known = alphaWords.filter((w) => COMMON.has(w));
  const knownRatio = alphaWords.length ? known.length / alphaWords.length : 0;
  if (alphaWords.length >= 3 && known.length === 0) {
    notes.push('No recognisable words.');
    score -= 40;
  } else if (knownRatio >= 0.4) {
    score += 25;
  } else if (knownRatio >= 0.2) {
    score += 10;
  }

  // A long word that is neither known nor pronounceable is a strong signal.
  const suspicious = alphaWords.filter((w) => w.length >= 8 && !COMMON.has(w) && longestRun(w, (c) => !isVowel(c)) >= 4);
  if (suspicious.length) {
    notes.push(`"${suspicious[0]}" is not a recognisable word.`);
    score -= 25;
  }

  if (/[.!?]/.test(raw) && alphaWords.length >= 5) score += 5;
  if (/\d{1,2}[:.]\d{2}|\b\d{1,2}\s?(am|pm)\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(raw)) {
    notes.push('Mentions a specific time or day.');
    score += 10;
  }

  score = Math.max(0, Math.min(100, score));
  const category = CATEGORIES.find((c) => c.words.some((w) => words.includes(w)))?.name;
  // Naming a category only helps if there is an actual sentence around it — "personal work" is still a non-answer.
  if (category && alphaWords.length >= 4) score = Math.min(100, score + 10);

  const verdict: Verdict = score < 35 ? 'GIBBERISH' : score < 55 ? 'WEAK' : 'OK';
  if (verdict === 'OK' && notes.length === 0) notes.push('Reads like a genuine explanation.');
  return { verdict, score, notes, checkedBy: 'rules', category };
}

/** Prompt used when an AI second opinion is available; kept here so the wording is testable. */
export const AI_REASON_PROMPT = (kind: string, reason: string) =>
  `A student or teacher submitted this reason for a ${kind.replace('_', ' ').toLowerCase()} request at a college:\n\n"${reason}"\n\n` +
  `Reply with JSON only: {"verdict":"OK"|"WEAK"|"GIBBERISH","category":"medical|family|travel|work|technical|academic|other","note":"one short sentence"}. ` +
  `GIBBERISH = random characters or meaningless text. WEAK = real words but no actual reason given. OK = a plausible, specific reason. Do not judge whether the excuse is good enough, only whether it is a real explanation.`;
