require('dotenv').config();
require('colors');

const express = require('express');
const ExpressWs = require('express-ws');
const bodyParser = require('body-parser');
const twilio = require('twilio');

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

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// In-memory store for call LLM variables
const callSessionVars = {};

// API key for authentication
const API_KEY = process.env.SERVER_API_KEY;

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

app.ws('/connection', (ws, req) => {
  try {
    ws.on('error', console.error);
    let streamSid;
    let callSid;
    let agent = null;
    let agentReady = false;
    let audioBufferQueue = [];

    // Debug log to check the full websocket request URL
    console.log('WebSocket req.url:', req.url); // DEBUG

    // Wait for the 'start' event to get callSid
    ws.on('message', async function message(data) {
      const msg = JSON.parse(data);
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;
        console.log(`Twilio -> Starting Media Stream for ${streamSid}`.underline.red);
        console.log('callSid from start event:', callSid); // DEBUG
        const llmVars = callSid ? (callSessionVars[callSid] || {}) : {};
        console.log('llmVars for connection:', llmVars); // DEBUG
        // Instantiate and connect the Deepgram Voice Agent with llmVars
        agent = new VoiceAgentService(llmVars);
        await agent.connect();
        agentReady = true;
        console.log('VoiceAgentService connected');
        // Flush any buffered audio
        audioBufferQueue.forEach(audioBuffer => agent.sendAudio(audioBuffer));
        audioBufferQueue = [];
        // Forward Deepgram Agent audio back to Twilio
        if (agent.connection) {
          agent.connection.on(AgentEvents.Audio, (audioData) => {
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
      } else if (msg.event === 'media') {
        const audioBuffer = Buffer.from(msg.media.payload, 'base64');
        if (agentReady && agent) {
          agent.sendAudio(audioBuffer);
        } else {
          audioBufferQueue.push(audioBuffer);
        }
      } else if (msg.event === 'stop') {
        console.log(`Twilio -> Media stream ${streamSid} ended.`.underline.red);
        if (agent) agent.finish();
      }
    });
  } catch (err) {
    console.log(err);
  }
});

// Secure webhook for n8n to trigger outbound calls
app.post('/api/call', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { to, llm_variables } = req.body;
  if (!to) return res.status(400).json({ error: 'Missing "to" number' });
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const call = await client.calls.create({
      to,
      from: process.env.FROM_NUMBER,
      url: `https://${process.env.SERVER}/twilio/voice`
    });
    callSessionVars[call.sid] = llm_variables || {};
    console.log('callSessionVars after /api/call:', callSessionVars);
    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Twilio webhook for when call connects
app.post('/twilio/voice', async (req, res) => {
  const callSid = req.query.callSid || req.body.CallSid;
  const llmVars = callSessionVars[callSid] || {};
  console.log('callSid in /twilio/voice:', callSid, 'llmVars:', llmVars);
  // Do NOT set process.env variables here anymore
  // Respond with TwiML to connect to media stream
  const response = new VoiceResponse();
  const connect = response.connect();
  // Pass llmVars as a query param to the websocket connection
  connect.stream({ url: `wss://${process.env.SERVER}/connection?callSid=${callSid}` });
  res.type('text/xml');
  res.end(response.toString());
});

app.listen(PORT);
console.log(`Server running on port ${PORT}`);
