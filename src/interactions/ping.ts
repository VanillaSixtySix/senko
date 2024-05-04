import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { BotInteraction } from '../classes/BotInteraction';
import { BotClient } from '../classes/BotClient';

const lastFetchedData = {
    timestamp: -1,
    discordPing: -1,
    openAIStatus: '',
};

interface DiscordDayMetricResponse {
    summary: {
        mean: number;
    };
}

interface OpenAIStatusResponse {
    status: {
        description: string;
    };
}

export default class Ping implements BotInteraction {
    constructor(private client: BotClient) {}

    static builders = [
        new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Gets the ping of the client, Discord\'s API, and OpenAI\'s API'),
    ];

    static dataSets = {
        discord: 'https://discordstatus.com/metrics-display/5k2rt9f7pmny/day.json',
        openAI: 'https://status.openai.com/api/v2/status.json',
    };

    async onChatInteraction(interaction: ChatInputCommandInteraction) {
        const status = {
            clientPing: this.client.ws.ping,
            discordPing: lastFetchedData.discordPing,
            openAIStatus: lastFetchedData.openAIStatus,
        };

        const now = new Date();
        if (now.getTime() - lastFetchedData.timestamp > 60000) {
            let discordAPIRes: Response | null = null;
            let openAIAPIRes: Response | null = null;

            try {
                [ discordAPIRes, openAIAPIRes ] = await Promise.all([
                    fetch(Ping.dataSets.discord),
                    fetch(Ping.dataSets.openAI),
                ]);
            } catch (err) {
                await interaction.reply(`Failed to fetch one or more API statuses.\n\nDataset: [Discord](<${Ping.dataSets.discord}>), [OpenAI](<${Ping.dataSets.openAI}>)`);
                return;
            }

            lastFetchedData.timestamp = now.getTime();
            
            if (discordAPIRes.ok) {
                const json = await discordAPIRes.json() as DiscordDayMetricResponse;
                status.discordPing = lastFetchedData.discordPing = Math.round(json.summary.mean);
            }
            if (openAIAPIRes.ok) {
                const json = await openAIAPIRes.json() as OpenAIStatusResponse;
                status.openAIStatus = lastFetchedData.openAIStatus = json.status.description;
            }
        }

        const clientPingText = status.clientPing === -1 ? 'N/A (retry in a minute)' : Math.round(status.clientPing).toString() + 'ms';
        const discordPingText = status.discordPing === -1 ? 'N/A (failed)' : Math.round(status.discordPing).toString() + 'ms';

        const response = `Client WebSocket ping: \`${clientPingText}\`\n` +
            `Discord API ping: \`${discordPingText}\`\n` +
            `OpenAI status: \`${status.openAIStatus}\``;

        await interaction.reply(response);
    }
}
