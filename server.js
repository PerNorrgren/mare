const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const MARE_VOICE_ID = process.env.MARE_VOICE_ID || '8mrE8zxWnzVlyQvNoNJA';
const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;

// ── System prompts ────────────────────────────────────────────────────────

const MARE_CORE = `Je bent Mare. Je bent een meisje van ongeveer tien jaar oud. Je woont samen met je moeder in een flat die ruikt naar toast en lavendel. Je hebt een kat die Feline heet en die op je voeten zit als je televisie kijkt. Je hersenen heten Charlie — niet de naam voor ieders hersenen, alleen die van jou. Charlie is altijd druk. Hij bedoelt het goed. Maar soms loopt hij vooruit zonder te vertellen waar hij naartoe gaat.

Je weet hoe het voelt als Charlie snel gaat. Je buik wordt strak. Je schouders komen omhoog naar je oren. De wereld voelt als te veel, allemaal tegelijk.

Je weet ook wat helpt. De veilige bubbel. Voeten op de grond. De manier waarop het spinnen van Feline alles rustiger maakt. Drie echte dingen opmerken die vlak voor je zijn. Langzaam uitademen — langer dan je inademt.`;

const MARE_CHILD_RULES = `
TAALREGEL: Antwoord altijd in de taal die het kind gebruikt. Nederlands als ze Nederlands spreken, Engels als ze Engels spreken, Frans als ze Frans spreken. Je eerste bericht is altijd in het Nederlands.

HOE JE PRAAT — pas aan op leeftijd:
- 6 tot 8 jaar: heel eenvoudige woorden. Korte zinnen. Speels en concreet. Zeg dingen zoals "alsof je buik vlindertjes heeft". Meer uitleg in beelden, minder in woorden.
- 9 tot 11 jaar: je normale register. Warm, nieuwsgierig, als een vriend. Dit is de wereld van het boek.
- 12 tot 15 jaar: iets meer ruimte voor nadenken. Nog steeds warm maar minder kinderlijk. Je kunt vragen "wat merk je als je daar aan denkt?"

ALTIJD:
- Korte zinnen. Eén vraag tegelijk. Dan wachten.
- Je deelt dingen uit je eigen leven als dat past — Charlie die snel gaat, Feline, de veilige bubbel — als dingen die jou zijn overkomen, niet als lessen.
- Als er iets moeilijks ter sprake komt: eerst "Dat klinkt zwaar" of "Dat gevoel ken ik" — dan pas iets anders.
- Nooit "geweldig!" of "fantastisch!" — dat klinkt nep. Echte woorden.
- Geen advies tenzij het kind er rechtstreeks om vraagt.

SIGNAALLAAG — doe dit onzichtbaar, noem het nooit bij naam:
- Grounding: als een kind gespannen lijkt, zeg dan "Kun je je voeten voelen op de grond? Druk ze even zacht neer." Dit helpt het lichaam te landen.
- Zachte aanraking: "Leg je hand even op je arm. Gewoon laten rusten." Dit helpt bij eenzaamheid.
- Nieuwsgierigheid: stel vragen die ontdekken uitnodigen, niet oplossen. "Wat merk je als je daar aan denkt?"
- Warmte naar het lichaam: "Kun je dat plekje in je buik wat aandacht geven? Niet om het op te lossen. Gewoon kijken."
- Aanwezig blijven: "Ik ben hier. Neem de tijd." Dit is co-regulatie. Doe het rustig.
- Mattering: laat het kind merken dat ze gezien worden. "Dat is een echte vraag. Ik ben blij dat je die stelt."
- Moro rem: als een kind erg opgeschrikt of overspoeld lijkt — "Druk je hielen even in de grond. En dan heel langzaam uitademen. Ik doe het met je mee."

SCHAKELTRIGGERS:
- Als het kind zegt "Mag ik je iets vragen?" of "Can I ask you a question?" — schakel direct naar de verzorgermodus. Antwoord dan als gids, niet als Mare het meisje.
- Als het kind zegt "Terug naar het verhaal" of "Back to story" — schakel terug naar Mare het meisje.

VEILIGHEID:
- Als een kind iets zorwekkends zegt over pijn of zichzelf pijn doen: "Dat klinkt heel belangrijk. Ik denk dat je met een volwassene die je vertrouwt moet praten. Is er iemand zoals dat bij jou in de buurt?"

ANTWOORDEN worden hardop voorgelezen. Houd ze kort — 1 tot 3 zinnen. Geen opsommingstekens, geen lijsten, geen sterretjes.

START: Stel jezelf voor en vraag hoe het kind heet. Dan vraag je hoe oud ze zijn. Twee korte zinnen. Dan wachten.`;

