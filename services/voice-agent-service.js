const { createClient, AgentEvents } = require("@deepgram/sdk");
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

class VoiceAgentService {
  constructor(llmVars = {}) {
    this.connection = null;
    this.llmVars = llmVars;
  }

  async connect() {
    this.connection = deepgram.agent();

    this.connection.on(AgentEvents.Welcome, () => {
      console.log("Welcome to the Deepgram Voice Agent!");
      // Get system prompt and greeting from .env
      let systemPrompt = (process.env.AI_SYSTEM_PROMPT || "You are a friendly AI assistant.").replace(/\\n/g, "\n");
      let greeting = (process.env.AI_GREETING || "Hello! How can I help you today?").replace(/\\n/g, "\n");
      // Replace placeholders with llmVars
      Object.entries(this.llmVars).forEach(([key, value]) => {
        systemPrompt = systemPrompt.replace(new RegExp(`\\{\\{${key}\\}\}`, 'g'), value);
        greeting = greeting.replace(new RegExp(`\\{\\{${key}\\}\}`, 'g'), value);
      });
      console.log('Final systemPrompt:', systemPrompt); // DEBUG
      console.log('Final greeting:', greeting); // DEBUG
      this.connection.configure({
        audio: {
          input: { encoding: "mulaw", sample_rate: 8000 },
          output: { encoding: "mulaw", sample_rate: 8000, container: "none" }
        },
        agent: {
          language: "en",
          listen: { provider: { type: "deepgram", model: "nova-3" } },
          think: { provider: { type: "open_ai", model: "gpt-4o-mini" }, prompt: systemPrompt },
          speak: { provider: { type: "deepgram", model: "aura-2-thalia-en" } },
          greeting: greeting
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
      if (typeof this.connection.close === 'function') {
        this.connection.close();
      } else if (typeof this.connection.disconnect === 'function') {
        this.connection.disconnect();
      }
    }
  }
}

module.exports = { VoiceAgentService }; 