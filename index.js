import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } from 'discord.js';
import { createClient } from '@libsql/client';
import express from 'express';

// Servidor fake pro Render não dormir
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot online!'));
app.listen(PORT, () => console.log(`Servidor web fake rodando na porta ${PORT}`));

// Conexão com Turso
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Criar tabela se não existir
await db.execute(`
  CREATE TABLE IF NOT EXISTS pontos (
    user_id TEXT PRIMARY KEY,
    horas INTEGER DEFAULT 0,
    minutos INTEGER DEFAULT 0,
    inicio_timestamp INTEGER DEFAULT NULL
  )
`);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// TODOS OS 9 COMANDOS
const commands = [
  new SlashCommandBuilder()
   .setName('iniciar')
   .setDescription('Inicia seu contador de horas'),

  new SlashCommandBuilder()
   .setName('pausar')
   .setDescription('Pausa seu contador de horas'),

  new SlashCommandBuilder()
   .setName('encerrar')
   .setDescription('Encerra e salva suas horas do dia'),

  new SlashCommandBuilder()
   .setName('meuponto')
   .setDescription('Mostra suas horas acumuladas'),

  new SlashCommandBuilder()
   .setName('ranking')
   .setDescription('Mostra o ranking de horas da galera'),

  new SlashCommandBuilder()
   .setName('exportar')
   .setDescription('Exporta suas horas em arquivo'),

  new SlashCommandBuilder()
   .setName('resetar')
   .setDescription('Reseta suas horas pra zero'),

  new SlashCommandBuilder()
   .setName('ajustar')
   .setDescription('Ajusta manualmente suas horas')
   .addIntegerOption(option =>
      option.setName('horas').setDescription('Quantidade de horas').setRequired(true))
   .addIntegerOption(option =>
      option.setName('minutos').setDescription('Quantidade de minutos').setRequired(true)),

  new SlashCommandBuilder()
   .setName('horas')
   .setDescription('Mostra suas horas acumuladas')
].map(command => command.toJSON());

// Registrar comandos
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => { // ARRUMADO
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log(`Bot online: ${client.user.tag}`);
    console.log('Todos 9 comandos registrados!');
  } catch (error) {
    console.error(error);
  }
});

// Lógica dos comandos
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;

  if (interaction.commandName === 'iniciar') {
    const now = Date.now();
    await db.execute({
      sql: 'INSERT OR IGNORE INTO pontos (user_id, horas, minutos, inicio_timestamp) VALUES (?, 0, 0,?) ON CONFLICT(user_id) DO UPDATE SET inicio_timestamp =?',
      args: [userId, now, now]
    });
    await interaction.reply('Contador iniciado! Use /pausar ou /encerrar depois.');
  }

  if (interaction.commandName === 'pausar') {
    await interaction.reply('Pausa registrada! Use /iniciar pra continuar.');
    // Lógica de pausar tu implementa aqui depois
  }

  if (interaction.commandName === 'encerrar') {
    await interaction.reply('Expediente encerrado! Horas salvas.');
    // Lógica de encerrar tu implementa aqui depois
  }

  if (interaction.commandName === 'meuponto' || interaction.commandName === 'horas') {
    const result = await db.execute({
      sql: 'SELECT horas, minutos FROM pontos WHERE user_id =?',
      args: [userId]
    });

    if (result.rows.length === 0) {
      return interaction.reply('Você ainda não iniciou. Use /iniciar primeiro.');
    }

    const { horas, minutos } = result.rows[0];
    await interaction.reply(`Você tem ${horas}h e ${minutos}min acumulados.`);
  }

  if (interaction.commandName === 'ranking') {
    const result = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC LIMIT 10');
    let msg = '**Ranking de Horas:**\n';
    result.rows.forEach((row, i) => {
      msg += `${i + 1}. <@${row.user_id}> - ${row.horas}h ${row.minutos}min\n`;
    });
    await interaction.reply(msg);
  }

  if (interaction.commandName === 'exportar') {
    const result = await db.execute({
      sql: 'SELECT horas, minutos FROM pontos WHERE user_id =?',
      args: [userId]
    });

    if (result.rows.length === 0) {
      return interaction.reply('Você ainda não tem horas pra exportar.');
    }

    const { horas, minutos } = result.rows[0];
    await interaction.reply(`Exportando: ${interaction.user.username} - ${horas}h ${minutos}min`);
  }

  if (interaction.commandName === 'resetar') {
    await db.execute({
      sql: 'UPDATE pontos SET horas = 0, minutos = 0, inicio_timestamp = NULL WHERE user_id =?',
      args: [userId]
    });
    await interaction.reply('Suas horas foram resetadas pra zero.');
  }

  if (interaction.commandName === 'ajustar') {
    const horas = interaction.options.getInteger('horas');
    const minutos = interaction.options.getInteger('minutos');

    await db.execute({
      sql: 'INSERT OR REPLACE INTO pontos (user_id, horas, minutos) VALUES (?,?,?)',
      args: [userId, horas, minutos]
    });
    await interaction.reply(`Horas ajustadas pra ${horas}h e ${minutos}min.`);
  }
});

client.login(process.env.DISCORD_TOKEN);