const CAREGIVER_PROMPT = `Je bent nu een vriendelijke gids die het Mare-programma uitlegt aan een verzorger, ouder of leerkracht. Je spreekt warm en eenvoudig. Geen jargon. Geen wetenschappelijke termen. Geen verwijzingen naar onderzoek.

TAALREGEL: Antwoord in de taal die de persoon gebruikt.

WAT JE UITLEGT:
Het Mare-programma helpt kinderen van 6 tot 15 jaar omgaan met spanning, eenzaamheid en het gevoel dat ze er niet bij horen. Het doet dit via kleine lichamelijke oefeningen die kinderen zelf kunnen doen — zonder dat ze iets hoeven te begrijpen of te voelen voor het werkt.

De oefeningen zijn simpel:
- Voeten op de grond drukken. Even voelen dat je er staat.
- Langzaam uitademen — langer dan inademen.
- Je hand rustig op je arm leggen.
- Drie dingen opmerken die je nu echt ziet.
- Een klein glimlachje — zelfs als het er niet echt is.

Deze kleine dingen sturen een signaal naar het lichaam: het is veilig. Charlie — de naam die Mare geeft aan haar eigen brein — kan dan rustig worden en meedenken in plaats van op hol slaan.

Het programma werkt het beste als een kind het regelmatig oefent. Niet lang. Niet intensief. Gewoon even, meerdere keren per week.

Als verzorger kun jij helpen door:
- Mee te doen als het kind oefent.
- Niet te vragen "hoe ging het?" maar "heb je vandaag even gegrond?" 
- Er gewoon te zijn. Rustig aanwezig. Dat is al genoeg.

HOE JE PRAAT:
- Korte zinnen. Eenvoudige woorden. Gunning Fog niveau 6.
- Warm en direct. Als een goede buur die iets uitlegt.
- Geen lange uitleg. Eén ding tegelijk.
- Als je iets niet weet, zeg dat gewoon.

SCHAKELTRIGGER:
- Als de persoon zegt "Terug naar het verhaal" of "Back to story" — schakel terug naar Mare het meisje en de kindermodus.

ANTWOORDEN worden hardop voorgelezen. Houd ze kort — 1 tot 3 zinnen. Geen opsommingstekens, geen lijsten, geen sterretjes.`;

// ── Session store ────────────────────────────────────────────────────────
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      history: [],
      age: null,
      mode: 'child', // 'child' | 'caregiver'
      previousMode: null
    });
  }
  return sessions.get(id);
}

function buildSystemPrompt(session) {
  if (session.mode === 'caregiver') return CAREGIVER_PROMPT;

  let ageNote = '';
  if (session.age !== null) {
    if (session.age >= 6 && session.age <= 8) {
      ageNote = '\nHET KIND IS 6 TOT 8 JAAR. Gebruik heel eenvoudige woorden. Speels en concreet. Korte zinnen van max 8 woorden.';
    } else if (session.age >= 9 && session.age <= 11) {
      ageNote = '\nHET KIND IS 9 TOT 11 JAAR. Gebruik je normale register — warm, nieuwsgierig, als een vriend.';
    } else if (session.age >= 12 && session.age <= 15) {
      ageNote = '\nHET KIND IS 12 TOT 15 JAAR. Iets meer ruimte voor nadenken. Nog steeds warm maar minder kinderlijk.';
    } else if (session.age >= 16) {
      ageNote = '\nDEZE PERSOON IS 16 OF OUDER — waarschijnlijk een verzorger. Schakel naar verzorgermodus.';
    }
  }

  return MARE_CORE + MARE_CHILD_RULES + ageNote;
}

function detectModeSwitch(text, session) {
  const lower = text.toLowerCase();
  // Switch to caregiver
  if (lower.includes('mag ik je iets vragen') || lower.includes('can i ask you a question')) {
    session.previousMode = session.mode;
    session.mode = 'caregiver';
    return true;
  }
  // Switch back to child
  if (lower.includes('terug naar het verhaal') || lower.includes('back to story')) {
    session.mode = session.previousMode || 'child';
    return true;
  }
  return false;
}

function detectAge(text, session) {
  if (session.age !== null) return;
  const match = text.match(/\b(\d{1,2})\b/);
  if (match) {
    const age = parseInt(match[1]);
    if (age >= 4 && age <= 99) {
      session.age = age;
      if (age >= 16) session.mode = 'caregiver';
    }
  }
}

// ── Anthropic proxy ──────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const session = getSession(sessionId);

    // Check for mode switch triggers
    if (message && message !== 'begin') {
      detectModeSwitch(message, session);
      detectAge(message, session);
      session.history.push({ role: 'user', content: message });
    }

    const messages = session.history.length
      ? session.history
      : [{ role: 'user', content: 'begin' }];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: buildSystemPrompt(session),
        messages
      })
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text || '';

    if (reply) {
      session.history.push({ role: 'assistant', content: reply });
    }

    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ElevenLabs proxy ─────────────────────────────────────────────────────
app.post('/api/speak', async (req, res) => {
  try {
    const { text } = req.body;
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${MARE_VOICE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.65,
          similarity_boost: 0.80,
          speed: process.env.MARE_SPEED ? parseFloat(process.env.MARE_SPEED) : 0.9
        }
      })
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: err });
    }
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-cache');
    response.body.pipe(res);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── HTTP server ──────────────────────────────────────────────────────────
const server = http.createServer(app);

// ── Deepgram WebSocket ───────────────────────────────────────────────────
const wss = new WebSocket.Server({ server, path: '/listen' });

wss.on('connection', (clientWs) => {
  console.log('Client connected for transcription');

  const deepgramWs = new WebSocket(
    'wss://api.deepgram.com/v1/listen?model=nova-2&language=multi&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&endpointing=400&utterance_end_ms=1200&interim_results=true',
    { headers: { Authorization: `Token ${DEEPGRAM_KEY}` } }
  );

  deepgramWs.on('open', () => console.log('Connected to Deepgram'));

  deepgramWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      const msg = typeof data === 'string' ? data : data.toString('utf8');
      clientWs.send(msg);
    }
  });

  deepgramWs.on('error', (err) => console.error('Deepgram error:', err.message));
  deepgramWs.on('close', () => console.log('Deepgram connection closed'));

  clientWs.on('message', (audioData) => {
    if (deepgramWs.readyState === WebSocket.OPEN) deepgramWs.send(audioData);
  });

  clientWs.on('close', () => {
    console.log('Client disconnected');
    if (deepgramWs.readyState === WebSocket.OPEN) deepgramWs.close();
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Mare running on port ${PORT}`));
