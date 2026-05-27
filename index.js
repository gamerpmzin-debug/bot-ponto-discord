import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } from 'discord.js';
import { createClient } from '@libsql/client';
import express from 'express';
import nodemailer from 'nodemailer';
import 'dotenv/config';

const app = express();
app.get('/', (req, res) => res.send('Bot online!'));
app.listen(process.env.PORT || 10000);

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const ID_CARGO_LIDER = '1476731803384545390';
const ID_DONO = '1476727569268084858';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages] });

const commands = [
  new SlashCommandBuilder().setName('iniciar').setDescription('Inicia contador'),
  new SlashCommandBuilder().setName('pausar').setDescription('Pausa contador'),
  new SlashCommandBuilder().setName('encerrar').setDescription('Encerra e salva horas'),
  new SlashCommandBuilder().setName('meuponto').setDescription('Mostra suas horas'),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking de horas'),
  new SlashCommandBuilder().setName('exportar').setDescription('Exporta horas de todos'),
  new SlashCommandBuilder().setName('resetar').setDescription('Reseta suas horas'),
  new SlashCommandBuilder().setName('ajustar').setDescription('Ajusta horas de um membro')
    .addUserOption(o => o.setName('usuario').setDescription('Usuário').setRequired(true))
    .addIntegerOption(o => o.setName('horas').setDescription('Horas').setRequired(true))
    .addIntegerOption(o => o.setName('minutos').setDescription('Minutos').setRequired(true)),
  new SlashCommandBuilder().setName('horas').setDescription('Mostra suas horas'),
  new SlashCommandBuilder().setName('criarcontrato').setDescription('Cria contrato pra um usuário').setDefaultMemberPermissions(0)
    .addUserOption(o => o.setName('usuario').setDescription('Quem vai assinar').setRequired(true))
    .addStringOption(o => o.setName('email').setDescription('Email do contrato').setRequired(true)),
  new SlashCommandBuilder().setName('assinar').setDescription('Assina seu contrato pendente'),
  new SlashCommandBuilder().setName('relatoriocontratos').setDescription('Ver todos contratos assinados').setDefaultMemberPermissions(0)
].map(c => c.toJSON());

client.once('ready', async () => {
  await db.execute(`CREATE TABLE IF NOT EXISTS pontos (user_id TEXT PRIMARY KEY, horas INTEGER DEFAULT 0, minutos INTEGER DEFAULT 0)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS sessoes (id INTEGER PRIMARY KEY, user_id TEXT, guild_id TEXT, inicio TEXT, fim TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS contratos (id INTEGER PRIMARY KEY, user_id TEXT, email TEXT, data_criacao TEXT, data_assinatura TEXT, status TEXT DEFAULT 'pendente')`);
  await new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log(`Online: ${client.user.tag}`);
});

