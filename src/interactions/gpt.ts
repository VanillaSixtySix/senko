import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { BotInteraction } from '../classes/BotInteraction';
import { BotClient } from '../classes/BotClient';
import config from '../../config.json';

export default class GPT implements BotInteraction {
    constructor(private client: BotClient) {}

    static guildOnly = false;

    static builders = [
        new SlashCommandBuilder()
            .setName('gpt')
            .setDescription('Submits a query to OpenAI using the latest gpt-4-turbo model.')
            .addStringOption(option =>
                option
                    .setName('query')
                    .setDescription('The query to send')
                    .setRequired(true)
            ),
    ];

    conversations = new Map<string, ConversationMessage[]>();

    async onChatInteraction(interaction: ChatInputCommandInteraction) {
        const query = interaction.options.getString('query')!;

        const conversationKey = interaction.channelId + interaction.user.id;

        await interaction.deferReply();

        let conversation = this.conversations.get(conversationKey);
        if (!conversation) {
            conversation = [
                {
                    role: 'system',
                    content: 'You are an assistant.',
                },
                {
                    role: 'user',
                    content: query,
                },
            ];
        }

        const body = {
            model: 'gpt-4-turbo',
            messages: conversation,
        };

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + config.openAIKey,
            },
            body: JSON.stringify(body),
        });

        let data: any;
        try {
            data = await res.json();
        } catch (err) {
            console.error('Failed to convert OpenAI response to JSON:', err);
            await interaction.editReply('Sorry - the OpenAI API request failed.');
            return;
        }

        if (!res.ok) {
            console.error('Failed to fetch OpenAI completions endpoint:', (data as ErrorResponse).error.message);
            await interaction.editReply('Sorry - the OpenAI API request failed.');
            return;
        }

        const responseMessage = (data as CompletionResponse).choices[0].message;

        this.conversations.set(conversationKey, [
            ...conversation,
            responseMessage,
        ]);

        const cleaned = responseMessage.content
            .split('\n')
            .map(line => '> ' + line)
            .join('\n');

        const clearButton = new ButtonBuilder()
            .setCustomId('clear')
            .setLabel('Clear Memory')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder()
            .setComponents(clearButton);

        const reply = await interaction.editReply({
            content: cleaned,
            components: [row as any],
        });

        const collectorFilter = (i: any) => i.user.id === interaction.user.id;
        try {
            const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60 * 1000 });

            if (confirmation.customId === 'clear') {
                this.conversations.delete(conversationKey);
                clearButton
                    .setLabel('Memory Cleared')
                    .setDisabled(true);
    
                row.setComponents(clearButton);
                await confirmation.update({ components: [row as any] });
    
                setTimeout(async () => {
                    await confirmation.editReply({ components: [] });
                }, 5 * 1000);
            }
        } catch (err) {
            // Probably a timeout
            await interaction.editReply({ components: [] });
        }
    }
}

interface ConversationMessage {
    role: 'user' | 'system' | 'assistant';
    content: string;
}

interface ErrorResponse {
    error: {
        message: string;
    };
}

interface CompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        message: ConversationMessage;
        logprobs: null;
        finish_reason: string;
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    system_fingerprint: string;
}
