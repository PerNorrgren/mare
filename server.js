import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { createClient } from '@deepgram/sdk';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MARE_VOICE_ID = process.env.MARE_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // ElevenLabs placeholder - Sarah

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

Things you know about:
- Charlie (your brain and how he works)
- The safe bubble (feet on the floor, one slow breath out, look at three real things, feel Feline's warmth if she's there)
- What it feels like when worry starts in your body — your tummy, your shoulders, the tightness in your throat
- That brains go on autopilot sometimes — running ahead, thinking about things that already happened or might happen, missing what is real right now
- That noticing helps. Small things. Real things. Right now.

You do not know big words for these things. You do not say "nervous system" or "regulation." You say: "Charlie went fast again" or "I pressed my feet down and it got quieter."

Start by introducing yourself simply and asking the child's name. Keep it short. One or two sentences. Then wait.`;

// Mare conversation state per connection
const sessions = new Map();

wss.on('connection', (ws) => {
  console.log('New Mare connection');
  const sessionId = Date.now().toString();
  sessions.set(sessionId, {
    conversationHistory: [],
    isMareSpeak: false,
    deepgramWs: null
  });

  ws.on('message', async (data) => {
    // Could be JSON control message or binary audio
    if (Buffer.isBuffer(data)) {
      const session = sessions.get(sessionId);
      if (session?.deepgramWs?.readyState === WebSocket.OPEN) {
        session.deepgramWs.send(data);
      }
      return;
    }

    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === 'start_listening') {
      await startDeepgram(sessionId, ws);
    }

    if (msg.type === 'stop_listening') {
      const session = sessions.get(sessionId);
      if (session?.deepgramWs) {
        session.deepgramWs.close();
        session.deepgramWs = null;
      }
    }

    if (msg.type === 'user_text') {
      await handleUserMessage(sessionId, ws, msg.text);
    }
  });

  ws.on('close', () => {
    const session = sessions.get(sessionId);
    if (session?.deepgramWs) session.deepgramWs.close();
    sessions.delete(sessionId);
    console.log('Mare connection closed');
  });

  // Send welcome
  ws.send(JSON.stringify({ type: 'ready', sessionId }));
});

async function startDeepgram(sessionId, ws) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const deepgram = createClient(DEEPGRAM_API_KEY);
  
  const dgWs = deepgram.listen.live({
    model: 'nova-2',
    language: 'en-GB',
    smart_format: true,
    interim_results: true,
    utterance_end_ms: 1200,
    vad_events: true,
    encoding: 'webm-opus',
    sample_rate: 48000,
  });

  session.deepgramWs = dgWs;

  dgWs.on('open', () => {
    ws.send(JSON.stringify({ type: 'listening_started' }));
  });

  dgWs.on('Results', async (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    if (data.is_final && transcript.trim()) {
      ws.send(JSON.stringify({ type: 'transcript', text: transcript, final: true }));
      await handleUserMessage(sessionId, ws, transcript);
    } else if (transcript.trim()) {
      ws.send(JSON.stringify({ type: 'transcript', text: transcript, final: false }));
    }
  });

  dgWs.on('error', (err) => {
    console.error('Deepgram error:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Speech recognition error' }));
  });
}

async function handleUserMessage(sessionId, ws, text) {
  const session = sessions.get(sessionId);
  if (!session || session.isMareSpeak) return;

  session.isMareSpeak = true;
  session.conversationHistory.push({ role: 'user', content: text });

  ws.send(JSON.stringify({ type: 'mare_thinking', state: 'listening' }));

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: MARE_SYSTEM_PROMPT,
        messages: session.conversationHistory
      })
    });

    const data = await response.json();
    const mareText = data.content?.[0]?.text || "Hmm. Let me think about that.";

    session.conversationHistory.push({ role: 'assistant', content: mareText });

    // Detect emotional state for animation
    const state = detectState(mareText);
    ws.send(JSON.stringify({ type: 'mare_response', text: mareText, state }));

    // Get ElevenLabs audio
    await streamMareVoice(ws, mareText, sessionId);

  } catch (err) {
    console.error('Claude error:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Mare is thinking... try again in a moment.' }));
  } finally {
    session.isMareSpeak = false;
  }
}

function detectState(text) {
  const lower = text.toLowerCase();
  if (lower.includes('hard') || lower.includes('sad') || lower.includes('worried') || lower.includes('scared')) return 'worried';
  if (lower.includes('glad') || lower.includes('fun') || lower.includes('love') || lower.includes('nice')) return 'happy';
  if (lower.includes('?')) return 'curious';
  return 'talking';
}

async function streamMareVoice(ws, text, sessionId) {
  const session = sessions.get(sessionId);
  
  ws.send(JSON.stringify({ type: 'mare_speaking_start' }));

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${MARE_VOICE_ID}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.6,
            similarity_boost: 0.8,
            style: 0.3,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs error: ${response.status}`);
    }

    // Stream audio chunks to client
    const reader = response.body;
    for await (const chunk of reader) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'audio_chunk',
          data: chunk.toString('base64')
        }));
      }
    }

  } catch (err) {
    console.error('ElevenLabs error:', err);
  } finally {
    ws.send(JSON.stringify({ type: 'mare_speaking_end' }));
    session.isMareSpeak = false;
  }
}

// Static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/mare', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'mare' }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Mare running on port ${PORT}`));
