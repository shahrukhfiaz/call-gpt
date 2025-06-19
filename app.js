require('dotenv').config();
require('colors');

const express = require('express');
const ExpressWs = require('express-ws');

const { GptService } = require('./services/gpt-service');
const { StreamService } = require('./services/stream-service');
const { TranscriptionService } = require('./services/transcription-service');
const { TextToSpeechService } = require('./services/tts-service');
const { recordingService } = require('./services/recording-service');
const { VoiceAgentService } = require('./services/voice-agent-service');
const { AgentEvents } = require("@deepgram/sdk");

const VoiceResponse = require('twilio').twiml.VoiceResponse;

const app = express();
ExpressWs(app);

const PORT = process.env.PORT || 3000;

app.post('/incoming', (req, res) => {
  try {
    const response = new VoiceResponse();
    const connect = response.connect();
    connect.stream({ url: `wss://${process.env.SERVER}/connection` });
  
    res.type('text/xml');
    res.end(response.toString());
  } catch (err) {
    console.log(err);
  }
});

app.ws('/connection', (ws) => {
  try {
    ws.on('error', console.error);
    let streamSid;
    let callSid;

    // Instantiate and connect the Deepgram Voice Agent
    const agent = new VoiceAgentService();
    agent.connect().then(() => {
      console.log('VoiceAgentService connected');
    });

    // Forward Twilio audio to Deepgram Agent
    ws.on('message', function message(data) {
      const msg = JSON.parse(data);
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;
        console.log(`Twilio -> Starting Media Stream for ${streamSid}`.underline.red);
      } else if (msg.event === 'media') {
        // Twilio sends base64 mulaw audio in msg.media.payload
        // Convert base64 to Buffer and send to agent
        const audioBuffer = Buffer.from(msg.media.payload, 'base64');
        agent.sendAudio(audioBuffer);
      } else if (msg.event === 'stop') {
        console.log(`Twilio -> Media stream ${streamSid} ended.`.underline.red);
        agent.finish();
      }
    });

    // Forward Deepgram Agent audio back to Twilio
    if (agent.connection) {
      agent.connection.on(AgentEvents.Audio, (audioData) => {
        // audioData is a Buffer (mulaw/8000), Twilio expects base64
        const base64Audio = audioData.toString('base64');
        ws.send(
          JSON.stringify({
            streamSid,
            event: 'media',
            media: { payload: base64Audio },
          })
        );
      });
    }
  } catch (err) {
    console.log(err);
  }
});

app.listen(PORT);
console.log(`Server running on port ${PORT}`);
