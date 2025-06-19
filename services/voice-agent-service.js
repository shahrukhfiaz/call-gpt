const { createClient, AgentEvents } = require("@deepgram/sdk");
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

class VoiceAgentService {
  constructor() {
    this.connection = null;
  }

  async connect() {
    this.connection = deepgram.agent();

    this.connection.on(AgentEvents.Welcome, () => {
      console.log("Welcome to the Deepgram Voice Agent!");
      this.connection.configure({
        audio: {
          input: { encoding: "linear16", sample_rate: 24000 },
          output: { encoding: "mulaw", sample_rate: 8000, container: "none" }
        },
        agent: {
          language: "en",
          listen: { provider: { type: "deepgram", model: "nova-3" } },
          think: { provider: { type: "open_ai", model: "gpt-4o-mini" }, prompt: "You are a friendly AI assistant." },
          speak: { provider: { type: "deepgram", model: "aura-2-thalia-en" } },
          greeting: "Hello! How can I help you today?"
        }
      });
      console.log("Deepgram agent configured!");
    });

    // Keep the connection alive
    setInterval(() => {
      this.connection.keepAlive();
    }, 5000);

    // Handle conversation text
    this.connection.on(AgentEvents.ConversationText, (data) => {
      console.log("Conversation text:", data);
    });
    // Handle audio output
    this.connection.on(AgentEvents.Audio, (data) => {
      console.log("Audio chunk received:", data.length, "bytes");
      // TODO: Forward this audio to Twilio
    });
    // Handle errors
    this.connection.on(AgentEvents.Error, (err) => {
      console.error("Agent error:", err);
    });
    this.connection.on(AgentEvents.AgentAudioDone, () => {
      console.log("Agent audio done");
    });
  }

  // Send audio to the agent
  sendAudio(audioChunk) {
    if (this.connection) {
      this.connection.send(audioChunk);
    }
  }

  // Finish the agent session
  finish() {
    if (this.connection) {
      this.connection.finish();
    }
  }
}

module.exports = { VoiceAgentService }; 