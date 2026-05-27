import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, MessageFlags } from 'discord.js';
import { createClient } from '@libsql/client';
import express from 'express';
import 'dotenv/config';

const app = express();
app.get('/', (req, res) => res.send('Bot online!'));
app.listen(process.env.PORT || 10000);

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const ID_CARGO_LIDER = '1476731803384545390';
const ID_DONO = '1476727569268084858';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages] });

const commands = [
  new SlashCommandBuilder().setName('iniciar').setDescription('Inicia contador'),
  new SlashCommandBuilder().setName('pausar').setDescription('Pausa contador'),
  new SlashCommandBuilder().setName('encerrar').setDescription('Encerra e salva horas'),
  new SlashCommandBuilder().setName('meuponto').setDescription('Mostra suas horas salvas'),
  new SlashCommandBuilder().setName('horas').setDescription('Mostra suas horas salvas'),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking total de horas'),
  new SlashCommandBuilder().setName('rankingsemanal').setDescription('Ranking de horas desta semana'),
  new SlashCommandBuilder().setName('exportar').setDescription('Exporta horas de todos'),
  new SlashCommandBuilder().setName('resetar').setDescription('Reseta suas horas'),
  new SlashCommandBuilder().setName('ajustar').setDescription('Ajusta horas de um membro')
.addUserOption(o => o.setName('usuario').setDescription('Usuário').setRequired(true))
.addIntegerOption(o => o.setName('horas').setDescription('Horas').setRequired(true))
.addIntegerOption(o => o.setName('minutos').setDescription('Minutos').setRequired(true)),
  new SlashCommandBuilder().setName('criarcontrato').setDescription('Cria contrato pra um usuário').setDefaultMemberPermissions(0)
.addUserOption(o => o.setName('usuario').setDescription('Quem vai assinar').setRequired(true))
.addStringOption(o => o.setName('email').setDescription('Email do contrato').setRequired(true))
.addStringOption(o => o.setName('texto').setDescription('Texto custom do contrato. Deixe vazio pra usar o padrão').setRequired(false)),
  new SlashCommandBuilder().setName('assinar').setDescription('Assina seu contrato pendente'),
  new SlashCommandBuilder().setName('enviarcontrato').setDescription('Reenvia contrato por DM').setDefaultMemberPermissions(0)
.addIntegerOption(o => o.setName('id').setDescription('ID do contrato').setRequired(true))
.addStringOption(o => o.setName('texto').setDescription('Sobrescreve o texto na hora de enviar').setRequired(false)),
  new SlashCommandBuilder().setName('relatoriocontratos').setDescription('Ver todos contratos assinados').setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('editarcontrato').setDescription('Edita email de um contrato').setDefaultMemberPermissions(0)
.addIntegerOption(o => o.setName('id').setDescription('ID do contrato').setRequired(true))
.addStringOption(o => o.setName('email').setDescription('Novo email').setRequired(true)),
  new SlashCommandBuilder().setName('deletarcontrato').setDescription('Deleta um contrato').setDefaultMemberPermissions(0)
.addIntegerOption(o => o.setName('id').setDescription('ID do contrato').setRequired(true)),
  new SlashCommandBuilder().setName('editartextocontrato').setDescription('Edita o modelo padrão do contrato').setDefaultMemberPermissions(0)
.addStringOption(o => o.setName('texto').setDescription('Novo texto. Use {usuario}, {id}, {email}, {data}').setRequired(true)),
  new SlashCommandBuilder().setName('vertextocontrato').setDescription('Mostra o modelo padrão do contrato').setDefaultMemberPermissions(0)
].map(c => c.toJSON());

async function getTextoContrato() {
  const r = await db.execute({ sql: 'SELECT valor FROM config WHERE chave="modelo_contrato"' });
  if (r.rows.length) return r.rows[0].valor;
  return `📄 **CONTRATO DE PRESTAÇÃO DE SERVIÇO**\n\n**Contratado:** {usuario}\n**ID Discord:** {id}\n**Email:** {email}\n**Data:** {data}\n\n1. O contratado se compromete a cumprir as atividades designadas pela liderança.\n2. O pagamento será realizado mediante cumprimento de metas.\n3. Este contrato tem validade de 30 dias.\n\n**Para confirmar a assinatura, entre no servidor e use o comando /assinar**`;
}

function aplicarVariaveis(texto, usuario, id, email, data) {
  return texto
.replace(/{usuario}/g, usuario)
.replace(/{id}/g, id)
.replace(/{email}/g, email)
.replace(/{data}/g, data);
}

