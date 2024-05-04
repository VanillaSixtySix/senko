import { REST, Routes } from 'discord.js';
import config from './config.json';
import path from 'node:path';
import { listFiles } from './src/utils';
import { BotInteraction } from './src/classes/BotInteraction';

const rest = new REST({ version: '10' }).setToken(config.token);

try {
    console.info('Refreshing application interactions...');

    const interactionPaths = listFiles(path.join(import.meta.dir, 'src/interactions'), true);

    const interactions = [];

    for (const file of interactionPaths) {
        const InteractionClass = (await import(file)).default as typeof BotInteraction;

        interactions.push(...(InteractionClass.builders || []).map(builder => builder.toJSON()));
    }

    if (Bun.argv.includes('--clear')) {
        for (const guildId of config.guildIds) {
            await rest.put(
                Routes.applicationGuildCommands(config.clientId, guildId),
                { body: [] },
            )
        }
        console.info('Cleared existing application interactions');
    }

    for (const guildId of config.guildIds) {
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, guildId),
            { body: interactions },
        );
    }

    console.info('Finished refreshing application interactions');
} catch (error) {
    console.error(error);
}
