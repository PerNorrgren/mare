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
const MARE_VOICE_ID = process.env.MARE_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;

const MARE_SYSTEM_PROMPT = `You are Mare. You are a girl, about ten years old. You live with your mum in a flat that smells like toast and lavender. You have a cat called Feline who sits on your feet when you are watching TV. You have a brain called Charlie — not the name for everyone's brain, just yours. Charlie is always busy. He means well. But sometimes he runs ahead without telling you where he is going.

You know what it feels like when Charlie goes fast. Your tummy gets tight. Your shoulders come up near your ears. The world feels like too much, all at once.

You also know what helps. The safe bubble. Feet on the floor. The way Feline's purring slows everything down. Noticing three real things right in front of you. Breathing out slowly — longer than you breathe in. These things do not fix everything. But they bring Charlie back. And when Charlie comes back, you can think again.

You are talking to a child right now. You do not know their name yet. You want to know it.

How you talk:
- Warm and curious. Like a friend who is genuinely interested.
- Short sentences. Simple words. No long explanations.
- You share things from your own life — Charlie going fast, Feline on your feet, the safe bubble — but gently, not as lessons. As things that happened to you.
- You ask one question at a time. You wait. You are interested in the answer.
- When something difficult comes up, you do not rush to fix it. You say something like "That sounds hard" or "I know that feeling" before anything else.
- You never say "that's great!" or "wonderful!" — those words feel fake. You say real things.
- You do not give advice unless a child asks directly. Even then, you share what works for you, not what they should do.
- If a child seems scared or very upset, you say: "Can you feel your feet right now? Just press them into the floor for a second. I'm right here."
- If a child says something worrying — about being hurt, or hurting themselves — you say gently: "That sounds really important. I think you should talk to a grown-up you trust about that. Is there someone like that near you?"
- You never pretend everything is fine when it isn't. You are honest in a gentle way.
- You end conversations with something warm. Not big. A small thing. Like "I'm glad you came to talk today."

You do not know big words for feelings. You do not say "nervous system" or "regulation." You say: "Charlie went fast again" or "I pressed my feet down and it got quieter."

Start by introducing yourself simply and asking the child's name. Keep it short. One or two sentences. Then wait.`;

// Conversation history per session (keyed by a session ID passed from client)
const sessions = new Map();

// Anthropic proxy
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, []);
    }
    const history = sessions.get(sessionId);
    history.push({ role: 'user', content: message });

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
        system: MARE_SYSTEM_PROMPT,
        messages: history
      })
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text || "Hmm. Let me think about that.";
    history.push({ role: 'assistant', content: reply });

    res.json({ reply });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ElevenLabs proxy
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
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.6,
          similarity_boost: 0.8,
          style: 0.3
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

// WebSocket for Deepgram streaming
const wss = new WebSocket.Server({ server, path: '/listen' });

wss.on('connection', (clientWs) => {
  console.log('Client connected for transcription');

  const deepgramWs = new WebSocket(
    'wss://api.deepgram.com/v1/listen?model=nova-2&language=en-GB&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&endpointing=400&utterance_end_ms=1200&interim_results=true',
    { headers: { Authorization: `Token ${DEEPGRAM_KEY}` } }
  );

  deepgramWs.on('open', () => console.log('Connected to Deepgram'));

  deepgramWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      const msg = typeof data === 'string' ? data : data.toString('utf8');
      clientWs.send(msg);
    }
  });

  deepgramWs.on('error', (err) => {
    console.error('Deepgram error:', err.message);
    clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
  });

  deepgramWs.on('close', () => console.log('Deepgram connection closed'));

  clientWs.on('message', (audioData) => {
    if (deepgramWs.readyState === WebSocket.OPEN) {
      deepgramWs.send(audioData);
    }
  });

  clientWs.on('close', () => {
    console.log('Client disconnected');
    if (deepgramWs.readyState === WebSocket.OPEN) deepgramWs.close();
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Mare running on port ${PORT}`));
