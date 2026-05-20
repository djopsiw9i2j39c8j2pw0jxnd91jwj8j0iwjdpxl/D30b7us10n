const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    ApplicationCommandOptionType,
    AttachmentBuilder,
    ActivityType
} = require('discord.js');

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args));

// =========================
// WEB SERVER FOR RAILWAY
// =========================
const PORT = process.env.PORT || 8080;

http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8'
    });

    res.end('Discord Deobfuscator Bot đang hoạt động!');
}).listen(PORT, () => {
    console.log(`[WEB] Server running on port ${PORT}`);
});

// =========================
// DISCORD CONFIG
// =========================
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error('❌ Missing DISCORD_TOKEN');
    process.exit(1);
}

// =========================
// TEMP FOLDER
// =========================
const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

// =========================
// CLIENT
// =========================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// =========================
// RANDOM CODE
// =========================
function generateRandomCode(length = 4) {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    let result = '';

    for (let i = 0; i < length; i++) {
        result += chars.charAt(
            Math.floor(Math.random() * chars.length)
        );
    }

    return result;
}

// =========================
// COMMANDS
// =========================
const commands = [
    {
        name: 'deobfuscator-moonsec',
        description: 'Giải mã file Lua MoonSec / Prometheus',
        options: [
            {
                name: 'file',
                description: 'Upload file .lua hoặc .txt',
                type: ApplicationCommandOptionType.Attachment,
                required: true
            }
        ]
    }
];

// =========================
// READY EVENT
// =========================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    client.user.setActivity('/deobfuscator-moonsec', {
        type: ActivityType.Watching
    });

    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);

        console.log('[Discord] Syncing slash commands...');

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );

        console.log('✅ Slash commands synced');
    } catch (err) {
        console.error('❌ Slash command sync failed:', err);
    }
});

// =========================
// INTERACTION
// =========================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName !== 'deobfuscator-moonsec') return;

    const fileAttachment =
        interaction.options.getAttachment('file');

    if (
        !fileAttachment.name.endsWith('.lua') &&
        !fileAttachment.name.endsWith('.txt')
    ) {
        return interaction.reply({
            content:
                '❌ Chỉ chấp nhận file `.lua` hoặc `.txt`',
            ephemeral: true
        });
    }

    await interaction.deferReply();

    const randCode = generateRandomCode();

    const tempInput = path.join(
        TEMP_DIR,
        `temp_${randCode}.lua`
    );

    const tempDeobfOutput = path.join(
        TEMP_DIR,
        `temp_${randCode}_deobf.lua`
    );

    const finalOutput = path.join(
        TEMP_DIR,
        `72ms-${randCode}.txt`
    );

    try {
        // DOWNLOAD FILE
        const response = await fetch(fileAttachment.url);

        if (!response.ok) {
            throw new Error('Failed to download file');
        }

        const arrayBuffer = await response.arrayBuffer();

        fs.writeFileSync(
            tempInput,
            Buffer.from(arrayBuffer)
        );

        // PYTHON COMMAND
        const pythonCmd =
            process.platform === 'win32'
                ? 'python'
                : 'python3';

        // RUN DEOBFUSCATOR
        exec(
            `${pythonCmd} pol.py "${tempInput}"`,
            async (error, stdout, stderr) => {
                try {
                    if (error) {
                        console.error(error);

                        await interaction.followUp({
                            content:
                                `❌ Python error:\n\`\`\`\n${stderr || error.message}\n\`\`\``
                        });

                        cleanupFiles([
                            tempInput,
                            tempDeobfOutput,
                            finalOutput
                        ]);

                        return;
                    }

                    let outputFile = null;

                    if (fs.existsSync(tempDeobfOutput)) {
                        outputFile = tempDeobfOutput;
                    } else if (fs.existsSync(tempInput)) {
                        outputFile = tempInput;
                    }

                    if (!outputFile) {
                        await interaction.followUp({
                            content:
                                '❌ Không tìm thấy file output.'
                        });

                        cleanupFiles([
                            tempInput,
                            tempDeobfOutput,
                            finalOutput
                        ]);

                        return;
                    }

                    // SAVE FINAL
                    const content = fs.readFileSync(
                        outputFile,
                        'utf8'
                    );

                    fs.writeFileSync(
                        finalOutput,
                        content,
                        'utf8'
                    );

                    const attachment =
                        new AttachmentBuilder(finalOutput);

                    await interaction.followUp({
                        content:
                            `✅ Deobfuscate thành công!\nSession: \`${randCode}\``,
                        files: [attachment]
                    });

                    cleanupFiles([
                        tempInput,
                        tempDeobfOutput,
                        finalOutput
                    ]);
                } catch (err) {
                    console.error(err);

                    await interaction.followUp({
                        content:
                            `❌ Runtime error:\n\`${err.message}\``
                    });

                    cleanupFiles([
                        tempInput,
                        tempDeobfOutput,
                        finalOutput
                    ]);
                }
            }
        );
    } catch (err) {
        console.error(err);

        await interaction.followUp({
            content:
                `❌ System error:\n\`${err.message}\``
        });

        cleanupFiles([
            tempInput,
            tempDeobfOutput,
            finalOutput
        ]);
    }
});

// =========================
// CLEANUP
// =========================
function cleanupFiles(files) {
    for (const file of files) {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        } catch (err) {
            console.warn(
                `[WARN] Failed delete ${file}:`,
                err.message
            );
        }
    }
}

// =========================
// LOGIN
// =========================
client.login(TOKEN);

// =========================
// ANTI CRASH
// =========================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);