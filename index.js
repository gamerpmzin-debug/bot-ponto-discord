import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } from 'discord.js';
import { createClient } from '@libsql/client';
import express from 'express';

// Servidor fake pro Render não dormir
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot online!'));
app.listen(PORT, () => console.log(`Servidor web fake rodando na porta ${PORT}`));

// Conexão com Turso - SEM syncUrl
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Criar tabela se não existir
await db.execute(`
  CREATE TABLE IF NOT EXISTS pontos (
    user_id TEXT PRIMARY KEY,
    horas INTEGER DEFAULT 0,
    minutos INTEGER DEFAULT 0
  )
`);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Comandos
const commands = [
  new SlashCommandBuilder()
   .setName('iniciar')
   .setDescription('Inicia seu contador de horas'),

  new SlashCommandBuilder()
   .setName('horas')
   .setDescription('Mostra suas horas acumuladas'),

  new SlashCommandBuilder()
   .setName('resetar')
   .setDescription('Reseta suas horas pra zero')
].map(command => command.toJSON());

// Registrar comandos
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log(`Bot online: ${client.user.tag}`);
    console.log('Comandos registrados!');
  } catch (error) {
    console.error(error);
  }
});

// Lógica dos comandos
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;

  if (interaction.commandName === 'iniciar') {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO pontos (user_id, horas, minutos) VALUES (?, 0, 0)',
      args: [userId]
    });
    await interaction.reply('Contador iniciado! Use /horas pra ver seu tempo.');
  }

  if (interaction.commandName === 'horas') {
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

  if (interaction.commandName === 'resetar') {
    await db.execute({
      sql: 'UPDATE pontos SET horas = 0, minutos = 0 WHERE user_id =?',
      args: [userId]
    });
    await interaction.reply('Suas horas foram resetadas pra zero.');
  }
});

client.login(process.env.DISCORD_TOKEN);