client.once('clientReady', async () => {
  await db.execute(`CREATE TABLE IF NOT EXISTS pontos (user_id TEXT PRIMARY KEY, horas INTEGER DEFAULT 0, minutos INTEGER DEFAULT 0)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS sessoes (id INTEGER PRIMARY KEY, user_id TEXT, guild_id TEXT, inicio TEXT, fim TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS contratos (id INTEGER PRIMARY KEY, user_id TEXT, email TEXT, texto_custom TEXT, data_criacao TEXT, data_assinatura TEXT, status TEXT DEFAULT 'pendente')`);
  await db.execute(`CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT)`);
  await new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log(`Online: ${client.user.tag}`);
});

client.on('interactionCreate', async i => {
  if (!i.isChatInputCommand()) return;

  const isEphemeral = i.commandName!== 'ranking' && i.commandName!== 'rankingsemanal';
  await i.deferReply({ flags: isEphemeral? MessageFlags.Ephemeral : 0 });

  try {
    const uid = i.user.id;

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
      await db.execute({ sql: `INSERT INTO pontos (user_id, horas, minutos) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET horas=horas+?, minutos=minutos+?`, args: [uid, Math.floor(diff/60), diff%60, Math.floor(diff/60), diff%60] });
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
      if (!r.rows.length) return i.editReply('Você ainda não tem horas salvas. Use /iniciar primeiro.');
      const { horas, minutos } = r.rows[0];
      const totalMin = horas * 60 + minutos;
      return i.editReply(`📊 **Horas salvas:** ${horas}h e ${minutos}min\nTotal: ${totalMin} minutos`);
    }

    if (i.commandName === 'ranking') {
      const r = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC LIMIT 10');
      if (!r.rows.length) return i.editReply('Ninguém pontuou ainda.');
      let msg = '**🏆 Ranking Total de Horas:**\n';
      for (let j = 0; j < r.rows.length; j++) {
        const row = r.rows[j];
        try {
          const member = await i.guild.members.fetch(row.user_id);
          msg += `${j + 1}. ${member.displayName} - ${row.horas}h ${row.minutos}min\n`;
        } catch { msg += `${j + 1}. Usuário saiu - ${row.horas}h ${row.minutos}min\n`; }
      }
      return i.editReply(msg);
    }

    if (i.commandName === 'rankingsemanal') {
      const seteDiasAtras = new Date();
      seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
      const dataLimite = seteDiasAtras.toISOString();

      const r = await db.execute({
        sql: `SELECT user_id, SUM(CASE WHEN fim IS NOT NULL THEN (julianday(fim) - julianday(inicio)) * 24 * 60 ELSE 0 END) as minutos_total
              FROM sessoes
              WHERE inicio >=?
              GROUP BY user_id
              HAVING minutos_total > 0
              ORDER BY minutos_total DESC
              LIMIT 10`,
        args: [dataLimite]
      });

      if (!r.rows.length) return i.editReply('Ninguém pontuou esta semana ainda.');

      let msg = '**📅 Ranking da Semana:**\n';
      for (let j = 0; j < r.rows.length; j++) {
        const row = r.rows[j];
        const totalMin = Math.floor(row.minutos_total);
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        try {
          const member = await i.guild.members.fetch(row.user_id);
          msg += `${j + 1}. ${member.displayName} - ${h}h ${m}min\n`;
        } catch { msg += `${j + 1}. Usuário saiu - ${h}h ${m}min\n`; }
      }
      return i.editReply(msg);
    }

    if (i.commandName === 'exportar') {
      if (!i.member.roles.cache.has(ID_CARGO_LIDER)) return i.editReply('Apenas Líderes podem exportar.');
      const r = await db.execute('SELECT user_id, horas, minutos FROM pontos ORDER BY horas DESC, minutos DESC');
      if (!r.rows.length) return i.editReply('Ninguém pontuou ainda.');
      let txt = `Ranking Total - ${new Date().toLocaleDateString('pt-BR')}\n\n`;
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
      await db.execute({ sql: `INSERT INTO pontos (user_id, horas, minutos) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET horas=?, minutos=?`, args: [alvo.id, h, m] });
      return i.editReply(`✅ Horas de ${alvo} ajustadas pra **${h}h e ${m}min**.`);
    }

    if (i.commandName === 'criarcontrato') {
      if (i.user.id!== ID_DONO) return i.editReply('❌ Só o dono pode criar contratos.');

      const alvo = i.options.getUser('usuario');
      const email = i.options.getString('email');
      const textoCustom = i.options.getString('texto');
      const contratoId = Date.now();

      await db.execute({
        sql: 'INSERT INTO contratos (id, user_id, email, texto_custom, data_criacao) VALUES (?,?,?,?,?)',
        args: [contratoId, alvo.id, email, textoCustom, new Date().toISOString()]
      });

      return i.editReply(`✅ Contrato #${contratoId} criado pra ${alvo}.\n${textoCustom? 'Texto custom salvo.' : 'Usando modelo padrão.'}\n\nUse \`/enviarcontrato id:${contratoId}\` pra mandar.`);
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

      try {
        const dono = await client.users.fetch(ID_DONO);
        await dono.send(`📄 **CONTRATO ASSINADO**\n\nID: ${c.id}\nUsuário: ${i.user.tag}\nEmail: ${c.email}\nData: ${new Date().toLocaleString('pt-BR')}`);
      } catch (dmError) {
        console.log('Não consegui mandar DM pro dono:', dmError.message);
      }

      return i.editReply(`✅ Contrato #${c.id} assinado com sucesso em ${new Date().toLocaleString('pt-BR')}!`);
    }

    if (i.commandName === 'enviarcontrato') {
      if (i.user.id!== ID_DONO) return i.editReply('❌ Só o dono pode enviar contratos.');

      const id = i.options.getInteger('id');
      const textoOverride = i.options.getString('texto');
      const contrato = await db.execute({ sql: 'SELECT * FROM contratos WHERE id=?', args: [id] });
      if (!contrato.rows.length) return i.editReply('❌ Contrato não encontrado.');

      const c = contrato.rows[0];
      const alvo = await client.users.fetch(c.user_id).catch(() => null);
      if (!alvo) return i.editReply('❌ Usuário do contrato não encontrado.');

      let textoBase = textoOverride || c.texto_custom || await getTextoContrato();
      const textoFinal = aplicarVariaveis(
        textoBase,
        alvo.username,
        alvo.id,
        c.email,
        new Date(c.data_criacao).toLocaleDateString('pt-BR')
      );

      try {
        await alvo.send(textoFinal);
        return i.editReply(`✅ Contrato #${id} enviado por DM pra ${alvo.tag}`);
      } catch {
        return i.editReply(`❌ Não consegui enviar DM pra ${alvo.tag}. Ele pode estar com DM fechada.`);
      }
    }

    if (i.commandName === 'editartextocontrato') {
      if (i.user.id!== ID_DONO) return i.editReply('❌ Só o dono pode editar o modelo.');

      const novoTexto = i.options.getString('texto');
      await db.execute({
        sql: `INSERT INTO config (chave, valor) VALUES ('modelo_contrato',?) ON CONFLICT(chave) DO UPDATE SET valor=?`,
        args: [novoTexto, novoTexto]
      });

      return i.editReply(`✅ Modelo padrão atualizado!\n\n**Prévia:**\n${novoTexto.substring(0, 500)}...`);
    }

    if (i.commandName === 'vertextocontrato') {
      if (i.user.id!== ID_DONO) return i.editReply('❌ Só o dono pode ver o modelo.');

      const modelo = await getTextoContrato();
      return i.editReply(`**Modelo padrão atual:**\n\n${modelo}`);
    }

    if (i.commandName === 'relatoriocontratos') {
      if (i.user.id!== ID_DONO) return i.editReply('❌ Só o dono pode ver relatórios.');

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

    if (i.commandName === 'editarcontrato') {
      if (i.user.id!== ID_DONO) return i.editReply('❌ Só o dono pode editar.');

      const id = i.options.getInteger('id');
      const novoEmail = i.options.getString('email');

      const contrato = await db.execute({ sql: 'SELECT * FROM contratos WHERE id=?', args: [id] });
      if (!contrato.rows.length) return i.editReply('❌ Contrato não encontrado.');
      if (contrato.rows[0].status === 'assinado') return i.editReply('❌ Não dá pra editar contrato já assinado.');

      await db.execute({ sql: 'UPDATE contratos SET email=? WHERE id=?', args: [novoEmail, id] });
      return i.editReply(`✅ Email do contrato #${id} alterado pra ${novoEmail}`);
    }

    if (i.commandName === 'deletarcontrato') {
      if (i.user.id!== ID_DONO) return i.editReply('❌ Só o dono pode deletar.');

      const id = i.options.getInteger('id');
      const contrato = await db.execute({ sql: 'SELECT * FROM contratos WHERE id=?', args: [id] });
      if (!contrato.rows.length) return i.editReply('❌ Contrato não encontrado.');

      await db.execute({ sql: 'DELETE FROM contratos WHERE id=?', args: [id] });
      return i.editReply(`🗑️ Contrato #${id} deletado.`);
    }

  } catch (e) {
    console.error(e);
    if (i.deferred || i.replied) {
      await i.editReply('❌ Deu erro. Tenta de novo.').catch(()=>{});
    }
  }
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

client.login(process.env.DISCORD_TOKEN);
