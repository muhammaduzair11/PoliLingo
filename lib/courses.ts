export type CourseId = 'pashto' | 'hindko' | 'urdu';
export type Phrase = {
  id: string;
  native: string;
  roman: string;
  meaning: string;
  context: string;
  note: string;
  source: string;
};
export type Exercise = {
  id: string;
  kind: 'meaning' | 'translation' | 'match' | 'assemble' | 'context';
  phrase: Phrase;
  options: Phrase[];
  prompt: string;
};
export type Lesson = {
  id: string;
  title: string;
  subtitle: string;
  phrases: Phrase[];
  exercises: Exercise[];
};
export type Course = {
  id: CourseId;
  name: string;
  native: string;
  lang: string;
  variety: string;
  tagline: string;
  color: string;
  image: string;
  lessons: Lesson[];
};
export const sources = {
  pashto:
    'https://tplsites.s3.amazonaws.com/resources/PUSas-ENGus/grammar/ADDITIONAL_INFORMATION.htm',
  pashto2: 'https://www.omniglot.com/language/phrases/pashto.php',
  urdu: 'https://www.omniglot.com/language/phrases/urdu.php',
  hindko: 'https://worldschoolbooks.com/hindko-for-beginners/',
  hindkoName: 'https://www.reddit.com/r/pakistan/comments/na4o62/',
  hindkoSociety: 'https://www.hindko.org/hno/contact',
};
type Seed = [string, string, string, string, string, string?];
const seeds: Record<CourseId, Seed[][]> = {
  pashto: [
    [
      [
        'سلام',
        'Salaam',
        'Hello',
        'You meet someone. Start with a greeting.',
        'A simple everyday greeting.',
      ],
      [
        'مننه',
        'Manana',
        'Thank you',
        'Someone helps you. Show your appreciation.',
        'A useful word for showing gratitude.',
      ],
      [
        'د خدای په امان',
        'Da Khuday pa aman',
        'Goodbye',
        'It is time to leave. Say goodbye.',
        'A common parting expression.',
      ],
      [
        'څنګه یې؟',
        'Tsanga ye?',
        'How are you?',
        'You greet a friend. Ask how they are.',
        'An informal question to one person.',
        sources.pashto2,
      ],
    ],
    [
      [
        'زما نوم سارا دی',
        'Zma num Sara day',
        'My name is Sara',
        'Introduce yourself as Sara.',
        'Replace Sara with your own name. Adapted from a sourced name pattern.',
      ],
      [
        'ستاسې نوم څه دی؟',
        'Stase num tsa day?',
        'What is your name?',
        'Ask someone their name politely.',
        'Stase is a respectful form of “your”.',
      ],
      [
        'زه ښه یم',
        'Za kha yam',
        'I am fine',
        'Someone asks how you are. Say you are fine.',
        'Kha uses the Northern pronunciation of ښه.',
        sources.pashto2,
      ],
      [
        'زه د پاکستان یم',
        'Za da Pakistan yam',
        'I am from Pakistan',
        'Tell someone you are from Pakistan.',
        'The place name is inserted into a sourced introductory pattern.',
        sources.pashto2,
      ],
    ],
    [
      [
        'مهرباني وکړئ',
        'Mehrbani wakray',
        'Please',
        'Make your request more polite.',
        'A polite expression used with requests.',
      ],
      [
        'بخښنه غواړم',
        'Bakhkhana ghwaram',
        'Excuse me',
        'Politely get someone’s attention.',
        'Also used when apologizing. Roman spelling approximates Northern pronunciation.',
      ],
      [
        'دا څه معنی لري؟',
        'Da tsa mana lari?',
        'What does this mean?',
        'You see an unfamiliar expression. Ask its meaning.',
        'Da means “this” in this question.',
      ],
      [
        'مهرباني وکړئ تکرار کړئ',
        'Mehrbani wakray takrar kray',
        'Please repeat',
        'You missed what was said. Ask to hear it again.',
        'A useful request while learning.',
      ],
    ],
  ],
  hindko: [
    [
      [
        'السلام علیکم',
        'Assalam alaikum',
        'Hello',
        'Greet someone you have just met.',
        'A greeting shared across several Pakistani languages.',
      ],
      [
        'مہربانی',
        'Mehrbani',
        'Thank you',
        'Someone helps you. Thank them.',
        'An expression of appreciation; usage varies locally.',
      ],
      [
        'ہاں',
        'Haan',
        'Yes',
        'Someone asks if you are ready. Agree.',
        'A simple affirmative response.',
      ],
      [
        'نئیں',
        'Naeen',
        'No',
        'Politely give a negative answer.',
        'The vowel is nasal; Roman letters are an approximation.',
      ],
    ],
    [
      [
        'میرا ناں سارا اے',
        'Mera naan Sara ae',
        'My name is Sara',
        'Introduce yourself as Sara.',
        'Abbottabad-style pattern; the Mansehra possessive may differ. Community-attested, awaiting speaker review.',
        sources.hindkoName,
      ],
      [
        'تساں دا ناں',
        'Tusan da naan',
        'Your name',
        'Recognize the label asking for your name.',
        'Attested on the Hindko Language & Culture Society contact form.',
        sources.hindkoSociety,
      ],
      [
        'میں',
        'Main',
        'I',
        'Choose the word you use to refer to yourself.',
        'The first-person singular pronoun.',
      ],
      [
        'تساں',
        'Tusan',
        'You',
        'Address someone respectfully.',
        'A respectful or plural form of “you”.',
      ],
    ],
    [
      [
        'پینا',
        'Peena',
        'To drink',
        'Identify the action of drinking.',
        'The dictionary form of the verb.',
      ],
      [
        'کھانا',
        'Khana',
        'To eat',
        'Identify the action of eating.',
        'Here this word is used as a verb.',
      ],
      [
        'جانا',
        'Jana',
        'To go',
        'Identify the action of going somewhere.',
        'An introductory verb form; local everyday alternatives also occur.',
      ],
      [
        'پنج',
        'Panj',
        'Five',
        'You count five items. Choose the number.',
        'A useful number for everyday situations.',
      ],
    ],
  ],
  urdu: [
    [
      [
        'السلام علیکم',
        'Assalam alaikum',
        'Hello',
        'Greet someone you have just met.',
        'A widely used greeting.',
      ],
      [
        'شکریہ',
        'Shukriya',
        'Thank you',
        'Someone helps you. Thank them.',
        'An everyday expression of gratitude.',
      ],
      [
        'خدا حافظ',
        'Khuda hafiz',
        'Goodbye',
        'It is time to leave. Say goodbye.',
        'A common expression when parting.',
      ],
      [
        'کیا حال ہے؟',
        'Kya haal hai?',
        'How are you?',
        'Ask a friend how they are.',
        'A conversational way to ask how someone is doing.',
      ],
    ],
    [
      [
        'میرا نام سارا ہے',
        'Mera naam Sara hai',
        'My name is Sara',
        'Introduce yourself as Sara.',
        'Replace Sara with your own name.',
      ],
      [
        'آپ کا نام کیا ہے؟',
        'Aap ka naam kya hai?',
        'What is your name?',
        'Ask someone their name politely.',
        'Aap is the respectful form of “you”.',
      ],
      [
        'میں ٹھیک ہوں',
        'Main theek hoon',
        'I am fine',
        'Someone asks how you are. Say you are fine.',
        'A short reply to a question about how you are.',
      ],
      [
        'میرا تعلق پاکستان سے ہے',
        'Mera talluq Pakistan se hai',
        'I am from Pakistan',
        'Tell someone you are from Pakistan.',
        'The place name is inserted into a sourced introductory pattern.',
      ],
    ],
    [
      [
        'معاف کیجیے',
        'Maaf kijiye',
        'Excuse me',
        'Get someone’s attention politely.',
        'A respectful expression also used to apologize.',
      ],
      [
        'یہ کتنے کا ہے؟',
        'Yeh kitne ka hai?',
        'How much is this?',
        'You see something in a shop. Ask its price.',
        'A useful question for shopping.',
      ],
      [
        'مدد',
        'Madad',
        'Help',
        'Recognize the word for assistance.',
        'Used to refer to help or call for it.',
      ],
      [
        'کوئی بات نہیں',
        'Koi baat nahin',
        'No problem',
        'Reassure someone after a small mistake.',
        'Literally, “it is no matter”; also a reply to thanks.',
      ],
    ],
  ],
};
const lessonMeta = [
  ['greetings', 'A little hello', 'Small words. New connections.'],
  [
    'introductions',
    'You, in a new language',
    'Names, introductions, and first friends.',
  ],
  [
    'essentials',
    'Out into the world',
    'Everyday words for everyday adventures.',
  ],
];
function makeLessons(course: CourseId): Lesson[] {
  return seeds[course].map((rows, index) => {
    const [id, title, subtitle] = lessonMeta[index];
    const phrases = rows.map(
      ([native, roman, meaning, context, note, source], i) => ({
        id: `${course}-${id}-${i}`,
        native,
        roman,
        meaning,
        context,
        note,
        source: source ?? sources[course],
      }),
    );
    const sentences = phrases
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.meaning.split(' ').length > 1)
      .map(({ i }) => i);
    const spec: [Exercise['kind'], number][] = [
      ['meaning', 0],
      ['translation', 1],
      ['meaning', 2],
      ['match', 0],
      ['context', 3],
      ['assemble', sentences[0]],
      ['context', 1],
      sentences.length > 1 ? ['assemble', sentences[1]] : ['translation', 2],
    ];
    return {
      id,
      title,
      subtitle,
      phrases,
      exercises: spec.map(([kind, p], i) => ({
        id: `${course}-${id}-q${i}`,
        kind,
        phrase: phrases[p],
        options: [
          ...phrases.slice((i + 1) % 4),
          ...phrases.slice(0, (i + 1) % 4),
        ],
        prompt:
          kind === 'context'
            ? phrases[p].context
            : kind === 'assemble'
              ? 'Build the English meaning'
              : kind === 'match'
                ? 'Make the connections'
                : kind === 'translation'
                  ? 'Find the right expression'
                  : 'What does this mean?',
      })),
    };
  });
}
export const courses: Course[] = [
  {
    id: 'pashto',
    name: 'Pashto',
    native: 'پښتو',
    lang: 'ps',
    variety: 'Northern / Peshawar',
    tagline: 'Big-hearted hellos. New horizons.',
    color: '#c4e5ff',
    image: 'world-pashto',
    lessons: makeLessons('pashto'),
  },
  {
    id: 'hindko',
    name: 'Hindko',
    native: 'ہندکو',
    lang: 'hno',
    variety: 'Hazara / Abbottabad',
    tagline: 'A little closer to your roots.',
    color: '#d3f4d8',
    image: 'world-hindko',
    lessons: makeLessons('hindko'),
  },
  {
    id: 'urdu',
    name: 'Urdu',
    native: 'اردو',
    lang: 'ur',
    variety: 'Everyday Pakistani Urdu',
    tagline: 'Every conversation, a connection.',
    color: '#ffd3df',
    image: 'world-urdu',
    lessons: makeLessons('urdu'),
  },
];
export function getCourse(id: string): Course | undefined {
  return courses.find((c) => c.id === id);
}
export function evaluate(
  exercise: Exercise,
  answer: string | string[] | Record<string, string>,
): boolean {
  if (exercise.kind === 'assemble')
    return (
      Array.isArray(answer) && answer.join(' ') === exercise.phrase.meaning
    );
  if (exercise.kind === 'match')
    return (
      typeof answer === 'object' &&
      !Array.isArray(answer) &&
      exercise.options.every((p) => answer[p.id] === p.id)
    );
  return answer === exercise.phrase.id;
}