client.on('interactionCreate', async i => {
  if (!i.isChatInputCommand()) return;
  const uid = i.user.id;
  await i.deferReply({ ephemeral: i.commandName !== 'ranking' && i.commandName !== 'meuponto' && i.commandName !== 'horas' });

  try {
    if (i.commandName === 'iniciar') {
      const check = await db.execute({ sql: 'SELECT * FROM sessoes WHERE user_id =? AND fim IS NULL', args: [uid] });
      if (check.rows.length > 0) return i.editReply('❌ Sessão já ativa');
      await db.execute({ sql: 'INSERT INTO sessoes (user_id, guild_id, inicio) VALUES (?,?,?)', args: [uid, i.guild.id, new Date().toISOString()] });
      return i.editReply('✅ Sessão iniciada!');
    }

    if (i.commandName === 'pausar') {
      const sessao = await db.execute({ sql: 'SELECT * FROM sessoes WHERE user_id=? AND fim IS NULL', args: [uid] });
      if (!sessao.rows.length) return i.editReply('❌ Tu não tem sessão ativa pra pausar.');
      const inicio = new Date(sessao.rows[0].inicio);
      const diff = Math.floor((Date.now() - inicio) / 60000);
      await db.execute({ sql: 'UPDATE pontos SET horas=horas+?, minutos=minutos+? WHERE user_id=?', args: [Math.floor(diff/60), diff%60, uid] });
      await db.execute({ sql: 'UPDATE sessoes SET fim=? WHERE id=?', args: [new Date().toISOString(), sessao.rows[0].id] });
      return i.editReply(`⏸️ Pausado! Tu fez **${Math.floor(diff/60)}h e ${diff%60}min** nessa sessão.`);
    }

    if (i.commandName === 'encerrar') {
      const sessao = await db.execute({ sql: 'SELECT * FROM sessoes WHERE user_id=? AND fim IS NULL', args: [uid] });
      if (!sessao.rows.length) return i.editReply('❌ Tu não tem sessão ativa pra encerrar.');
      const inicio = new Date(sessao.rows[0].inicio);
      const diff = Math.floor((Date.now() - inicio) / 60000);
      await db.execute({ sql: `INSERT INTO pontos (user_id, horas, minutos) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET horas=horas+?, minutos=minutos+?`, args: [uid, Math.floor(diff/60), diff%60, Math.floor(diff/60), diff%60] });
      await db.execute({ sql: 'UPDATE sessoes SET fim=? WHERE id=?', args: [new Date().toISOString(), sessao.rows[0].id] });
      return i.editReply(`✅ Expediente encerrado! Total da sessão: **${Math.floor(diff/60)}h e ${diff%60}min**.`);
    }

    if (i.commandName === 'meuponto' || i.commandName === 'horas') {
      const r = await db.execute({ sql: 'SELECT horas, minutos FROM pontos WHERE user_id =?', args: [uid] });
      if (!r.rows.length) return i.reply('Você ainda não tem horas. Use /iniciar primeiro.');
      const { horas, minutos } = r.rows[0];
      return i.reply(`Você tem **${horas}h e ${minutos}min** acumulados.`);
    }

    if (i.commandName === 'ranking') {
      const r = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC LIMIT 10');
      if (!r.rows.length) return i.reply('Ninguém pontuou ainda.');
      let msg = '**Ranking de Horas:**\n';
      for (let j = 0; j < r.rows.length; j++) {
        const row = r.rows[j];
        try {
          const member = await i.guild.members.fetch(row.user_id);
          msg += `${j + 1}. ${member.displayName} - ${row.horas}h ${row.minutos}min\n`;
        } catch { msg += `${j + 1}. Usuário saiu - ${row.horas}h ${row.minutos}min\n`; }
      }
      return i.reply(msg);
    }

    if (i.commandName === 'exportar') {
      if (!i.member.roles.cache.has(ID_CARGO_LIDER)) return i.editReply('Apenas Líderes podem exportar.');
      const r = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC');
      if (!r.rows.length) return i.editReply('Ninguém pontuou ainda.');
      let txt = `Ranking - ${new Date().toLocaleDateString('pt-BR')}\n\n`;
      for (let j = 0; j < r.rows.length; j++) {
        const row = r.rows[j];
        try {
          const m = await i.guild.members.fetch(row.user_id);
          txt += `${j + 1}. ${m.displayName} - ${row.horas}h ${row.minutos}min\n`;
        } catch { txt += `${j + 1}. Saiu (ID: ${row.user_id}) - ${row.horas}h ${row.minutos}min\n`; }
      }
      return i.editReply({ content: '✅ Exportação completa:', files: [{ attachment: Buffer.from(txt), name: 'ranking.txt' }] });
    }

    if (i.commandName === 'resetar') {
      await db.execute({ sql: 'UPDATE pontos SET horas=0, minutos=0 WHERE user_id=?', args: [uid] });
      return i.editReply('Suas horas foram resetadas.');
    }

    if (i.commandName === 'ajustar') {
      if (!i.member.roles.cache.has(ID_CARGO_LIDER)) return i.editReply('Apenas Líderes podem ajustar.');
      const alvo = i.options.getUser('usuario');
      const h = i.options.getInteger('horas');
      const m = i.options.getInteger('minutos');
      await db.execute({ sql: `INSERT INTO pontos (user_id, horas, minutos) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET horas=?, minutos=?`, args: [alvo.id, h, m, h, m] });
      return i.editReply(`✅ Horas de ${alvo} ajustadas pra **${h}h e ${m}min**.`);
    }

    if (i.commandName === 'criarcontrato') {
      if (i.user.id !== ID_DONO) return i.editReply('❌ Só o dono pode criar contratos.');
      
      const alvo = i.options.getUser('usuario');
      const email = i.options.getString('email');
      const contratoId = Date.now();
      
      await db.execute({ 
        sql: 'INSERT INTO contratos (id, user_id, email, data_criacao) VALUES (?,?,?,?)', 
        args: [contratoId, alvo.id, email, new Date().toISOString()] 
      });

      const htmlContrato = `
        <div style="font-family: Arial; max-width: 600px; padding: 20px; border: 1px solid #ccc;">
          <h1 style="text-align: center;">CONTRATO DE PRESTAÇÃO DE SERVIÇO</h1>
          <p><strong>Contratado:</strong> ${alvo.username}</p>
          <p><strong>ID Discord:</strong> ${alvo.id}</p>
          <p><strong>Data:</strong> ${new Date().toLocaleDateString('pt-BR')}</p>
          <p><strong>ID Contrato:</strong> ${contratoId}</p>
          <hr>
          <p>1. O contratado se compromete a cumprir as atividades designadas pela liderança.</p>
          <p>2. O pagamento será realizado mediante cumprimento de metas.</p>
          <p>3. Este contrato tem validade de 30 dias.</p>
          <br>
          <p><strong>Para confirmar a assinatura, entre no servidor e use o comando /assinar</strong></p>
          <br>
          <p>_________________________</p>
          <p>Assinatura do Contratado</p>
        </div>
      `;

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: `Contrato #${contratoId} - Assinatura Pendente`,
        html: htmlContrato
      });
      
      return i.editReply(`✅ Contrato #${contratoId} enviado pra ${alvo}. Ele precisa usar /assinar.`);
    }

    if (i.commandName === 'assinar') {
      const contrato = await db.execute({ 
        sql: 'SELECT * FROM contratos WHERE user_id=? AND status="pendente" ORDER BY id DESC LIMIT 1', 
        args: [i.user.id] 
      });
      
      if (!contrato.rows.length) return i.editReply('❌ Tu não tem contrato pendente pra assinar.');
      
      const c = contrato.rows[0];
      await db.execute({ 
        sql: 'UPDATE contratos SET status="assinado", data_assinatura=? WHERE id=?', 
        args: [new Date().toISOString(), c.id] 
      });

      const dono = await client.users.fetch(ID_DONO);
      await dono.send(`📄 **CONTRATO ASSINADO**\n\nID: ${c.id}\nUsuário: ${i.user.tag}\nEmail: ${c.email}\nData: ${new Date().toLocaleString('pt-BR')}`);
      
      return i.editReply(`✅ Contrato #${c.id} assinado com sucesso em ${new Date().toLocaleString('pt-BR')}!`);
    }

    if (i.commandName === 'relatoriocontratos') {
      if (i.user.id !== ID_DONO) return i.editReply('❌ Só o dono pode ver relatórios.');
      
      const r = await db.execute('SELECT * FROM contratos WHERE status="assinado" ORDER BY data_assinatura DESC');
      if (!r.rows.length) return i.editReply('Nenhum contrato assinado ainda.');
      
      let txt = `RELATÓRIO DE CONTRATOS ASSINADOS - ${new Date().toLocaleDateString('pt-BR')}\n\n`;
      for (const row of r.rows) {
        try {
          const u = await client.users.fetch(row.user_id);
          txt += `ID: ${row.id} | ${u.tag} | ${row.email} | ${new Date(row.data_assinatura).toLocaleString('pt-BR')}\n`;
        } catch { 
          txt += `ID: ${row.id} | Usuário saiu | ${row.email} | ${new Date(row.data_assinatura).toLocaleString('pt-BR')}\n`; 
        }
      }
      
      return i.editReply({ content: '✅ Relatório gerado:', files: [{ attachment: Buffer.from(txt), name: 'contratos_assinados.txt' }] });
    }

  } catch (e) {
    console.error(e);
    return i.editReply('❌ Deu erro. Tenta de novo.');
  }
});

client.login(process.env.DISCORD_TOKEN);
