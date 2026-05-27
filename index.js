import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { createClient } from '@libsql/client';
import express from 'express';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import fs from 'fs';

// Servidor fake pro Render não dormir + rota de assinatura
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot online!'));

// Conexão com Turso
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Criar tabelas se não existir
await db.execute(`
  CREATE TABLE IF NOT EXISTS pontos (
    user_id TEXT PRIMARY KEY,
    horas INTEGER DEFAULT 0,
    minutos INTEGER DEFAULT 0,
    inicio_timestamp INTEGER DEFAULT NULL
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS contratos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    cliente TEXT,
    email TEXT,
    servico TEXT,
    valor REAL,
    status TEXT DEFAULT 'pendente',
    data TEXT
  )
`);

// Nodemailer pra enviar contrato
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Rota que o cliente clica pra assinar
app.get('/assinar/:id', async (req, res) => {
  try {
    const id = req.params.id
    await db.execute({
      sql: "UPDATE contratos SET status = 'assinado' WHERE id =?",
      args: [id]
    })
    res.send('<h1>Contrato assinado com sucesso!</h1><p>Pode fechar esta página.</p>')
  } catch {
    res.send('Erro ao assinar contrato.')
  }
})

app.listen(PORT, () => console.log(`Servidor web rodando na porta ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// COMANDOS ANTIGOS + 2 NOVOS DE CONTRATO
const commands = [
  new SlashCommandBuilder().setName('iniciar').setDescription('Inicia seu contador de horas'),
  new SlashCommandBuilder().setName('pausar').setDescription('Pausa seu contador de horas'),
  new SlashCommandBuilder().setName('encerrar').setDescription('Encerra e salva suas horas do dia'),
  new SlashCommandBuilder().setName('meuponto').setDescription('Mostra suas horas acumuladas'),
  new SlashCommandBuilder().setName('ranking').setDescription('Mostra o ranking de horas da galera'),
  new SlashCommandBuilder().setName('exportar').setDescription('Exporta suas horas em arquivo'),
  new SlashCommandBuilder().setName('resetar').setDescription('Reseta suas horas pra zero'),
  new SlashCommandBuilder().setName('ajustar').setDescription('Ajusta horas de um membro - Apenas Líderes')
   .addUserOption(option => option.setName('usuario').setDescription('Usuário pra ajustar').setRequired(true))
   .addIntegerOption(option => option.setName('horas').setDescription('Quantidade de horas').setRequired(true))
   .addIntegerOption(option => option.setName('minutos').setDescription('Quantidade de minutos').setRequired(true)),
  new SlashCommandBuilder().setName('horas').setDescription('Mostra suas horas acumuladas'),

  // NOVOS COMANDOS DE CONTRATO
  new SlashCommandBuilder().setName('enviar-contrato').setDescription('Envia contrato por email para assinatura'),
  new SlashCommandBuilder().setName('relatorio-contratos').setDescription('Mostra últimos contratos enviados')
].map(command => command.toJSON());

// Registrar comandos
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`Bot online: ${client.user.tag}`);
    console.log('Todos comandos registrados!');
  } catch (error) {
    console.error(error);
  }
});

// Lógica dos comandos
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() &&!interaction.isModalSubmit()) return;

  const userId = interaction.user.id;

  // TEUS COMANDOS ANTIGOS DE PONTO - DEIXEI IGUAL
  if (interaction.commandName === 'iniciar') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const guildId = interaction.guild.id;
      const check = await db.execute({
        sql: 'SELECT * FROM sessoes WHERE user_id =? AND fim IS NULL',
        args: [userId]
      });
      if (check.rows.length > 0) {
        return interaction.editReply('❌ Tu já tem uma sessão ativa. Usa `/parar` antes.');
      }
      const agora = new Date().toISOString();
      await db.execute({
        sql: 'INSERT INTO sessoes (user_id, guild_id, inicio) VALUES (?,?,?)',
        args: [userId, guildId, agora]
      });
      await interaction.editReply('✅ Sessão iniciada! Bom trabalho.');
    } catch (error) {
      console.error('Erro no /iniciar:', error);
      await interaction.editReply('❌ Deu erro ao iniciar. Tenta de novo.');
    }
  }

  if (interaction.commandName === 'pausar') {
    await interaction.reply('Pausa registrada! Use /iniciar pra continuar.');
  }

  if (interaction.commandName === 'encerrar') {
    await interaction.reply('Expediente encerrado! Horas salvas.');
  }

  if (interaction.commandName === 'meuponto' || interaction.commandName === 'horas') {
    const result = await db.execute({
      sql: 'SELECT horas, minutos FROM pontos WHERE user_id =?',
      args: [userId]
    });
    if (result.rows.length === 0) {
      return interaction.reply('Você ainda não tem horas. Use /iniciar primeiro.');
    }
    const { horas, minutos } = result.rows[0];
    await interaction.reply(`Você tem **${horas}h e ${minutos}min** acumulados.`);
  }

  if (interaction.commandName === 'ranking') {
    const result = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC LIMIT 10');
    if (result.rows.length === 0) {
      return interaction.reply('Ninguém pontuou ainda.');
    }
    let msg = '**Ranking de Horas:**\n';
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        const member = await interaction.guild.members.fetch(row.user_id);
        const nome = member.displayName;
        msg += `${i + 1}. ${nome} - ${row.horas}h ${row.minutos}min\n`;
      } catch {
        msg += `${i + 1}. Usuário saiu - ${row.horas}h ${row.minutos}min\n`;
      }
    }
    await interaction.reply(msg);
  }

  if (interaction.commandName === 'exportar') {
    const ID_CARGO_LIDER = '1476731803384545390';
    if (!interaction.member.roles.cache.has(ID_CARGO_LIDER)) {
      return interaction.reply({ content: 'Apenas Líderes podem exportar os dados.', ephemeral: true });
    }
    await interaction.deferReply();
    const result = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC');
    if (result.rows.length === 0) {
      return interaction.editReply('Ninguém pontuou ainda.');
    }
    let arquivo = `Ranking de Horas - Exportado em ${new Date().toLocaleDateString('pt-BR')}\n`;
    arquivo += `Total de membros: ${result.rows.length}\n\n`;
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        const member = await interaction.guild.members.fetch(row.user_id);
        const nome = member.displayName;
        arquivo += `${i + 1}. ${nome} - ${row.horas}h ${row.minutos}min\n`;
      } catch {
        arquivo += `${i + 1}. Usuário saiu (ID: ${row.user_id}) - ${row.horas}h ${row.minutos}min\n`;
      }
    }
    const buffer = Buffer.from(arquivo, 'utf-8');
    await interaction.editReply({
      content: '✅ **Exportação completa:**',
      files: [{ attachment: buffer, name: 'ranking-completo.txt' }]
    });
  }

  if (interaction.commandName === 'resetar') {
    await db.execute({
      sql: 'UPDATE pontos SET horas = 0, minutos = 0, inicio_timestamp = NULL WHERE user_id =?',
      args: [userId]
    });
    await interaction.reply('Suas horas foram resetadas pra zero.');
  }

  if (interaction.commandName === 'ajustar') {
    const ID_CARGO_LIDER = '1476731803384545390';
    if (!interaction.member.roles.cache.has(ID_CARGO_LIDER)) {
      return interaction.reply({ content: 'Apenas Líderes podem ajustar horas.', ephemeral: true });
    }
    const usuarioAlvo = interaction.options.getUser('usuario');
    const horas = interaction.options.getInteger('horas');
    const minutos = interaction.options.getInteger('minutos');
    await db.execute({
      sql: `INSERT INTO pontos (user_id, horas, minutos) VALUES (?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET horas =?, minutos =?`,
      args: [usuarioAlvo.id, horas, minutos, horas, minutos]
    });
    await interaction.reply(`✅ Horas de ${usuarioAlvo} ajustadas pra **${horas}h e ${minutos}min** por ${interaction.user}.`);
  }

  // COMANDOS NOVOS DE CONTRATO
  if (interaction.commandName === 'enviar-contrato') {
    const modal = new ModalBuilder().setCustomId('modalContrato').setTitle('Novo Contrato')
    const inputs = [
      new TextInputBuilder().setCustomId('cliente').setLabel('Nome do Cliente').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('email').setLabel('Email do Cliente').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('servico').setLabel('Serviço').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('valor').setLabel('Valor R$').setStyle(TextInputStyle.Short).setRequired(true)
    ]
    modal.addComponents(...inputs.map(input => new ActionRowBuilder().addComponents(input)))
    await interaction.showModal(modal)
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modalContrato') {
    await interaction.deferReply({ ephemeral: true })
    const dados = {
      cliente: interaction.fields.getTextInputValue('cliente'),
      email: interaction.fields.getTextInputValue('email'),
      servico: interaction.fields.getTextInputValue('servico'),
      valor: interaction.fields.getTextInputValue('valor')
    }

    const doc = new PDFDocument()
    const pdfPath = `./contrato-${Date.now()}.pdf`
    doc.pipe(fs.createWriteStream(pdfPath))
    doc.fontSize(20).text('CONTRATO DE PRESTAÇÃO DE SERVIÇO', { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text(`Cliente: ${dados.cliente}`)
    doc.text(`Serviço: ${dados.servico}`)
    doc.text(`Valor: R$ ${dados.valor}`)
    doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`)
    doc.end()
    await new Promise(r => doc.on('end', r))

    const result = await db.execute({
      sql: "INSERT INTO contratos (user_id, cliente, email, servico, valor, status, data) VALUES (?,?,?,?,?, 'pendente',?) RETURNING id",
      args: [interaction.user.id, dados.cliente, dados.email, dados.servico, dados.valor, new Date().toISOString()]
    })
    const contratoId = result.rows[0].id

    const linkAssinar = `${process.env.RENDER_EXTERNAL_URL}/assinar/${contratoId}`
    await transporter.sendMail({
      from: `Contratos <${process.env.EMAIL_USER}>`,
      to: dados.email,
      subject: `Contrato para Assinatura - ${dados.servico}`,
      html: `<h2>Olá ${dados.cliente},</h2>
             <p>Contrato de ${dados.servico} no valor de R$ ${dados.valor}</p>
             <a href="${linkAssinar}" style="background:#5865F2;color:white;padding:12px 24px;text-decoration:none;border-radius:5px">Assinar Contrato</a>`,
      attachments: [{ filename: 'contrato.pdf', path: pdfPath }]
    })

    fs.unlinkSync(pdfPath)
    await interaction.editReply(`✅ Contrato #${contratoId} enviado para ${dados.email}`)
  }

  if (interaction.commandName === 'relatorio-contratos') {
    const { rows } = await db.execute("SELECT * FROM contratos ORDER BY id DESC LIMIT 10")
    if (rows.length === 0) return interaction.reply('Nenhum contrato enviado ainda.')
    const lista = rows.map(r => `#${r.id} - ${r.cliente} - R$${r.valor} - ${r.status}`).join('\n')
    await interaction.reply(`**Últimos contratos:**\n\`\`\`${lista}\`\`\``)
  }
});

