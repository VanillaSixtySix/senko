import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody, type RESTPostAPIContextMenuApplicationCommandsJSONBody } from 'discord.js';
import config from './config.json';
import path from 'node:path';
import { listFiles } from './src/utils';
import { BotInteraction } from './src/classes/BotInteraction';

const rest = new REST({ version: '10' }).setToken(config.token);

type BuiltInteractionJSON = RESTPostAPIChatInputApplicationCommandsJSONBody | RESTPostAPIContextMenuApplicationCommandsJSONBody;

try {
    console.info('Refreshing application interactions...');

    const interactionPaths = listFiles(path.join(import.meta.dir, 'src/interactions'), true);

    const interactions: {
        global: BuiltInteractionJSON[],
        guild: BuiltInteractionJSON[],
    } = {
        global: [],
        guild: [],
    };

    for (const file of interactionPaths) {
        const InteractionClass = (await import(file)).default as typeof BotInteraction;

        (InteractionClass.guildOnly ? interactions.guild : interactions.global)
            .push(...(InteractionClass.builders || []).map(builder => builder.toJSON()));
    }

    if (Bun.argv.includes('--clear')) {
        await rest.put(
            Routes.applicationCommands(config.clientId),
            { body: [] },
        );
        for (const guildId of config.guildIds) {
            await rest.put(
                Routes.applicationGuildCommands(config.clientId, guildId),
                { body: [] },
            );
        }
        console.info('Cleared existing application interactions');
    }

    await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: interactions.global },
    );
    for (const guildId of config.guildIds) {
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, guildId),
            { body: interactions.guild },
        );
    }

    console.info('Finished refreshing application interactions');
} catch (error) {
    console.error(error);
}
