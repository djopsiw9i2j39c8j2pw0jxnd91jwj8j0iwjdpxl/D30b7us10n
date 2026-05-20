const { Client, GatewayIntentBits, REST, Routes, ApplicationCommandOptionType, AttachmentBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ==========================================
// PHẦN 1: WEBSERVER TRÁNH LỖI PORT TRÊN RAILWAY
// ==========================================
// Một số template Web Service của Railway yêu cầu ứng dụng phải bind vào một Port.
// Chúng ta tạo một HTTP Server siêu nhẹ để tránh lỗi "Port allocation failed".
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bot Discord Deobfuscator đang hoạt động tốt trên Railway!');
}).listen(PORT, () => {
    console.log(`[Web] HTTP Server đang lắng nghe trên cổng: ${PORT}`);
});

// ==========================================
// PHẦN 2: CẤU HÌNH DISCORD BOT
// ==========================================
const TOKEN = process.env.DISCORD_TOKEN; // Lấy token từ biến môi trường của Railway

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Hàm tạo mã ngẫu nhiên 4 ký tự (chữ hoa, chữ thường, chữ số)
function generateRandomCode(length = 4) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Đăng ký Slash Command với Discord API
const commands = [
    {
        name: 'deobfuscator-moonsec',
        description: 'Giải mã và bóc tách các file Lua bị khóa bởi Moonsec hoặc Prometheus.',
        options: [
            {
                name: 'file',
                description: 'Tải lên hoặc kéo thả file .lua / .txt cần xử lý',
                type: ApplicationCommandOptionType.Attachment,
                required: true
            }
        ]
    }
];

client.once('ready', async () => {
    console.log(`🤖 Bot đã kết nối thành công! Đăng nhập dưới tên: ${client.user.tag}`);
    
    // Set trạng thái hoạt động của bot
    client.user.setActivity({
        name: '/deobfuscator-moonsec',
        type: 3 // Watching
    });

    // Đồng bộ Slash Command lên toàn cầu (Global Commands)
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        console.log('[Discord] Đang đồng bộ hóa Slash Commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Đồng bộ Slash Commands thành công!');
    } catch (error) {
        console.error('❌ Lỗi đồng bộ Slash Command:', error);
    }
});

// Xử lý sự kiện khi có người dùng gọi lệnh Slash Command
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'deobfuscator-moonsec') {
        const fileAttachment = interaction.options.getAttachment('file');

        // Chỉ chấp nhận file có đuôi .lua hoặc .txt
        if (!fileAttachment.name.endsWith('.lua') && !fileAttachment.name.endsWith('.txt')) {
            return interaction.reply({
                content: '❌ Định dạng file không hợp lệ! Vui lòng chỉ tải lên file có đuôi `.lua` hoặc `.txt`.',
                ephemeral: true
            });
        }

        // Tạm hoãn phản hồi để Discord không bị Timeout (sau 3 giây)
        await interaction.deferReply();

        const randCode = generateRandomCode(4);
        const tempInput = `temp_${randCode}.lua`;
        const tempDeobfOutput = `temp_${randCode}_deobf.lua`;
        const finalOutput = `72ms-${randCode}.txt`;

        try {
            // Tải file từ Discord CDN về thư mục cục bộ của Bot
            const response = await fetch(fileAttachment.url);
            if (!response.ok) throw new Error('Không thể tải file từ Discord');
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            fs.writeFileSync(tempInput, buffer);

            // Xác định lệnh thực thi python (tự động thử python3 trước, nếu lỗi thì chuyển sang python)
            const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

            // Gọi chương trình pol.py gốc của bạn để xử lý file tạm vừa tải về
            exec(`${pythonCmd} pol.py ${tempInput}`, async (error, stdout, stderr) => {
                if (error) {
                    console.error(`[Exec Error] ${error}`);
                    await interaction.followup.send({
                        content: `❌ Quá trình giải mã gặp lỗi cú pháp Python hoặc lỗi thực thi:\n\`\`\`\n${stderr || error.message}\n\`\`\``
                    });
                    cleanupFiles([tempInput, tempDeobfOutput, finalOutput]);
                    return;
                }

                // Kiểm tra xem pol.py đã tạo ra file deobfuscated chưa
                if (fs.existsSync(tempDeobfOutput)) {
                    // Đọc nội dung file đã bóc tách
                    const content = fs.readFileSync(tempDeobfOutput, 'utf8');
                    // Ghi nội dung sang file đích có cấu trúc đặt tên theo yêu cầu
                    fs.writeFileSync(finalOutput, content, 'utf8');

                    // Gửi trả file về Discord cho người dùng
                    const attachment = new AttachmentBuilder(finalOutput);
                    await interaction.followup.send({
                        content: `✅ **Bóc tách thành công!** Phiên giao dịch: \`${randCode}\``,
                        files: [attachment]
                    });
                } 
                // Nếu pol.py không tạo ra file mới mà ghi đè trực tiếp lên file input gốc
                else if (fs.existsSync(tempInput)) {
                    const content = fs.readFileSync(tempInput, 'utf8');
                    fs.writeFileSync(finalOutput, content, 'utf8');

                    const attachment = new AttachmentBuilder(finalOutput);
                    await interaction.followup.send({
                        content: `✅ **Bóc tách thành công (Ghi đè)!** Phiên giao dịch: \`${randCode}\``,
                        files: [attachment]
                    });
                } else {
                    await interaction.followup.send({
                        content: '❌ Đã chạy deobfuscator xong nhưng không tìm thấy file đầu ra hợp lệ trên hệ thống.'
                    });
                }

                // Dọn dẹp tất cả các file rác sau khi xử lý xong
                cleanupFiles([tempInput, tempDeobfOutput, finalOutput]);
            });

        } catch (err) {
            console.error('[Error]', err);
            await interaction.followup.send({ content: `❌ Đã xảy ra lỗi hệ thống: \`${err.message}\`` });
            cleanupFiles([tempInput, tempDeobfOutput, finalOutput]);
        }
    }
});

// Hàm dọn dẹp file tạm
function cleanupFiles(filePaths) {
    filePaths.forEach(filePath => {
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (err) {
                console.warn(`[Warn] Không thể xóa file tạm ${filePath}:`, err.message);
            }
        }
    });
}

// Khởi động Discord Client
if (!TOKEN) {
    console.error('❌ Thiếu biến môi trường DISCORD_TOKEN! Vui lòng cài đặt trên Railway.');
    process.exit(1);
}
client.login(TOKEN);