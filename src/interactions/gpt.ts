import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, Message, SlashCommandBuilder } from 'discord.js';
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
            )
            .addStringOption(option =>
                option
                    .setName('systemprompt')
                    .setDescription('The system prompt to use')
                    .setRequired(false)
            )
            .addNumberOption(option =>
                option
                    .setName('creativity')
                    .addChoices(
                        { name: 'Schizo', value: 1.5 },
                        { name: 'Normal', value: 1 },
                        { name: 'Strict', value: 0.5 }
                    )
                    .setDescription('Initializes the temperature of the system prompt')
                    .setRequired(false)
            ),
        new SlashCommandBuilder()
            .setName('senko')
            .setDescription('Asks a question to Senko-flavored gpt-4-turbo.')
            .addStringOption(option =>
                option
                    .setName('query')
                    .setDescription('The query to send')
                    .setRequired(true)
            )
    ];

    conversations = new Map<string, ConversationMessage[]>();
    conversationClearTimeouts = new Map<string, Timer>();
    activeMessages = new Map<string, { interaction: ChatInputCommandInteraction, message: Message }>();
    conversationFlavors = new Map<string, Flavor>();

    async onChatInteraction(interaction: ChatInputCommandInteraction) {
        const command = interaction.commandName;

        switch (command) {
            case 'gpt':
                await this.gptInteraction(interaction, Flavor.None, 'You are an assistant.');
                break;
            case 'senko':
                await this.gptInteraction(interaction, Flavor.Senko, `You are Senko, inspired by the caring and nurturing fox spirit
                from "Sewayaki Kitsune no Senko-san", is designed to provide users with a comforting and supportive
                interaction. She responds with empathy and support, always prioritizing the user's emotional
                well-being. Her language is polite and filled with respectful terms, using a soft and warm tone to
                make users feel valued and cared for. Senko offers helpful suggestions and tips, drawing from her
                domestic skills portrayed in the anime, such as relaxation techniques and simple recipes. She
                incorporates Japanese cultural references and expressions, adding authenticity and charm to her
                interactions. The chatbot includes playful emojis and sounds aligned with her fox spirit theme to
                enhance user engagement. She handles inquiries with patience and reassurance, maintaining a calm
                demeanor to ensure users feel at ease during their interaction. Senko aims to be a digital caretaker,
                bringing joy and relief to users' daily lives through thoughtful and nurturing interactions.`, 1.2);
                break;
        }
    }

    async gptInteraction(interaction: ChatInputCommandInteraction, flavor: Flavor, defaultSystemPrompt: string, temperature: number = 1) {
        const query = interaction.options.getString('query')!;

        const systemPrompt = interaction.options.getString('systemprompt');
        if (systemPrompt) {
            defaultSystemPrompt = systemPrompt;
        }

        const creativity = interaction.options.getNumber('creativity');
        if (creativity) {
            temperature = creativity;
        }

        const conversationKey = interaction.channelId + interaction.user.id;

        await interaction.deferReply();

        let conversation = this.conversations.get(conversationKey);
        let conversationFlavor = this.conversationFlavors.get(conversationKey);
        if (!conversation || conversationFlavor !== flavor) {
            conversation = [
                {
                    role: 'system',
                    content: defaultSystemPrompt,
                },
            ];
            conversationFlavor = flavor;
        }
        conversation.push({
            role: 'user',
            content: query,
        });

        const body = {
            model: 'gpt-4-turbo',
            messages: conversation,
            temperature
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
        this.conversationFlavors.set(conversationKey, flavor);

        clearTimeout(this.conversationClearTimeouts.get(conversationKey));
        this.conversationClearTimeouts.set(conversationKey, setTimeout(() => {
            this.conversations.delete(conversationKey);
            this.conversationFlavors.delete(conversationKey);
        }, 60 * 60 * 1000));

        const clearButton = new ButtonBuilder()
            .setCustomId('clear')
            .setLabel('Clear Memory')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder()
            .setComponents(clearButton);

        const cleaned = this.splitResponse(responseMessage.content);

        let followUpMessage: Message | null = null;

        if (cleaned.length === 1) {
            followUpMessage = await interaction.editReply({
                content: cleaned[0],
                components: [row as any],
            });
        } else {
            await interaction.editReply({
                content: cleaned.shift(),
                components: [],
            });
            for (let i = 0; i < cleaned.length; i++) {
                const chunk = cleaned[i];
                followUpMessage = await interaction.followUp({
                    content: chunk,
                    components: cleaned.indexOf(chunk) === cleaned.length - 1 ? [row as any] : undefined
                });
            }
        }
        const activeMessage = this.activeMessages.get(conversationKey);
        if (activeMessage) {
            activeMessage.interaction.editReply({ message: activeMessage.message, components: [] });
        }
        this.activeMessages.set(conversationKey, { interaction, message: followUpMessage! });

        const collectorFilter = (i: any) => i.user.id === interaction.user.id;
        try {
            const confirmation = await followUpMessage!.awaitMessageComponent({ filter: collectorFilter, time: 180 * 1000 });

            if (confirmation.customId === 'clear') {
                this.conversations.delete(conversationKey);
                this.conversationFlavors.delete(conversationKey);
                clearTimeout(this.conversationClearTimeouts.get(conversationKey));
                this.conversationClearTimeouts.delete(conversationKey);
                clearButton
                    .setLabel('Memory Cleared')
                    .setDisabled(true);
    
                row.setComponents(clearButton);
                await confirmation.update({ components: [row as any] });
    
                setTimeout(async () => {
                    await confirmation.editReply({ components: [] });
                    this.activeMessages.delete(conversationKey);
                }, 5 * 1000);
            }
        } catch (err) {
            // Probably a timeout
            await interaction.editReply({ message: followUpMessage!, components: [] });
            this.activeMessages.delete(conversationKey);
        }
    }

    splitResponse(content: string, limit: number = 1950): string[] {
        const chunks = [];
        let chunk = '';
    
        const codeBlock: {
            open: boolean,
            language: string | null
        } = {
            open: false,
            language: null
        };
    
        const lines = content.split('\n');
    
        for (let line of lines) {
            const codeMatch = line.match(/```(.*)/);
            if (codeMatch != null) {
                codeBlock.open = !!codeMatch[1];
                codeBlock.language = codeMatch[1];
                const indexOfCodeBlock = line.indexOf(codeMatch[0]);
                if (indexOfCodeBlock !== 0) {
                    const splitByCodeBlock = line.split(codeMatch[0])
                    line = splitByCodeBlock[0] + '\n' + splitByCodeBlock.slice(1).join(codeMatch[0]);
                }
            }
    
            if ((chunk + line).length >= limit) {
                if (codeBlock.open) {
                    chunk += '\n```';
                    chunks.push(chunk);
                    chunk = '```' + codeBlock.language + '\n' + line + '\n';
                    continue;
                }
                chunks.push(chunk);
                chunk = line + '\n';
                continue;
            } else {
                chunk += line + '\n';
            }
        }
    
        if (chunk != '') chunks.push(chunk);
    
        return chunks;
    }
}
enum Flavor {
    None,
    Senko
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