client.login(process.env.DISCORD_TOKEN);import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { createClient } from '@libsql/client';
import express from 'express';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import fs from 'fs';

// Servidor fake pro Render não dormir + rota de assinatura
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot online!'));

// Conexão com Turso
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Criar tabelas se não existir
await db.execute(`
  CREATE TABLE IF NOT EXISTS pontos (
    user_id TEXT PRIMARY KEY,
    horas INTEGER DEFAULT 0,
    minutos INTEGER DEFAULT 0,
    inicio_timestamp INTEGER DEFAULT NULL
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS contratos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    cliente TEXT,
    email TEXT,
    servico TEXT,
    valor REAL,
    status TEXT DEFAULT 'pendente',
    data TEXT
  )
`);

// Nodemailer pra enviar contrato
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Rota que o cliente clica pra assinar
app.get('/assinar/:id', async (req, res) => {
  try {
    const id = req.params.id
    await db.execute({
      sql: "UPDATE contratos SET status = 'assinado' WHERE id =?",
      args: [id]
    })
    res.send('<h1>Contrato assinado com sucesso!</h1><p>Pode fechar esta página.</p>')
  } catch {
    res.send('Erro ao assinar contrato.')
  }
})

app.listen(PORT, () => console.log(`Servidor web rodando na porta ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// COMANDOS ANTIGOS + 2 NOVOS DE CONTRATO
const commands = [
  new SlashCommandBuilder().setName('iniciar').setDescription('Inicia seu contador de horas'),
  new SlashCommandBuilder().setName('pausar').setDescription('Pausa seu contador de horas'),
  new SlashCommandBuilder().setName('encerrar').setDescription('Encerra e salva suas horas do dia'),
  new SlashCommandBuilder().setName('meuponto').setDescription('Mostra suas horas acumuladas'),
  new SlashCommandBuilder().setName('ranking').setDescription('Mostra o ranking de horas da galera'),
  new SlashCommandBuilder().setName('exportar').setDescription('Exporta suas horas em arquivo'),
  new SlashCommandBuilder().setName('resetar').setDescription('Reseta suas horas pra zero'),
  new SlashCommandBuilder().setName('ajustar').setDescription('Ajusta horas de um membro - Apenas Líderes')
   .addUserOption(option => option.setName('usuario').setDescription('Usuário pra ajustar').setRequired(true))
   .addIntegerOption(option => option.setName('horas').setDescription('Quantidade de horas').setRequired(true))
   .addIntegerOption(option => option.setName('minutos').setDescription('Quantidade de minutos').setRequired(true)),
  new SlashCommandBuilder().setName('horas').setDescription('Mostra suas horas acumuladas'),

  // NOVOS COMANDOS DE CONTRATO
  new SlashCommandBuilder().setName('enviar-contrato').setDescription('Envia contrato por email para assinatura'),
  new SlashCommandBuilder().setName('relatorio-contratos').setDescription('Mostra últimos contratos enviados')
].map(command => command.toJSON());

// Registrar comandos
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`Bot online: ${client.user.tag}`);
    console.log('Todos comandos registrados!');
  } catch (error) {
    console.error(error);
  }
});

// Lógica dos comandos
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() &&!interaction.isModalSubmit()) return;

  const userId = interaction.user.id;

  // TEUS COMANDOS ANTIGOS DE PONTO - DEIXEI IGUAL
  if (interaction.commandName === 'iniciar') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const guildId = interaction.guild.id;
      const check = await db.execute({
        sql: 'SELECT * FROM sessoes WHERE user_id =? AND fim IS NULL',
        args: [userId]
      });
      if (check.rows.length > 0) {
        return interaction.editReply('❌ Tu já tem uma sessão ativa. Usa `/parar` antes.');
      }
      const agora = new Date().toISOString();
      await db.execute({
        sql: 'INSERT INTO sessoes (user_id, guild_id, inicio) VALUES (?,?,?)',
        args: [userId, guildId, agora]
      });
      await interaction.editReply('✅ Sessão iniciada! Bom trabalho.');
    } catch (error) {
      console.error('Erro no /iniciar:', error);
      await interaction.editReply('❌ Deu erro ao iniciar. Tenta de novo.');
    }
  }

  if (interaction.commandName === 'pausar') {
    await interaction.reply('Pausa registrada! Use /iniciar pra continuar.');
  }

  if (interaction.commandName === 'encerrar') {
    await interaction.reply('Expediente encerrado! Horas salvas.');
  }

  if (interaction.commandName === 'meuponto' || interaction.commandName === 'horas') {
    const result = await db.execute({
      sql: 'SELECT horas, minutos FROM pontos WHERE user_id =?',
      args: [userId]
    });
    if (result.rows.length === 0) {
      return interaction.reply('Você ainda não tem horas. Use /iniciar primeiro.');
    }
    const { horas, minutos } = result.rows[0];
    await interaction.reply(`Você tem **${horas}h e ${minutos}min** acumulados.`);
  }

  if (interaction.commandName === 'ranking') {
    const result = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC LIMIT 10');
    if (result.rows.length === 0) {
      return interaction.reply('Ninguém pontuou ainda.');
    }
    let msg = '**Ranking de Horas:**\n';
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        const member = await interaction.guild.members.fetch(row.user_id);
        const nome = member.displayName;
        msg += `${i + 1}. ${nome} - ${row.horas}h ${row.minutos}min\n`;
      } catch {
        msg += `${i + 1}. Usuário saiu - ${row.horas}h ${row.minutos}min\n`;
      }
    }
    await interaction.reply(msg);
  }

  if (interaction.commandName === 'exportar') {
    const ID_CARGO_LIDER = '1476731803384545390';
    if (!interaction.member.roles.cache.has(ID_CARGO_LIDER)) {
      return interaction.reply({ content: 'Apenas Líderes podem exportar os dados.', ephemeral: true });
    }
    await interaction.deferReply();
    const result = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC');
    if (result.rows.length === 0) {
      return interaction.editReply('Ninguém pontuou ainda.');
    }
    let arquivo = `Ranking de Horas - Exportado em ${new Date().toLocaleDateString('pt-BR')}\n`;
    arquivo += `Total de membros: ${result.rows.length}\n\n`;
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        const member = await interaction.guild.members.fetch(row.user_id);
        const nome = member.displayName;
        arquivo += `${i + 1}. ${nome} - ${row.horas}h ${row.minutos}min\n`;
      } catch {
        arquivo += `${i + 1}. Usuário saiu (ID: ${row.user_id}) - ${row.horas}h ${row.minutos}min\n`;
      }
    }
    const buffer = Buffer.from(arquivo, 'utf-8');
    await interaction.editReply({
      content: '✅ **Exportação completa:**',
      files: [{ attachment: buffer, name: 'ranking-completo.txt' }]
    });
  }

  if (interaction.commandName === 'resetar') {
    await db.execute({
      sql: 'UPDATE pontos SET horas = 0, minutos = 0, inicio_timestamp = NULL WHERE user_id =?',
      args: [userId]
    });
    await interaction.reply('Suas horas foram resetadas pra zero.');
  }

  if (interaction.commandName === 'ajustar') {
    const ID_CARGO_LIDER = '1476731803384545390';
    if (!interaction.member.roles.cache.has(ID_CARGO_LIDER)) {
      return interaction.reply({ content: 'Apenas Líderes podem ajustar horas.', ephemeral: true });
    }
    const usuarioAlvo = interaction.options.getUser('usuario');
    const horas = interaction.options.getInteger('horas');
    const minutos = interaction.options.getInteger('minutos');
    await db.execute({
      sql: `INSERT INTO pontos (user_id, horas, minutos) VALUES (?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET horas =?, minutos =?`,
      args: [usuarioAlvo.id, horas, minutos, horas, minutos]
    });
    await interaction.reply(`✅ Horas de ${usuarioAlvo} ajustadas pra **${horas}h e ${minutos}min** por ${interaction.user}.`);
  }

  // COMANDOS NOVOS DE CONTRATO
  if (interaction.commandName === 'enviar-contrato') {
    const modal = new ModalBuilder().setCustomId('modalContrato').setTitle('Novo Contrato')
    const inputs = [
      new TextInputBuilder().setCustomId('cliente').setLabel('Nome do Cliente').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('email').setLabel('Email do Cliente').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('servico').setLabel('Serviço').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('valor').setLabel('Valor R$').setStyle(TextInputStyle.Short).setRequired(true)
    ]
    modal.addComponents(...inputs.map(input => new ActionRowBuilder().addComponents(input)))
    await interaction.showModal(modal)
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modalContrato') {
    await interaction.deferReply({ ephemeral: true })
    const dados = {
      cliente: interaction.fields.getTextInputValue('cliente'),
      email: interaction.fields.getTextInputValue('email'),
      servico: interaction.fields.getTextInputValue('servico'),
      valor: interaction.fields.getTextInputValue('valor')
    }

    const doc = new PDFDocument()
    const pdfPath = `./contrato-${Date.now()}.pdf`
    doc.pipe(fs.createWriteStream(pdfPath))
    doc.fontSize(20).text('CONTRATO DE PRESTAÇÃO DE SERVIÇO', { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text(`Cliente: ${dados.cliente}`)
    doc.text(`Serviço: ${dados.servico}`)
    doc.text(`Valor: R$ ${dados.valor}`)
    doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`)
    doc.end()
    await new Promise(r => doc.on('end', r))

    const result = await db.execute({
      sql: "INSERT INTO contratos (user_id, cliente, email, servico, valor, status, data) VALUES (?,?,?,?,?, 'pendente',?) RETURNING id",
      args: [interaction.user.id, dados.cliente, dados.email, dados.servico, dados.valor, new Date().toISOString()]
    })
    const contratoId = result.rows[0].id

    const linkAssinar = `${process.env.RENDER_EXTERNAL_URL}/assinar/${contratoId}`
    await transporter.sendMail({
      from: `Contratos <${process.env.EMAIL_USER}>`,
      to: dados.email,
      subject: `Contrato para Assinatura - ${dados.servico}`,
      html: `<h2>Olá ${dados.cliente},</h2>
             <p>Contrato de ${dados.servico} no valor de R$ ${dados.valor}</p>
             <a href="${linkAssinar}" style="background:#5865F2;color:white;padding:12px 24px;text-decoration:none;border-radius:5px">Assinar Contrato</a>`,
      attachments: [{ filename: 'contrato.pdf', path: pdfPath }]
    })

    fs.unlinkSync(pdfPath)
    await interaction.editReply(`✅ Contrato #${contratoId} enviado para ${dados.email}`)
  }

  if (interaction.commandName === 'relatorio-contratos') {
    const { rows } = await db.execute("SELECT * FROM contratos ORDER BY id DESC LIMIT 10")
    if (rows.length === 0) return interaction.reply('Nenhum contrato enviado ainda.')
    const lista = rows.map(r => `#${r.id} - ${r.cliente} - R$${r.valor} - ${r.status}`).join('\n')
    await interaction.reply(`**Últimos contratos:**\n\`\`\`${lista}\`\`\``)
  }
});

