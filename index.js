import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } from 'discord.js';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import express from 'express';
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let db;

async function initDB() {
  db = await open({
    filename: './ponto.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS registros (
      user_id TEXT,
      guild_id TEXT,
      tipo TEXT,
      timestamp INTEGER
    );
    CREATE TABLE IF NOT EXISTS ajustes (
      user_id TEXT,
      guild_id TEXT,
      horas INTEGER,
      motivo TEXT,
      admin_id TEXT,
      timestamp INTEGER
    );
  `);
}

const commands = [
  new SlashCommandBuilder().setName('iniciar').setDescription('Registra entrada'),
  new SlashCommandBuilder().setName('pausar').setDescription('Registra pausa'),
  new SlashCommandBuilder().setName('encerrar').setDescription('Registra saída e conta horas'),
  new SlashCommandBuilder().setName('horas').setDescription('Mostra suas horas hoje/semana'),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking semanal Top 10'),
  new SlashCommandBuilder().setName('bancohoras').setDescription('Mostra seu banco de horas'),
  new SlashCommandBuilder().setName('inativos').setDescription('Lista quem não bate ponto há 3 dias').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('exportar').setDescription('Exporta planilha').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(opt => opt.setName('formato').setDescription('csv ou txt').setRequired(true).addChoices({name: 'CSV', value: 'csv'}, {name: 'TXT', value: 'txt'})),
  new SlashCommandBuilder().setName('ajustar').setDescription('Adiciona/remove horas').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(opt => opt.setName('usuario').setDescription('Membro').setRequired(true)).addIntegerOption(opt => opt.setName('minutos').setDescription('Minutos pra add/remover. Negativo = remove').setRequired(true)).addStringOption(opt => opt.setName('motivo').setDescription('Motivo do ajuste').setRequired(true))
].map(cmd => cmd.toJSON());

async function calcularHoras(userId, guildId, dias = 1) {
  const inicio = Date.now() - (dias * 24 * 60 * 60 * 1000);
  const registros = await db.all(`SELECT * FROM registros WHERE user_id =? AND guild_id =? AND timestamp >? ORDER BY timestamp ASC`, [userId, guildId, inicio]);

  let totalMs = 0;
  let ultimoInicio = null;
  let pausado = false;

  for (const r of registros) {
    if (r.tipo === 'iniciar') {
      if (pausado) pausado = false;
      ultimoInicio = r.timestamp;
    }
    if (r.tipo === 'pausar' && ultimoInicio &&!pausado) {
      pausado = true;
      totalMs += r.timestamp - ultimoInicio;
      ultimoInicio = null;
    }
    if (r.tipo === 'encerrar' && ultimoInicio &&!pausado) {
      totalMs += r.timestamp - ultimoInicio;
      ultimoInicio = null;
    }
  }

  const ajustes = await db.get(`SELECT SUM(horas) as total FROM ajustes WHERE user_id =? AND guild_id =?`, [userId, guildId]);
  totalMs += (ajustes?.total || 0) * 60 * 1000;

  return totalMs / (1000 * 60 * 60);
}

client.once('ready', async () => {
  await initDB();
  console.log(`Bot online: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log('Comandos registrados!');
});

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  const { commandName, user, guildId } = i;

  try {
    if (commandName === 'iniciar') {
      await db.run(`INSERT INTO registros (user_id, guild_id, tipo, timestamp) VALUES (?,?, 'iniciar',?)`, [user.id, guildId, Date.now()]);
      await i.reply({ content: `⏰ Ponto iniciado! Bom trabalho, ${user.username}`, ephemeral: true });
    }

    if (commandName === 'pausar') {
      await db.run(`INSERT INTO registros (user_id, guild_id, tipo, timestamp) VALUES (?,?, 'pausar',?)`, [user.id, guildId, Date.now()]);
      await i.reply({ content: `⏸️ Pausa registrada!`, ephemeral: true });
    }

    if (commandName === 'encerrar') {
      await db.run(`INSERT INTO registros (user_id, guild_id, tipo, timestamp) VALUES (?,?, 'encerrar',?)`, [user.id, guildId, Date.now()]);
      const horasHoje = await calcularHoras(user.id, guildId, 1);
      await i.reply({ content: `✅ Ponto encerrado! Você trabalhou ${horasHoje.toFixed(2)}h hoje.`, ephemeral: true });
    }

    if (commandName === 'horas') {
      const horasHoje = await calcularHoras(user.id, guildId, 1);
      const horasSemana = await calcularHoras(user.id, guildId, 7);
      await i.reply({ content: `📊 **Suas horas**\nHoje: ${horasHoje.toFixed(2)}h\nSemana: ${horasSemana.toFixed(2)}h`, ephemeral: true });
    }

    if (commandName === 'ranking') {
      const usuarios = await db.all(`SELECT DISTINCT user_id FROM registros WHERE guild_id =?`, [guildId]);
      let rank = [];
      for (const u of usuarios) {
        const horas = await calcularHoras(u.user_id, guildId, 7);
        if (horas > 0.01) rank.push({ id: u.user_id, horas });
      }
      rank.sort((a, b) => b.horas - a.horas);
      rank = rank.slice(0, 10);

      let texto = `🏆 **Ranking Semanal**\n`;
      const medalhas = ['🥇', '🥈', '🥉'];
      for (let j = 0; j < rank.length; j++) {
        const medal = medalhas[j] || `${j + 1}.`;
        texto += `${medal} <@${rank[j].id}> — ${rank[j].horas.toFixed(2)}h\n`;
      }
      await i.reply({ content: texto || 'Ninguém bateu ponto essa semana.' });
    }

    if (commandName === 'bancohoras') {
      const horasSemana = await calcularHoras(user.id, guildId, 7);
      const saldo = horasSemana - 40;
      await i.reply({ content: `🏦 **Banco de Horas**\nSaldo: ${saldo.toFixed(2)}h\n${saldo > 0? 'Você tem horas pra folga!' : 'Sem horas extras ainda.'}`, ephemeral: true });
    }

    if (commandName === 'inativos') {
      const tresDiasAtras = Date.now() - (3 * 24 * 60 * 60 * 1000);
      const ativos = await db.all(`SELECT DISTINCT user_id FROM registros WHERE guild_id =? AND timestamp >?`, [guildId, tresDiasAtras]);
      const idsAtivos = ativos.map(a => a.user_id);
      const membros = await i.guild.members.fetch();
      const inativos = membros.filter(m =>!m.user.bot &&!idsAtivos.includes(m.id));

      let texto = `🚫 **Inativos há 3+ dias:**\n`;
      inativos.forEach(m => texto += `- ${m.user.username}\n`);
      await i.reply({ content: texto || 'Todo mundo bateu ponto!', ephemeral: true });
    }

   if (commandName === 'exportar') {
  const formato = i.options.getString('formato');
  const dados = await db.all(`SELECT * FROM registros WHERE guild_id =? ORDER BY timestamp DESC`, [guildId]);
  
  await i.deferReply({ ephemeral: true });

  if (formato === 'csv') {
    let csv = 'Usuario,Tipo,Data\n';
    for (const d of dados) {
      try {
        const user = await client.users.fetch(d.user_id);
        csv += `${user.username},${d.tipo},${new Date(d.timestamp).toLocaleString('pt-BR')}\n`;
      } catch {
        csv += `${d.user_id},${d.tipo},${new Date(d.timestamp).toLocaleString('pt-BR')}\n`;
      }
    }
    await i.editReply({ content: '📁 **Relatório CSV**', files: [{ attachment: Buffer.from(csv), name: 'relatorio.csv' }] });
  } else {
    let txt = 'RELATÓRIO DE PONTO\n\n';
    for (const d of dados) {
      try {
        const user = await client.users.fetch(d.user_id);
        txt += `${user.username} — ${d.tipo} — ${new Date(d.timestamp).toLocaleString('pt-BR')}\n`;
      } catch {
        txt += `${d.user_id} — ${d.tipo} — ${new Date(d.timestamp).toLocaleString('pt-BR')}\n`;
      }
    }
    await i.editReply({ content: '📁 **Relatório TXT**', files: [{ attachment: Buffer.from(txt), name: 'relatorio.txt' }] });
  }
}
    if (commandName === 'ajustar') {
      const usuario = i.options.getUser('usuario');
      const minutos = i.options.getInteger('minutos');
      const motivo = i.options.getString('motivo');

      await db.run(`INSERT INTO ajustes (user_id, guild_id, horas, motivo, admin_id, timestamp) VALUES (?,?,?,?,?,?)`, [usuario.id, guildId, minutos, motivo, user.id, Date.now()]);
      await i.reply({ content: `🛠️ Ajustado ${minutos} minutos para ${usuario.username}\nMotivo: ${motivo}\nLog salvo.`, ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (!i.replied) await i.reply({ content: '❌ Deu erro aqui. Tenta de novo.', ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
// Servidor web pra manter o bot 24/7 no Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot de ponto online 24/7!');
});

app.listen(PORT, () => {
  console.log(`Servidor web fake rodando na porta ${PORT}`);
})
