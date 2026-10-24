// Scrap Hack 2026 by TinkerHub: an overnight build night on e-waste and scrap.
// Runs at TinkerSpace Kochi and TinkerSpace Calicut. No prizes, so judging is switched off:
// mentors only check in, help and log notes. See docs/CONFIG.md for every field.

const SKILLS = ['Electronics', 'Mechanical', 'Software', 'Design', 'Idea refinement', 'Debugging'];

export default {
  event: {
    name: 'Scrap Hack',
    tagline: 'Mentor desk',
    route: 'TinkerSpace Kochi · Calicut',
    hours: '6 PM – 6 AM',
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
  },

  // primary = headings and card outlines (oxidised copper), accent = buttons and highlights (rust).
  theme: { primary: '#1F6F5C', primaryDeep: '#154D40', accent: '#E8590C', accentDeep: '#C2410C' },

  rounds: [
    { n: 1, title: 'Idea & scrap', time: '7:30 PM', asks: 'What are you building? What scrap are you using? How does it link to food, agri or environment?' },
    { n: 2, title: 'Progress check', time: '10:30 PM', asks: 'Show me what you built. What is blocking you? On track?' },
    { n: 3, title: 'Progress & demo', time: '1:30 AM', asks: 'What runs? Blocked? On track?' },
    { n: 4, title: 'Final look', time: '4:30 AM', asks: 'Will it run at the showcase? Strongest and weakest part.' },
  ],

  skills: SKILLS,

  helpTypes: [
    ['Circuit / electronics issue', 'Electronics|Debugging'],
    ['Mechanical / build issue', 'Mechanical'],
    ['Code issue', 'Software|Debugging'],
    ['Idea unclear', 'Idea refinement'],
    ['Not progressing', null],
    ['Team conflict', null],
    ['Needs specific mentor', null],
    ['Other', null],
  ],

  copy: {
    themeName: 'theme',
    themeLinkLabel: 'Theme link',
    goalLabel: 'Their goal',
    ideaHeading: 'What they said at check-in 1',
    waiting: 'The organizer will open check-in 1 soon. This screen updates by itself.',
    joinLead: 'Set up your mentor card once. You will use it all night to check in on teams and pick up help requests. Takes 20 seconds.',
    briefLead: 'Tonight you walk the floor, help teams turn scrap into working builds, and log quick check-ins. There are no prizes and no judging. Your notes help us spot who is stuck and who needs which mentor.',
    rubricNote: '',
    prizeLine: '',
    collegeLabel: "College you're connected to",
  },

  forms: {
    1: {
      title: 'Idea & scrap',
      hint: "Write what they tell you. About a minute.",
      questions: [
        { id: 'building', type: 'text', label: 'What are they building?', ph: 'One or two lines, in their words', req: true },
        { id: 'scrap', type: 'text', label: 'What scrap are they using?', ph: 'e.g. old printer motors, a dead UPS, fan blades' },
        { id: 'buildType', type: 'many', label: 'Build type', options: ['Electronics', 'Mechanical', 'Software', 'Other'] },
        { id: 'theme', type: 'text', label: 'How does it connect to food, agri or environment?', ph: 'One sentence. Later mentors see this.', req: true },
        { id: 'goal', type: 'text', label: 'What should be working by morning?', ph: 'Their own goal', req: true },
        { section: 'Your read' },
        { id: 'clarity', type: 'one', label: 'Is the idea clear?', req: true, options: [['Very clear', 'g'], ['Somewhat clear', 'y'], ['Still figuring it out', 'r']] },
        { id: 'themeRead', type: 'one', label: 'Theme connection', req: true, options: [['Strong', 'g'], ['Could be stronger', 'y'], ['Not clear yet', 'r']] },
        { id: 'plan', type: 'one', label: 'Their plan', req: true, options: [['Clear and achievable', 'g'], ['Ambitious', 'y'], ['Unclear or unrealistic', 'r']] },
        { id: 'help', type: 'many', label: 'Do they need help? (optional)', hint: 'Picking a skill sends a help request to mentors who have it.', options: SKILLS },
      ],
    },
    2: {
      title: 'Progress check',
      hint: 'Ask them to show you what they built.',
      questions: [
        { id: 'built', type: 'text', label: 'What have they built since check-in 1?', ph: 'Short answer', req: true },
        { id: 'state', type: 'one', label: 'Where are they now?', req: true, options: [['Still tearing down', 'r'], ['Early prototype', 'o'], ['Partially working', 'y'], ['Working prototype', 'g'], ['Almost complete', 'b']] },
        { id: 'blocking', type: 'text', label: "What's blocking them? (optional)", ph: 'Short note' },
        { id: 'onTrack', type: 'one', inline: true, label: 'On track for the end?', req: true, options: [['Yes', 'g'], ['Maybe', 'y'], ['No', 'r']] },
        { id: 'whyNot', type: 'text', label: 'Why not, and what would help?', ph: 'e.g. motor driver fried. Needs an electronics mentor.', req: true, showIf: ['onTrack', 'No'], hint: 'This goes straight to the organizers.' },
      ],
    },
    3: {
      // Also carries check-in 2's questions, so check-in 2 can be skipped without losing anything.
      title: 'Progress & demo',
      hint: 'Ask them to show what runs.',
      questions: [
        { id: 'built', type: 'text', label: 'What have they built so far?', ph: 'Short answer', req: true },
        { id: 'works', type: 'one', label: 'What works right now?', req: true, options: [['Nothing yet', 'r'], ['Small part works', 'o'], ['Core functionality works', 'y'], ['Almost complete', 'g'], ['Complete prototype', 'b']] },
        { id: 'changed', type: 'one', label: 'Changed from the first idea?', req: true, options: [['Mostly the same'], ['Improved'], ['Changed a lot'], ['Completely different']] },
        { id: 'blocking', type: 'text', label: "What's blocking them? (optional)", ph: 'Short note' },
        { id: 'onTrack', type: 'one', inline: true, label: 'On track for the end?', req: true, options: [['Yes', 'g'], ['Maybe', 'y'], ['No', 'r']] },
        { id: 'whyNot', type: 'text', label: 'Why not, and what would help?', ph: 'Short note', req: true, showIf: ['onTrack', 'No'], hint: 'This goes straight to the organizers.' },
      ],
    },
    4: {
      title: 'Final look',
      hint: 'Last check-in before the showcase.',
      questions: [
        { id: 'demoReady', type: 'one', inline: true, label: 'Will it run at the showcase?', req: true, options: [['Yes', 'g'], ['Partially', 'y'], ['No', 'r']] },
        { id: 'built', type: 'text', label: 'What did they actually build?', ph: 'Short description', req: true },
        { id: 'strongest', type: 'text', label: 'Strongest part', ph: 'e.g. clever reuse of the printer carriage', req: true },
        { id: 'weakest', type: 'text', label: 'What to try next', ph: 'One thing they could improve after tonight', req: true },
      ],
    },
  },

  noteKeys: { 1: ['building', 'scrap', 'theme', 'goal'], 2: ['built', 'state', 'blocking', 'whyNot'], 3: ['built', 'works', 'changed', 'blocking', 'whyNot'] },
  noteLabels: { building: 'Building', scrap: 'Scrap used', theme: 'Theme link', goal: 'Goal', built: 'Built', state: 'Where they were', blocking: 'Blocking', whyNot: 'Needs', works: 'What worked', changed: 'Changed from first idea' },

  // Not used while judging is off, kept so the engine has a valid rubric.
  rubric: [
    { id: 'built', label: 'What was built', max: 20 },
    { id: 'creativity', label: 'Creativity & idea', max: 10 },
    { id: 'theme', label: 'Theme fit', max: 10 },
    { id: 'execution', label: 'Execution', max: 5 },
    { id: 'demo', label: 'Demo & experience', max: 5 },
  ],

  judging: {
    enabled: false,            // Scrap Hack has no prizes: no top-two picks, finalists, booths or scoring
    booths: false,
    nominationTarget: 0,
    shortlistSize: 20,
    picksLockAt: '6:00 AM',
    stages: {
      booths: { time: '', title: 'Demo booths', text: '' },
      shortlist: { time: '', title: 'Shortlist', text: '' },
      finals: { time: '', title: 'Finalist presentations', text: '' },
      done: { time: '', title: 'Final call', text: '' },
    },
  },

  floorTables: false,

  practiceTeams: ['Rust Bucket', 'Motor Mouth', 'Fan Club', 'Dead Battery', 'Solder Squad', 'Junk Drawer', 'Printer Parts', 'Spare Gears',
    'Old CRT', 'Loose Wires', 'Bolt Gang', 'Scrapyard Dogs', 'Circuit Breakers', 'Tin Cans', 'Salvage Crew', 'Second Life'],
};
