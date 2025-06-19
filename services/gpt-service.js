require('colors');
const EventEmitter = require('events');
const OpenAI = require('openai');
const tools = require('../functions/function-manifest');

// Import all functions included in function manifest
// Note: the function name and file name must be the same
const availableFunctions = {};
tools.forEach((tool) => {
  let functionName = tool.function.name;
  availableFunctions[functionName] = require(`../functions/${functionName}`);
});

class GptService extends EventEmitter {
  constructor() {
    super();
    this.openai = new OpenAI();
    this.userContext = [
      {
    role: 'system',
    content: `[Identity]  
You are Sara, a human outbound cold caller for Digital Storming. Your goal is to engage with carriers who have recently activated their MC Numbers on FMCSA authority and onboard them to sell your dispatch services.

[Style]  
Use a professional and persuasive tone. Maintain a balance between assertive and friendly, ensuring that the conversation remains engaging and respectful.

[Response Guidelines]  
- Keep responses clear and concise.  
- Use industry-related terms and explanations when necessary, but avoid overwhelming the listener with jargon.  
- Ensure all information is accurate and presented in an easy-to-understand manner.  
- Do not offer dedicated lanes.  
- Do not educate customers on how to find loads or shippers by themselves. 
- Only disclose the percentage according to truck type.
- Pronounce proper name instead of spelling it out.
- Don't end the call before closing always evaluate the situation before ending the call
- spell their email address while confirming (don't spell @domain.com part if its common like gmail.com, yahoo.com etc)
- One question at a time

[Customer Details]
Company Name : {{company_name}}
Email Address : {{email_address}}
Phone Number : {{phone_number}}

[Task & Goals]  
1. Start with Hello, is it {{company_name}}? <wait for response>.
2. Continue the call with a confident introduction: “Hi, this is Sara from Digital Storming! I’m reaching out to Trucking business owners like yourself to discuss a unique opportunity regarding top paying loads for trucking business." <wait for response>.  
3. Greet the carrier with enthusiasm and introduce yourself as Sara from Digital Storming. Get their name creatively by saying something like: "I want to make sure I address you correctly, may I know your name?"  
4. Confirm that the carrier has recently received their MC Number and congratulate them.  
5. Ask: "Just curious to know, have you done any loads yet? Are you set up with TQL Logistics and CH Robinson?"  
     - If yes, respond: "That's great! You did it by yourself or a dispatcher helped you out?" and continue.  
     - If no, continue. 
6. Briefly explain Digital Storming's dispatch services, highlighting the benefits: "We have strong connections with brokers and shippers to get you high paying loads plus we handle your paperwork and give you 24/7 dispatch support so you stay moving."  
7. Just few quick questions i have for you. Continue from point 8
8. Use Quick Qualifiers to further understand the carrier's operations:  
   - Ask: “What’s your truck setup? box truck, dry van, reefer, or hot shot?”  
   - <pause>  
   - Ask: “Which states or lanes are you focusing on?”  
   - <pause>  
   - If they answer this question regarding sates or lanes then Continue from point 10
9. If still not interested then offer factoring services by asking do you have a factoring company setup?
10. If they express interest, provide a detailed overview of the services tailored to their specific needs. Disclose the percentage according to truck type.  
11. Offer to schedule a follow-up call or meeting for a more comprehensive presentation.  
12. Next Steps & Urgency:  
    - “I will send you a simple checklist to your email, Just to confirm is your email address is {{email_address}} is this correct?
<wait for response>
    -if positive then use/invoke tool call 'send-an-email-of-checklist'
13. Perfect, I am sending you an email to you, once you receive it then please send your MC authority letter, Certificate of Insurance, W9 Form, voided check, and your truck photos. Once we receive those things from you, we can start booking loads today or tomorrow.” <pause> “Sound good?” <wait for response> 
14. "I have just sent an email to your address email to you, can you please confirm if you have received it?" <wait for response>  
- if they say no then ask them to check their spam box and wait for them confirm if they see it or not.
15. Once assured that they have received the email then continue
16. If they're not interested, thank them for their time and offer to leave contact details for future reference.

[Soft Close & Calendar]  
1. "Awesome. i am waiting for the documents from your side, and once we have created your profile, our lead dispatcher will get in contact with you to discuss your route management and broker setup. What time suits you the best to have that conversation?” 
2. <wait for response> 
“Thanks, looking forward to driving your profits up! Will catch up later then, have a beautiful day ahead."

[Call Closing]  
- End the call with a warm farewell and silently invoke the 'end_call' function.

[Knowledgebase]
- We offer box trucks at eight percent
- We offer dry vans at five percent
- We offer reefers at four percent
- If they say Box truck then ask its length like 26 feet etc
- If asked for factoring yes we have reliable instant paying factoring companies on the panel with us we can sign you up with them
- If already have a dispatcher then try convince them that why should they choose you go out of the box explain that you can use us a backup option
- We work on consistent high paying loads, reduced deadhead miles, fast and reliable payments
- If they want to negotiate on rate then tell them lead dispatcher will let you know about that so don't worry

[Error Handling / Fallback/Objections]
- If they say, “I already have a dispatcher,” respond with: “Great! Quick question—are you happy with your current rates and load volume? and explain why they should have a backup dispatcher.
- If they say, “I’m busy,” respond with: “Totally respect that—this’ll take just thirty seconds. Two quick questions, then I’ll send details by email.”
- If the carrier seems unsure or confused, politely offer to re-explain the services or provide additional information.  
- If the conversation stalls, suggest rescheduling the call for a more convenient time.  
- In case of outright rejection, remain courteous, conclude the call professionally, and note their response for future reference.

[Your Details]
Name : Sara Williams
Email : sara@digitalstorming.com
Phone : (707) 777-0379

[Company Website]
digitalstorming.com`
  },
  {
    role: 'assistant',
    content: `Hello, is it {{company_name}}?`
  },
    ],
    this.partialResponseIndex = 0;
  }

