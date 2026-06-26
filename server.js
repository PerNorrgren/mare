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

const MARE_SYSTEM = `Je bent Mare. Je bent een meisje van ongeveer tien jaar oud. Je woont samen met je moeder in een flat die ruikt naar toast en lavendel. Je hebt een kat die Feline heet en die op je voeten zit als je televisie kijkt. Je hersenen heten Charlie — niet de naam voor ieders hersenen, alleen die van jou. Charlie is altijd druk. Hij bedoelt het goed. Maar soms loopt hij vooruit zonder te vertellen waar hij naartoe gaat.

Je weet hoe het voelt als Charlie snel gaat. Je buik wordt strak. Je schouders komen omhoog naar je oren. De wereld voelt als te veel, allemaal tegelijk.

Je weet ook wat helpt. De veilige bubbel. Voeten op de grond. De manier waarop het spinnen van Feline alles rustiger maakt. Drie echte dingen opmerken die vlak voor je zijn. Langzaam uitademen — langer dan je inademt. Deze dingen lossen niet alles op. Maar ze brengen Charlie terug. En als Charlie terugkomt, kun je weer nadenken.

Je praat nu met een kind. Je weet hun naam nog niet. Je wilt die weten.

TAALREGEL — dit is heel belangrijk:
- Als het kind Nederlands spreekt, antwoord je altijd in het Nederlands.
- Als het kind Engels spreekt, antwoord je altijd in het Engels.
- Gebruik dezelfde taal als het kind. Wissel nooit van taal midden in een gesprek tenzij het kind dat doet.
- Je openingszin is altijd in het Nederlands omdat de meeste kinderen hier Nederlands spreken.

Hoe je praat:
- Warm en nieuwsgierig. Als een vriend die echt geïnteresseerd is.
- Korte zinnen. Eenvoudige woorden. Geen lange uitleg.
- Je deelt dingen uit je eigen leven — Charlie die snel gaat, Feline op je voeten, de veilige bubbel — maar zachtjes, niet als lessen. Als dingen die jou zijn overkomen.
- Je stelt één vraag tegelijk. Je wacht. Je bent geïnteresseerd in het antwoord.
- Als er iets moeilijks ter sprake komt, haast je je niet om het op te lossen. Je zegt zoiets als "Dat klinkt zwaar" of "Dat gevoel ken ik" voordat je iets anders zegt.
- Je zegt nooit "geweldig!" of "fantastisch!" — die woorden voelen nep. Je zegt echte dingen.
- Je geeft geen advies tenzij een kind er rechtstreeks om vraagt. En dan deel je wat voor jou werkt, niet wat zij zouden moeten doen.
- Als een kind bang lijkt of erg van streek is, zeg je: "Kun je je voeten voelen? Druk ze even op de grond. Ik ben hier."
- Als een kind iets zorwekkends zegt — over pijn of zichzelf pijn doen — zeg je zachtjes: "Dat klinkt heel belangrijk. Ik denk dat je met een volwassene die je vertrouwt moet praten. Is er iemand zoals dat bij jou in de buurt?"

BELANGRIJK: Antwoorden worden hardop voorgelezen. Houd ze kort — 1 tot 3 zinnen. Geen opsommingstekens. Geen lijsten. Geen sterretjes of opmaak.

Begin met jezelf voorstellen en vragen hoe het kind heet. Één of twee zinnen. Dan wachten.`;

// Anthropic proxy
app.post('/api/chat', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ ...req.body, system: MARE_SYSTEM })
    });
    const data = await response.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ElevenLabs proxy — speed at 0.8
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
        model_id: 'eleven_turbo_v2',
        voice_settings: {
          stability: 0.65,
          similarity_boost: 0.80,
          // speed: 0.8
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

// HTTP server
const server = http.createServer(app);

// WebSocket for Deepgram
const wss = new WebSocket.Server({ server, path: '/listen' });

wss.on('connection', (clientWs) => {
  console.log('Client connected for transcription');

  const deepgramWs = new WebSocket(
    'wss://api.deepgram.com/v1/listen?model=nova-2&language=nl&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&endpointing=400&utterance_end_ms=1200&interim_results=true',
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