client.login(process.env.DISCORD_TOKEN);import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { createClient } from '@libsql/client';
import express from 'express';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import fs from 'fs';

// Servidor fake pro Render não dormir + rota de assinatura
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot online!'));

// Conexão com Turso
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Criar tabelas se não existir
await db.execute(`
  CREATE TABLE IF NOT EXISTS pontos (
    user_id TEXT PRIMARY KEY,
    horas INTEGER DEFAULT 0,
    minutos INTEGER DEFAULT 0,
    inicio_timestamp INTEGER DEFAULT NULL
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS contratos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    cliente TEXT,
    email TEXT,
    servico TEXT,
    valor REAL,
    status TEXT DEFAULT 'pendente',
    data TEXT
  )
`);

// Nodemailer pra enviar contrato
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Rota que o cliente clica pra assinar
app.get('/assinar/:id', async (req, res) => {
  try {
    const id = req.params.id
    await db.execute({
      sql: "UPDATE contratos SET status = 'assinado' WHERE id =?",
      args: [id]
    })
    res.send('<h1>Contrato assinado com sucesso!</h1><p>Pode fechar esta página.</p>')
  } catch {
    res.send('Erro ao assinar contrato.')
  }
})

app.listen(PORT, () => console.log(`Servidor web rodando na porta ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// COMANDOS ANTIGOS + 2 NOVOS DE CONTRATO
const commands = [
  new SlashCommandBuilder().setName('iniciar').setDescription('Inicia seu contador de horas'),
  new SlashCommandBuilder().setName('pausar').setDescription('Pausa seu contador de horas'),
  new SlashCommandBuilder().setName('encerrar').setDescription('Encerra e salva suas horas do dia'),
  new SlashCommandBuilder().setName('meuponto').setDescription('Mostra suas horas acumuladas'),
  new SlashCommandBuilder().setName('ranking').setDescription('Mostra o ranking de horas da galera'),
  new SlashCommandBuilder().setName('exportar').setDescription('Exporta suas horas em arquivo'),
  new SlashCommandBuilder().setName('resetar').setDescription('Reseta suas horas pra zero'),
  new SlashCommandBuilder().setName('ajustar').setDescription('Ajusta horas de um membro - Apenas Líderes')
   .addUserOption(option => option.setName('usuario').setDescription('Usuário pra ajustar').setRequired(true))
   .addIntegerOption(option => option.setName('horas').setDescription('Quantidade de horas').setRequired(true))
   .addIntegerOption(option => option.setName('minutos').setDescription('Quantidade de minutos').setRequired(true)),
  new SlashCommandBuilder().setName('horas').setDescription('Mostra suas horas acumuladas'),

  // NOVOS COMANDOS DE CONTRATO
  new SlashCommandBuilder().setName('enviar-contrato').setDescription('Envia contrato por email para assinatura'),
  new SlashCommandBuilder().setName('relatorio-contratos').setDescription('Mostra últimos contratos enviados')
].map(command => command.toJSON());

// Registrar comandos
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`Bot online: ${client.user.tag}`);
    console.log('Todos comandos registrados!');
  } catch (error) {
    console.error(error);
  }
});

// Lógica dos comandos
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() &&!interaction.isModalSubmit()) return;

  const userId = interaction.user.id;

  // TEUS COMANDOS ANTIGOS DE PONTO - DEIXEI IGUAL
  if (interaction.commandName === 'iniciar') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const guildId = interaction.guild.id;
      const check = await db.execute({
        sql: 'SELECT * FROM sessoes WHERE user_id =? AND fim IS NULL',
        args: [userId]
      });
      if (check.rows.length > 0) {
        return interaction.editReply('❌ Tu já tem uma sessão ativa. Usa `/parar` antes.');
      }
      const agora = new Date().toISOString();
      await db.execute({
        sql: 'INSERT INTO sessoes (user_id, guild_id, inicio) VALUES (?,?,?)',
        args: [userId, guildId, agora]
      });
      await interaction.editReply('✅ Sessão iniciada! Bom trabalho.');
    } catch (error) {
      console.error('Erro no /iniciar:', error);
      await interaction.editReply('❌ Deu erro ao iniciar. Tenta de novo.');
    }
  }

  if (interaction.commandName === 'pausar') {
    await interaction.reply('Pausa registrada! Use /iniciar pra continuar.');
  }

  if (interaction.commandName === 'encerrar') {
    await interaction.reply('Expediente encerrado! Horas salvas.');
  }

  if (interaction.commandName === 'meuponto' || interaction.commandName === 'horas') {
    const result = await db.execute({
      sql: 'SELECT horas, minutos FROM pontos WHERE user_id =?',
      args: [userId]
    });
    if (result.rows.length === 0) {
      return interaction.reply('Você ainda não tem horas. Use /iniciar primeiro.');
    }
    const { horas, minutos } = result.rows[0];
    await interaction.reply(`Você tem **${horas}h e ${minutos}min** acumulados.`);
  }

  if (interaction.commandName === 'ranking') {
    const result = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC LIMIT 10');
    if (result.rows.length === 0) {
      return interaction.reply('Ninguém pontuou ainda.');
    }
    let msg = '**Ranking de Horas:**\n';
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        const member = await interaction.guild.members.fetch(row.user_id);
        const nome = member.displayName;
        msg += `${i + 1}. ${nome} - ${row.horas}h ${row.minutos}min\n`;
      } catch {
        msg += `${i + 1}. Usuário saiu - ${row.horas}h ${row.minutos}min\n`;
      }
    }
    await interaction.reply(msg);
  }

  if (interaction.commandName === 'exportar') {
    const ID_CARGO_LIDER = '1476731803384545390';
    if (!interaction.member.roles.cache.has(ID_CARGO_LIDER)) {
      return interaction.reply({ content: 'Apenas Líderes podem exportar os dados.', ephemeral: true });
    }
    await interaction.deferReply();
    const result = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC');
    if (result.rows.length === 0) {
      return interaction.editReply('Ninguém pontuou ainda.');
    }
    let arquivo = `Ranking de Horas - Exportado em ${new Date().toLocaleDateString('pt-BR')}\n`;
    arquivo += `Total de membros: ${result.rows.length}\n\n`;
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        const member = await interaction.guild.members.fetch(row.user_id);
        const nome = member.displayName;
        arquivo += `${i + 1}. ${nome} - ${row.horas}h ${row.minutos}min\n`;
      } catch {
        arquivo += `${i + 1}. Usuário saiu (ID: ${row.user_id}) - ${row.horas}h ${row.minutos}min\n`;
      }
    }
    const buffer = Buffer.from(arquivo, 'utf-8');
    await interaction.editReply({
      content: '✅ **Exportação completa:**',
      files: [{ attachment: buffer, name: 'ranking-completo.txt' }]
    });
  }

  if (interaction.commandName === 'resetar') {
    await db.execute({
      sql: 'UPDATE pontos SET horas = 0, minutos = 0, inicio_timestamp = NULL WHERE user_id =?',
      args: [userId]
    });
    await interaction.reply('Suas horas foram resetadas pra zero.');
  }

  if (interaction.commandName === 'ajustar') {
    const ID_CARGO_LIDER = '1476731803384545390';
    if (!interaction.member.roles.cache.has(ID_CARGO_LIDER)) {
      return interaction.reply({ content: 'Apenas Líderes podem ajustar horas.', ephemeral: true });
    }
    const usuarioAlvo = interaction.options.getUser('usuario');
    const horas = interaction.options.getInteger('horas');
    const minutos = interaction.options.getInteger('minutos');
    await db.execute({
      sql: `INSERT INTO pontos (user_id, horas, minutos) VALUES (?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET horas =?, minutos =?`,
      args: [usuarioAlvo.id, horas, minutos, horas, minutos]
    });
    await interaction.reply(`✅ Horas de ${usuarioAlvo} ajustadas pra **${horas}h e ${minutos}min** por ${interaction.user}.`);
  }

  // COMANDOS NOVOS DE CONTRATO
  if (interaction.commandName === 'enviar-contrato') {
    const modal = new ModalBuilder().setCustomId('modalContrato').setTitle('Novo Contrato')
    const inputs = [
      new TextInputBuilder().setCustomId('cliente').setLabel('Nome do Cliente').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('email').setLabel('Email do Cliente').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('servico').setLabel('Serviço').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('valor').setLabel('Valor R$').setStyle(TextInputStyle.Short).setRequired(true)
    ]
    modal.addComponents(...inputs.map(input => new ActionRowBuilder().addComponents(input)))
    await interaction.showModal(modal)
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modalContrato') {
    await interaction.deferReply({ ephemeral: true })
    const dados = {
      cliente: interaction.fields.getTextInputValue('cliente'),
      email: interaction.fields.getTextInputValue('email'),
      servico: interaction.fields.getTextInputValue('servico'),
      valor: interaction.fields.getTextInputValue('valor')
    }

    const doc = new PDFDocument()
    const pdfPath = `./contrato-${Date.now()}.pdf`
    doc.pipe(fs.createWriteStream(pdfPath))
    doc.fontSize(20).text('CONTRATO DE PRESTAÇÃO DE SERVIÇO', { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text(`Cliente: ${dados.cliente}`)
    doc.text(`Serviço: ${dados.servico}`)
    doc.text(`Valor: R$ ${dados.valor}`)
    doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`)
    doc.end()
    await new Promise(r => doc.on('end', r))

    const result = await db.execute({
      sql: "INSERT INTO contratos (user_id, cliente, email, servico, valor, status, data) VALUES (?,?,?,?,?, 'pendente',?) RETURNING id",
      args: [interaction.user.id, dados.cliente, dados.email, dados.servico, dados.valor, new Date().toISOString()]
    })
    const contratoId = result.rows[0].id

    const linkAssinar = `${process.env.RENDER_EXTERNAL_URL}/assinar/${contratoId}`
    await transporter.sendMail({
      from: `Contratos <${process.env.EMAIL_USER}>`,
      to: dados.email,
      subject: `Contrato para Assinatura - ${dados.servico}`,
      html: `<h2>Olá ${dados.cliente},</h2>
             <p>Contrato de ${dados.servico} no valor de R$ ${dados.valor}</p>
             <a href="${linkAssinar}" style="background:#5865F2;color:white;padding:12px 24px;text-decoration:none;border-radius:5px">Assinar Contrato</a>`,
      attachments: [{ filename: 'contrato.pdf', path: pdfPath }]
    })

    fs.unlinkSync(pdfPath)
    await interaction.editReply(`✅ Contrato #${contratoId} enviado para ${dados.email}`)
  }

  if (interaction.commandName === 'relatorio-contratos') {
    const { rows } = await db.execute("SELECT * FROM contratos ORDER BY id DESC LIMIT 10")
    if (rows.length === 0) return interaction.reply('Nenhum contrato enviado ainda.')
    const lista = rows.map(r => `#${r.id} - ${r.cliente} - R$${r.valor} - ${r.status}`).join('\n')
    await interaction.reply(`**Últimos contratos:**\n\`\`\`${lista}\`\`\``)
  }
});