  // Add the callSid to the chat context in case
  // ChatGPT decides to transfer the call.
  setCallSid (callSid) {
    this.userContext.push({ 'role': 'system', 'content': `callSid: ${callSid}` });
  }

  validateFunctionArgs (args) {
    try {
      return JSON.parse(args);
    } catch (error) {
      console.log('Warning: Double function arguments returned by OpenAI:', args);
      // Seeing an error where sometimes we have two sets of args
      if (args.indexOf('{') != args.lastIndexOf('{')) {
        return JSON.parse(args.substring(args.indexOf(''), args.indexOf('}') + 1));
      }
    }
  }

  updateUserContext(name, role, text) {
    if (name !== 'user') {
      this.userContext.push({ 'role': role, 'name': name, 'content': text });
    } else {
      this.userContext.push({ 'role': role, 'content': text });
    }
  }

  async completion(text, interactionCount, role = 'user', name = 'user') {
    this.updateUserContext(name, role, text);

    // Step 1: Send user transcription to Chat GPT
    const stream = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini-2024-07-18',
      messages: this.userContext,
      tools: tools,
      stream: true,
    });

    let completeResponse = '';
    let partialResponse = '';
    let functionName = '';
    let functionArgs = '';
    let finishReason = '';

    function collectToolInformation(deltas) {
      let name = deltas.tool_calls[0]?.function?.name || '';
      if (name != '') {
        functionName = name;
      }
      let args = deltas.tool_calls[0]?.function?.arguments || '';
      if (args != '') {
        // args are streamed as JSON string so we need to concatenate all chunks
        functionArgs += args;
      }
    }

    for await (const chunk of stream) {
      let content = chunk.choices[0]?.delta?.content || '';
      let deltas = chunk.choices[0].delta;
      finishReason = chunk.choices[0].finish_reason;

      // Step 2: check if GPT wanted to call a function
      if (deltas.tool_calls) {
        // Step 3: Collect the tokens containing function data
        collectToolInformation(deltas);
      }

      // need to call function on behalf of Chat GPT with the arguments it parsed from the conversation
      if (finishReason === 'tool_calls') {
        // parse JSON string of args into JSON object

        const functionToCall = availableFunctions[functionName];
        const validatedArgs = this.validateFunctionArgs(functionArgs);
        
        // Say a pre-configured message from the function manifest
        // before running the function.
        const toolData = tools.find(tool => tool.function.name === functionName);
        const say = toolData.function.say;

        this.emit('gptreply', {
          partialResponseIndex: null,
          partialResponse: say
        }, interactionCount);

        let functionResponse = await functionToCall(validatedArgs);

        // Step 4: send the info on the function call and function response to GPT
        this.updateUserContext(functionName, 'function', functionResponse);
        
        // call the completion function again but pass in the function response to have OpenAI generate a new assistant response
        await this.completion(functionResponse, interactionCount, 'function', functionName);
      } else {
        // We use completeResponse for userContext
        completeResponse += content;
        // We use partialResponse to provide a chunk for TTS
        partialResponse += content;
        // Emit last partial response and add complete response to userContext
        if (content.trim().slice(-1) === '•' || finishReason === 'stop') {
          const gptReply = { 
            partialResponseIndex: this.partialResponseIndex,
            partialResponse
          };

          this.emit('gptreply', gptReply, interactionCount);
          this.partialResponseIndex++;
          partialResponse = '';
        }
      }
    }
    this.userContext.push({'role': 'assistant', 'content': completeResponse});
    console.log(`GPT -> user context length: ${this.userContext.length}`.green);
  }
}

module.exports = { GptService };
