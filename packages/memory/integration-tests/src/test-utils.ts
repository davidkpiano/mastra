import type { MastraDBMessage } from '@mastra/core/agent';
import type { CoreMessage } from '@mastra/core/llm';
import type { MastraMessageV1 } from '@mastra/core/memory';

const toolArgs = {
  weather: { location: 'New York' },
  calculator: { expression: '2+2' },
  search: { query: 'latest AI developments' },
};

const toolResults = {
  weather: 'Pretty hot',
  calculator: '4',
  search: 'Anthropic blah blah blah',
};

/**
 * Creates a simulated conversation history with alternating messages and occasional tool calls
 * @param threadId Thread ID for the messages
 * @param messageCount Number of turn pairs (user + assistant) to generate
 * @param toolFrequency How often to include tool calls (e.g., 3 means every 3rd assistant message)
 * @returns Array of messages representing the conversation
 */
export function generateConversationHistory({
  threadId,
  resourceId = 'test-resource',
  messageCount = 5,
  toolFrequency = 3,
  toolNames = ['weather', 'calculator', 'search'],
}: {
  threadId: string;
  resourceId?: string;
  messageCount?: number;
  toolFrequency?: number;
  toolNames?: (keyof typeof toolArgs)[];
}): {
  messages: MastraMessageV1[];
  messagesV2: MastraDBMessage[];
  fakeCore: CoreMessage[];
  counts: { messages: number; toolCalls: number; toolResults: number };
} {
  const counts = { messages: 0, toolCalls: 0, toolResults: 0 };
  // Create some words that will each be about one token
  const words = ['apple', 'banana', 'orange', 'grape'];
  // Arguments for different tools

  const messages: MastraDBMessage[] = [];
  const startTime = Date.now();

  // Generate message pairs (user message followed by assistant response)
  for (let i = 0; i < messageCount; i++) {
    // Create user message content
    const userContent = Array(25).fill(words).flat().join(' '); // ~100 tokens

    // Add user message
    const userMessageId = `message-${i * 2}`;
    console.error(`DEBUG generateConversationHistory: Creating user message with id=${userMessageId}`);
    messages.push({
      role: 'user',
      content: { format: 2, parts: [{ type: 'text', text: userContent }] },
      id: userMessageId,
      threadId,
      resourceId,
      createdAt: new Date(startTime + i * 2000), // Each pair 2 seconds apart
    });
    counts.messages++;

    // Determine if this assistant message should include a tool call
    const includeTool = i > 0 && i % toolFrequency === 0;
    const toolIndex = includeTool ? (i / toolFrequency) % toolNames.length : -1;
    const toolName = includeTool ? toolNames[toolIndex] : '';
    console.error(`DEBUG generateConversationHistory: i=${i}, includeTool=${includeTool}, toolName=${toolName}`);

    // Create assistant message
    if (includeTool) {
      // Use the same ID for both tool call and result messages to enable consolidation
      const toolMessageId = `tool-message-${i * 2 + 1}`;
      console.error(`DEBUG generateConversationHistory: Creating tool CALL message with id=${toolMessageId}`);
      
      // Assistant message with tool call (state: 'call')
      messages.push({
        role: 'assistant',
        content: {
          format: 2,
          parts: [
            { type: 'text', text: `Using ${toolName} tool:` },
            {
              type: 'tool-invocation',
              toolInvocation: {
                state: 'call',
                toolCallId: `tool-${i}`,
                toolName,
                args: toolArgs[toolName as keyof typeof toolArgs] || {},
              },
            },
          ],
        },
        id: toolMessageId,
        threadId,
        resourceId,
        createdAt: new Date(startTime + i * 2000 + 1000), // 1 second after user message
      });
      console.error(`DEBUG generateConversationHistory: Pushed tool CALL message with id=${toolMessageId}`);
      counts.messages++;
      counts.toolCalls++;

      // Assistant message with tool result (state: 'result')
      console.error(`DEBUG generateConversationHistory: Creating tool RESULT message with id=${toolMessageId}`);
      messages.push({
        role: 'assistant',
        content: {
          format: 2,
          parts: [
            {
              type: 'tool-invocation',
              toolInvocation: {
                state: 'result',
                toolCallId: `tool-${i}`,
                toolName,
                args: toolArgs[toolName as keyof typeof toolArgs] || {},
                result: toolResults[toolName as keyof typeof toolResults] || {},
              },
            },
          ],
        },
        id: toolMessageId,
        threadId,
        resourceId,
        createdAt: new Date(startTime + i * 2000 + 1500), // 0.5 seconds after tool call
      });
      console.error(`DEBUG generateConversationHistory: Pushed tool RESULT message with id=${toolMessageId}`);
      counts.messages++;
      counts.toolResults++;
    } else {
      // Regular assistant text message
      const assistantMessageId = `message-${i * 2 + 1}`;
      console.error(`DEBUG generateConversationHistory: Creating regular assistant message with id=${assistantMessageId}`);
      messages.push({
        role: 'assistant',
        content: { format: 2, parts: [{ type: 'text', text: Array(15).fill(words).flat().join(' ') }] }, // ~60 tokens
        id: assistantMessageId,
        threadId,
        resourceId,
        createdAt: new Date(startTime + i * 2000 + 1000), // 1 second after user message
      });
      counts.messages++;
    }
  }

  const latestMessage = messages.at(-1)!;
  if (latestMessage.role === `assistant` && latestMessage.content.parts.at(-1)?.type === `tool-invocation`) {
    const userContent = Array(25).fill(words).flat().join(' '); // ~100 tokens
    const finalUserMessageId = `message-${messageCount * 2}`;
    const finalUserMessageTime = startTime + messageCount * 2000;
    console.error(`DEBUG generateConversationHistory: Creating final user message with id=${finalUserMessageId} (messageCount=${messageCount})`);
    messages.push({
      role: 'user',
      content: { format: 2, parts: [{ type: 'text', text: userContent }] },
      id: finalUserMessageId,
      threadId,
      resourceId,
      createdAt: new Date(finalUserMessageTime),
    });
    counts.messages++;
  }

  // Consolidate tool call and result messages into single messages with both parts
  // This mimics what MessageList.add does with messageSource: 'response'
  const consolidatedMessages: MastraDBMessage[] = [];
  console.error(`DEBUG generateConversationHistory: Starting consolidation with ${messages.length} messages`);
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const hasToolCall = msg.content.parts.some(
      p => p.type === 'tool-invocation' && p.toolInvocation.state === 'call'
    );
    
    console.error(`DEBUG generateConversationHistory: Message ${i} (id=${msg.id}, role=${msg.role}) hasToolCall=${hasToolCall}`);
    
    if (hasToolCall && i + 1 < messages.length) {
      const nextMsg = messages[i + 1];
      const hasToolResult = nextMsg.content.parts.some(
        p => p.type === 'tool-invocation' && p.toolInvocation.state === 'result'
      );
      
      console.error(`DEBUG generateConversationHistory: Next message ${i + 1} (id=${nextMsg.id}) hasToolResult=${hasToolResult}, sameId=${nextMsg.id === msg.id}`);
      
      // If next message is a tool result with the same ID, consolidate them
      if (hasToolResult && nextMsg.id === msg.id) {
        const consolidatedMsg: MastraDBMessage = {
          ...msg,
          content: {
            ...msg.content,
            parts: [...msg.content.parts, ...nextMsg.content.parts],
          },
        };
        console.error(`DEBUG generateConversationHistory: Consolidated messages ${i} and ${i + 1} into single message with ${consolidatedMsg.content.parts.length} parts`);
        consolidatedMessages.push(consolidatedMsg);
        i++; // Skip the next message as we've already consolidated it
        continue;
      }
    }
    
    consolidatedMessages.push(msg);
  }
  console.error(`DEBUG generateConversationHistory: Consolidation complete, ${consolidatedMessages.length} messages`);

  
  return {
    fakeCore: consolidatedMessages as any as CoreMessage[],
    messages: consolidatedMessages as any,
    messagesV2: consolidatedMessages,
    counts,
  };
}

export function filterToolCallsByName(messages: CoreMessage[], name: string) {
  return messages.filter(
    m => Array.isArray(m.content) && m.content.some(part => part.type === 'tool-call' && part.toolName === name),
  );
}
export function filterToolResultsByName(messages: CoreMessage[], name: string) {
  return messages.filter(
    m => Array.isArray(m.content) && m.content.some(part => part.type === 'tool-result' && part.toolName === name),
  );
}