client.login(process.env.DISCORD_TOKEN);import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { createClient } from '@libsql/client';
import express from 'express';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import fs from 'fs';

// Servidor fake pro Render não dormir + rota de assinatura
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot online!'));

// Conexão com Turso
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Criar tabelas se não existir
await db.execute(`
  CREATE TABLE IF NOT EXISTS pontos (
    user_id TEXT PRIMARY KEY,
    horas INTEGER DEFAULT 0,
    minutos INTEGER DEFAULT 0,
    inicio_timestamp INTEGER DEFAULT NULL
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS contratos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    cliente TEXT,
    email TEXT,
    servico TEXT,
    valor REAL,
    status TEXT DEFAULT 'pendente',
    data TEXT
  )
`);

// Nodemailer pra enviar contrato
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Rota que o cliente clica pra assinar
app.get('/assinar/:id', async (req, res) => {
  try {
    const id = req.params.id
    await db.execute({
      sql: "UPDATE contratos SET status = 'assinado' WHERE id =?",
      args: [id]
    })
    res.send('<h1>Contrato assinado com sucesso!</h1><p>Pode fechar esta página.</p>')
  } catch {
    res.send('Erro ao assinar contrato.')
  }
})

app.listen(PORT, () => console.log(`Servidor web rodando na porta ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// COMANDOS ANTIGOS + 2 NOVOS DE CONTRATO
const commands = [
  new SlashCommandBuilder().setName('iniciar').setDescription('Inicia seu contador de horas'),
  new SlashCommandBuilder().setName('pausar').setDescription('Pausa seu contador de horas'),
  new SlashCommandBuilder().setName('encerrar').setDescription('Encerra e salva suas horas do dia'),
  new SlashCommandBuilder().setName('meuponto').setDescription('Mostra suas horas acumuladas'),
  new SlashCommandBuilder().setName('ranking').setDescription('Mostra o ranking de horas da galera'),
  new SlashCommandBuilder().setName('exportar').setDescription('Exporta suas horas em arquivo'),
  new SlashCommandBuilder().setName('resetar').setDescription('Reseta suas horas pra zero'),
  new SlashCommandBuilder().setName('ajustar').setDescription('Ajusta horas de um membro - Apenas Líderes')
   .addUserOption(option => option.setName('usuario').setDescription('Usuário pra ajustar').setRequired(true))
   .addIntegerOption(option => option.setName('horas').setDescription('Quantidade de horas').setRequired(true))
   .addIntegerOption(option => option.setName('minutos').setDescription('Quantidade de minutos').setRequired(true)),
  new SlashCommandBuilder().setName('horas').setDescription('Mostra suas horas acumuladas'),

  // NOVOS COMANDOS DE CONTRATO
  new SlashCommandBuilder().setName('enviar-contrato').setDescription('Envia contrato por email para assinatura'),
  new SlashCommandBuilder().setName('relatorio-contratos').setDescription('Mostra últimos contratos enviados')
].map(command => command.toJSON());

// Registrar comandos
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`Bot online: ${client.user.tag}`);
    console.log('Todos comandos registrados!');
  } catch (error) {
    console.error(error);
  }
});

// Lógica dos comandos
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() &&!interaction.isModalSubmit()) return;

  const userId = interaction.user.id;

  // TEUS COMANDOS ANTIGOS DE PONTO - DEIXEI IGUAL
  if (interaction.commandName === 'iniciar') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const guildId = interaction.guild.id;
      const check = await db.execute({
        sql: 'SELECT * FROM sessoes WHERE user_id =? AND fim IS NULL',
        args: [userId]
      });
      if (check.rows.length > 0) {
        return interaction.editReply('❌ Tu já tem uma sessão ativa. Usa `/parar` antes.');
      }
      const agora = new Date().toISOString();
      await db.execute({
        sql: 'INSERT INTO sessoes (user_id, guild_id, inicio) VALUES (?,?,?)',
        args: [userId, guildId, agora]
      });
      await interaction.editReply('✅ Sessão iniciada! Bom trabalho.');
    } catch (error) {
      console.error('Erro no /iniciar:', error);
      await interaction.editReply('❌ Deu erro ao iniciar. Tenta de novo.');
    }
  }

  if (interaction.commandName === 'pausar') {
    await interaction.reply('Pausa registrada! Use /iniciar pra continuar.');
  }

  if (interaction.commandName === 'encerrar') {
    await interaction.reply('Expediente encerrado! Horas salvas.');
  }

  if (interaction.commandName === 'meuponto' || interaction.commandName === 'horas') {
    const result = await db.execute({
      sql: 'SELECT horas, minutos FROM pontos WHERE user_id =?',
      args: [userId]
    });
    if (result.rows.length === 0) {
      return interaction.reply('Você ainda não tem horas. Use /iniciar primeiro.');
    }
    const { horas, minutos } = result.rows[0];
    await interaction.reply(`Você tem **${horas}h e ${minutos}min** acumulados.`);
  }

  if (interaction.commandName === 'ranking') {
    const result = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC LIMIT 10');
    if (result.rows.length === 0) {
      return interaction.reply('Ninguém pontuou ainda.');
    }
    let msg = '**Ranking de Horas:**\n';
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        const member = await interaction.guild.members.fetch(row.user_id);
        const nome = member.displayName;
        msg += `${i + 1}. ${nome} - ${row.horas}h ${row.minutos}min\n`;
      } catch {
        msg += `${i + 1}. Usuário saiu - ${row.horas}h ${row.minutos}min\n`;
      }
    }
    await interaction.reply(msg);
  }

  if (interaction.commandName === 'exportar') {
    const ID_CARGO_LIDER = '1476731803384545390';
    if (!interaction.member.roles.cache.has(ID_CARGO_LIDER)) {
      return interaction.reply({ content: 'Apenas Líderes podem exportar os dados.', ephemeral: true });
    }
    await interaction.deferReply();
    const result = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC');
    if (result.rows.length === 0) {
      return interaction.editReply('Ninguém pontuou ainda.');
    }
    let arquivo = `Ranking de Horas - Exportado em ${new Date().toLocaleDateString('pt-BR')}\n`;
    arquivo += `Total de membros: ${result.rows.length}\n\n`;
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        const member = await interaction.guild.members.fetch(row.user_id);
        const nome = member.displayName;
        arquivo += `${i + 1}. ${nome} - ${row.horas}h ${row.minutos}min\n`;
      } catch {
        arquivo += `${i + 1}. Usuário saiu (ID: ${row.user_id}) - ${row.horas}h ${row.minutos}min\n`;
      }
    }
    const buffer = Buffer.from(arquivo, 'utf-8');
    await interaction.editReply({
      content: '✅ **Exportação completa:**',
      files: [{ attachment: buffer, name: 'ranking-completo.txt' }]
    });
  }

  if (interaction.commandName === 'resetar') {
    await db.execute({
      sql: 'UPDATE pontos SET horas = 0, minutos = 0, inicio_timestamp = NULL WHERE user_id =?',
      args: [userId]
    });
    await interaction.reply('Suas horas foram resetadas pra zero.');
  }

  if (interaction.commandName === 'ajustar') {
    const ID_CARGO_LIDER = '1476731803384545390';
    if (!interaction.member.roles.cache.has(ID_CARGO_LIDER)) {
      return interaction.reply({ content: 'Apenas Líderes podem ajustar horas.', ephemeral: true });
    }
    const usuarioAlvo = interaction.options.getUser('usuario');
    const horas = interaction.options.getInteger('horas');
    const minutos = interaction.options.getInteger('minutos');
    await db.execute({
      sql: `INSERT INTO pontos (user_id, horas, minutos) VALUES (?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET horas =?, minutos =?`,
      args: [usuarioAlvo.id, horas, minutos, horas, minutos]
    });
    await interaction.reply(`✅ Horas de ${usuarioAlvo} ajustadas pra **${horas}h e ${minutos}min** por ${interaction.user}.`);
  }

  // COMANDOS NOVOS DE CONTRATO
  if (interaction.commandName === 'enviar-contrato') {
    const modal = new ModalBuilder().setCustomId('modalContrato').setTitle('Novo Contrato')
    const inputs = [
      new TextInputBuilder().setCustomId('cliente').setLabel('Nome do Cliente').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('email').setLabel('Email do Cliente').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('servico').setLabel('Serviço').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('valor').setLabel('Valor R$').setStyle(TextInputStyle.Short).setRequired(true)
    ]
    modal.addComponents(...inputs.map(input => new ActionRowBuilder().addComponents(input)))
    await interaction.showModal(modal)
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modalContrato') {
    await interaction.deferReply({ ephemeral: true })
    const dados = {
      cliente: interaction.fields.getTextInputValue('cliente'),
      email: interaction.fields.getTextInputValue('email'),
      servico: interaction.fields.getTextInputValue('servico'),
      valor: interaction.fields.getTextInputValue('valor')
    }

    const doc = new PDFDocument()
    const pdfPath = `./contrato-${Date.now()}.pdf`
    doc.pipe(fs.createWriteStream(pdfPath))
    doc.fontSize(20).text('CONTRATO DE PRESTAÇÃO DE SERVIÇO', { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text(`Cliente: ${dados.cliente}`)
    doc.text(`Serviço: ${dados.servico}`)
    doc.text(`Valor: R$ ${dados.valor}`)
    doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`)
    doc.end()
    await new Promise(r => doc.on('end', r))

    const result = await db.execute({
      sql: "INSERT INTO contratos (user_id, cliente, email, servico, valor, status, data) VALUES (?,?,?,?,?, 'pendente',?) RETURNING id",
      args: [interaction.user.id, dados.cliente, dados.email, dados.servico, dados.valor, new Date().toISOString()]
    })
    const contratoId = result.rows[0].id

    const linkAssinar = `${process.env.RENDER_EXTERNAL_URL}/assinar/${contratoId}`
    await transporter.sendMail({
      from: `Contratos <${process.env.EMAIL_USER}>`,
      to: dados.email,
      subject: `Contrato para Assinatura - ${dados.servico}`,
      html: `<h2>Olá ${dados.cliente},</h2>
             <p>Contrato de ${dados.servico} no valor de R$ ${dados.valor}</p>
             <a href="${linkAssinar}" style="background:#5865F2;color:white;padding:12px 24px;text-decoration:none;border-radius:5px">Assinar Contrato</a>`,
      attachments: [{ filename: 'contrato.pdf', path: pdfPath }]
    })

    fs.unlinkSync(pdfPath)
    await interaction.editReply(`✅ Contrato #${contratoId} enviado para ${dados.email}`)
  }

  if (interaction.commandName === 'relatorio-contratos') {
    const { rows } = await db.execute("SELECT * FROM contratos ORDER BY id DESC LIMIT 10")
    if (rows.length === 0) return interaction.reply('Nenhum contrato enviado ainda.')
    const lista = rows.map(r => `#${r.id} - ${r.cliente} - R$${r.valor} - ${r.status}`).join('\n')
    await interaction.reply(`**Últimos contratos:**\n\`\`\`${lista}\`\`\``)
  }
});

