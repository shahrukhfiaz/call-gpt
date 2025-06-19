require('dotenv').config();
const { Buffer } = require('node:buffer');
const EventEmitter = require('events');
const WebSocket = require('ws');

class TextToSpeechService extends EventEmitter {
  constructor() {
    super();
    this.nextExpectedIndex = 0;
    this.speechBuffer = {};
  }

  async generate(gptReply, interactionCount) {
    const { partialResponseIndex, partialResponse } = gptReply;
    if (!partialResponse) return;

    const url = `wss://api.deepgram.com/v1/speak?model=${process.env.VOICE_MODEL}&encoding=mulaw&sample_rate=8000&container=none`;

    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`
      }
    });

    ws.on('open', () => {
      ws.send(JSON.stringify({ text: partialResponse }));
    });

    ws.on('message', (data) => {
      // Emit streamed audio chunk immediately
      const base64Chunk = Buffer.from(data).toString('base64');
      this.emit('speech', partialResponseIndex, base64Chunk, partialResponse, interactionCount);
    });

    ws.on('error', (err) => {
      console.error('TTS WebSocket error:', err);
    });

    ws.on('close', () => {
      console.log('Deepgram TTS WebSocket closed');
    });
  }
}

module.exports = { TextToSpeechService };