client.login(process.env.DISCORD_TOKEN);import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { createClient } from '@libsql/client';
import express from 'express';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import fs from 'fs';

// Servidor fake pro Render não dormir + rota de assinatura
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot online!'));

// Conexão com Turso
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Criar tabelas se não existir
await db.execute(`
  CREATE TABLE IF NOT EXISTS pontos (
    user_id TEXT PRIMARY KEY,
    horas INTEGER DEFAULT 0,
    minutos INTEGER DEFAULT 0,
    inicio_timestamp INTEGER DEFAULT NULL
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS contratos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    cliente TEXT,
    email TEXT,
    servico TEXT,
    valor REAL,
    status TEXT DEFAULT 'pendente',
    data TEXT
  )
`);

// Nodemailer pra enviar contrato
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Rota que o cliente clica pra assinar
app.get('/assinar/:id', async (req, res) => {
  try {
    const id = req.params.id
    await db.execute({
      sql: "UPDATE contratos SET status = 'assinado' WHERE id =?",
      args: [id]
    })
    res.send('<h1>Contrato assinado com sucesso!</h1><p>Pode fechar esta página.</p>')
  } catch {
    res.send('Erro ao assinar contrato.')
  }
})

app.listen(PORT, () => console.log(`Servidor web rodando na porta ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// COMANDOS ANTIGOS + 2 NOVOS DE CONTRATO
const commands = [
  new SlashCommandBuilder().setName('iniciar').setDescription('Inicia seu contador de horas'),
  new SlashCommandBuilder().setName('pausar').setDescription('Pausa seu contador de horas'),
  new SlashCommandBuilder().setName('encerrar').setDescription('Encerra e salva suas horas do dia'),
  new SlashCommandBuilder().setName('meuponto').setDescription('Mostra suas horas acumuladas'),
  new SlashCommandBuilder().setName('ranking').setDescription('Mostra o ranking de horas da galera'),
  new SlashCommandBuilder().setName('exportar').setDescription('Exporta suas horas em arquivo'),
  new SlashCommandBuilder().setName('resetar').setDescription('Reseta suas horas pra zero'),
  new SlashCommandBuilder().setName('ajustar').setDescription('Ajusta horas de um membro - Apenas Líderes')
   .addUserOption(option => option.setName('usuario').setDescription('Usuário pra ajustar').setRequired(true))
   .addIntegerOption(option => option.setName('horas').setDescription('Quantidade de horas').setRequired(true))
   .addIntegerOption(option => option.setName('minutos').setDescription('Quantidade de minutos').setRequired(true)),
  new SlashCommandBuilder().setName('horas').setDescription('Mostra suas horas acumuladas'),

  // NOVOS COMANDOS DE CONTRATO
  new SlashCommandBuilder().setName('enviar-contrato').setDescription('Envia contrato por email para assinatura'),
  new SlashCommandBuilder().setName('relatorio-contratos').setDescription('Mostra últimos contratos enviados')
].map(command => command.toJSON());

// Registrar comandos
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`Bot online: ${client.user.tag}`);
    console.log('Todos comandos registrados!');
  } catch (error) {
    console.error(error);
  }
});

// Lógica dos comandos
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() &&!interaction.isModalSubmit()) return;

  const userId = interaction.user.id;

  // TEUS COMANDOS ANTIGOS DE PONTO - DEIXEI IGUAL
  if (interaction.commandName === 'iniciar') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const guildId = interaction.guild.id;
      const check = await db.execute({
        sql: 'SELECT * FROM sessoes WHERE user_id =? AND fim IS NULL',
        args: [userId]
      });
      if (check.rows.length > 0) {
        return interaction.editReply('❌ Tu já tem uma sessão ativa. Usa `/parar` antes.');
      }
      const agora = new Date().toISOString();
      await db.execute({
        sql: 'INSERT INTO sessoes (user_id, guild_id, inicio) VALUES (?,?,?)',
        args: [userId, guildId, agora]
      });
      await interaction.editReply('✅ Sessão iniciada! Bom trabalho.');
    } catch (error) {
      console.error('Erro no /iniciar:', error);
      await interaction.editReply('❌ Deu erro ao iniciar. Tenta de novo.');
    }
  }

  if (interaction.commandName === 'pausar') {
    await interaction.reply('Pausa registrada! Use /iniciar pra continuar.');
  }

  if (interaction.commandName === 'encerrar') {
    await interaction.reply('Expediente encerrado! Horas salvas.');
  }

  if (interaction.commandName === 'meuponto' || interaction.commandName === 'horas') {
    const result = await db.execute({
      sql: 'SELECT horas, minutos FROM pontos WHERE user_id =?',
      args: [userId]
    });
    if (result.rows.length === 0) {
      return interaction.reply('Você ainda não tem horas. Use /iniciar primeiro.');
    }
    const { horas, minutos } = result.rows[0];
    await interaction.reply(`Você tem **${horas}h e ${minutos}min** acumulados.`);
  }

  if (interaction.commandName === 'ranking') {
    const result = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC LIMIT 10');
    if (result.rows.length === 0) {
      return interaction.reply('Ninguém pontuou ainda.');
    }
    let msg = '**Ranking de Horas:**\n';
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        const member = await interaction.guild.members.fetch(row.user_id);
        const nome = member.displayName;
        msg += `${i + 1}. ${nome} - ${row.horas}h ${row.minutos}min\n`;
      } catch {
        msg += `${i + 1}. Usuário saiu - ${row.horas}h ${row.minutos}min\n`;
      }
    }
    await interaction.reply(msg);
  }

  if (interaction.commandName === 'exportar') {
    const ID_CARGO_LIDER = '1476731803384545390';
    if (!interaction.member.roles.cache.has(ID_CARGO_LIDER)) {
      return interaction.reply({ content: 'Apenas Líderes podem exportar os dados.', ephemeral: true });
    }
    await interaction.deferReply();
    const result = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC');
    if (result.rows.length === 0) {
      return interaction.editReply('Ninguém pontuou ainda.');
    }
    let arquivo = `Ranking de Horas - Exportado em ${new Date().toLocaleDateString('pt-BR')}\n`;
    arquivo += `Total de membros: ${result.rows.length}\n\n`;
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        const member = await interaction.guild.members.fetch(row.user_id);
        const nome = member.displayName;
        arquivo += `${i + 1}. ${nome} - ${row.horas}h ${row.minutos}min\n`;
      } catch {
        arquivo += `${i + 1}. Usuário saiu (ID: ${row.user_id}) - ${row.horas}h ${row.minutos}min\n`;
      }
    }
    const buffer = Buffer.from(arquivo, 'utf-8');
    await interaction.editReply({
      content: '✅ **Exportação completa:**',
      files: [{ attachment: buffer, name: 'ranking-completo.txt' }]
    });
  }

  if (interaction.commandName === 'resetar') {
    await db.execute({
      sql: 'UPDATE pontos SET horas = 0, minutos = 0, inicio_timestamp = NULL WHERE user_id =?',
      args: [userId]
    });
    await interaction.reply('Suas horas foram resetadas pra zero.');
  }

  if (interaction.commandName === 'ajustar') {
    const ID_CARGO_LIDER = '1476731803384545390';
    if (!interaction.member.roles.cache.has(ID_CARGO_LIDER)) {
      return interaction.reply({ content: 'Apenas Líderes podem ajustar horas.', ephemeral: true });
    }
    const usuarioAlvo = interaction.options.getUser('usuario');
    const horas = interaction.options.getInteger('horas');
    const minutos = interaction.options.getInteger('minutos');
    await db.execute({
      sql: `INSERT INTO pontos (user_id, horas, minutos) VALUES (?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET horas =?, minutos =?`,
      args: [usuarioAlvo.id, horas, minutos, horas, minutos]
    });
    await interaction.reply(`✅ Horas de ${usuarioAlvo} ajustadas pra **${horas}h e ${minutos}min** por ${interaction.user}.`);
  }

  // COMANDOS NOVOS DE CONTRATO
  if (interaction.commandName === 'enviar-contrato') {
    const modal = new ModalBuilder().setCustomId('modalContrato').setTitle('Novo Contrato')
    const inputs = [
      new TextInputBuilder().setCustomId('cliente').setLabel('Nome do Cliente').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('email').setLabel('Email do Cliente').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('servico').setLabel('Serviço').setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId('valor').setLabel('Valor R$').setStyle(TextInputStyle.Short).setRequired(true)
    ]
    modal.addComponents(...inputs.map(input => new ActionRowBuilder().addComponents(input)))
    await interaction.showModal(modal)
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modalContrato') {
    await interaction.deferReply({ ephemeral: true })
    const dados = {
      cliente: interaction.fields.getTextInputValue('cliente'),
      email: interaction.fields.getTextInputValue('email'),
      servico: interaction.fields.getTextInputValue('servico'),
      valor: interaction.fields.getTextInputValue('valor')
    }

    const doc = new PDFDocument()
    const pdfPath = `./contrato-${Date.now()}.pdf`
    doc.pipe(fs.createWriteStream(pdfPath))
    doc.fontSize(20).text('CONTRATO DE PRESTAÇÃO DE SERVIÇO', { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text(`Cliente: ${dados.cliente}`)
    doc.text(`Serviço: ${dados.servico}`)
    doc.text(`Valor: R$ ${dados.valor}`)
    doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`)
    doc.end()
    await new Promise(r => doc.on('end', r))

    const result = await db.execute({
      sql: "INSERT INTO contratos (user_id, cliente, email, servico, valor, status, data) VALUES (?,?,?,?,?, 'pendente',?) RETURNING id",
      args: [interaction.user.id, dados.cliente, dados.email, dados.servico, dados.valor, new Date().toISOString()]
    })
    const contratoId = result.rows[0].id

    const linkAssinar = `${process.env.RENDER_EXTERNAL_URL}/assinar/${contratoId}`
    await transporter.sendMail({
      from: `Contratos <${process.env.EMAIL_USER}>`,
      to: dados.email,
      subject: `Contrato para Assinatura - ${dados.servico}`,
      html: `<h2>Olá ${dados.cliente},</h2>
             <p>Contrato de ${dados.servico} no valor de R$ ${dados.valor}</p>
             <a href="${linkAssinar}" style="background:#5865F2;color:white;padding:12px 24px;text-decoration:none;border-radius:5px">Assinar Contrato</a>`,
      attachments: [{ filename: 'contrato.pdf', path: pdfPath }]
    })

    fs.unlinkSync(pdfPath)
    await interaction.editReply(`✅ Contrato #${contratoId} enviado para ${dados.email}`)
  }

  if (interaction.commandName === 'relatorio-contratos') {
    const { rows } = await db.execute("SELECT * FROM contratos ORDER BY id DESC LIMIT 10")
    if (rows.length === 0) return interaction.reply('Nenhum contrato enviado ainda.')
    const lista = rows.map(r => `#${r.id} - ${r.cliente} - R$${r.valor} - ${r.status}`).join('\n')
    await interaction.reply(`**Últimos contratos:**\n\`\`\`${lista}\`\`\``)
  }
});

client.login(process.env.DISCORD_TOKEN);
